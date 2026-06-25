const EARTH_RADIUS_M = 6371008.8;
const DEFAULT_BATCH_SIZE = 80;
const EXPORT_BASE_WIDTH = 1600;
const DEFAULT_ELEVATION_COLOR = "#001eff";
const DEFAULT_SLOPE_COLOR = "#008000";
// widthMm は印刷時の用紙の実寸（長辺/短辺）。1/n 縮尺はこの実寸とグラフの
// 描画幅から計算する。height は ratio から決まるため、mm/px は縦横で一致する。
const PAPER_SIZES = {
  "a4-landscape": { ratio: 297 / 210, widthMm: 297, label: "A4 横" },
  "a4-portrait": { ratio: 210 / 297, widthMm: 210, label: "A4 縦" },
  "a3-landscape": { ratio: 420 / 297, widthMm: 420, label: "A3 横" },
  "a3-portrait": { ratio: 297 / 420, widthMm: 297, label: "A3 縦" },
  // ワイドは規格紙ではないが、長辺を 297mm とみなして 1/n を算出する。
  wide: { ratio: 16 / 9, widthMm: 297, label: "ワイド 16:9" },
};

// 地形図のような「キリのいい」縮尺分母（1/n の n）の候補。実際に必要な n 以上で
// もっとも近い値へ切り上げる（n を上げる＝グラフを少し小さくして余白に収める）。
const NICE_SCALE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

// 断面図の凡例テーブルの行ラベル。左側にぶら下げて描くため、作図領域の左余白幅は
// この中で最も長いラベルが収まるように確保する。
const ELEVATION_TABLE_ROWS = ["地点間距離 [km]", "地点名（標高 [m]）", "植生"];

// canvas を使わずに文字幅をおおまかに見積もる（レイアウト計算用）。全角は font サイズ、
// 半角は約 0.6 倍で概算する。実描画前の余白確保に使うので、やや大きめに見積もる。
export function estimateTextWidth(text, fontSize) {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    const isFullWidth =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += isFullWidth ? fontSize : fontSize * 0.6;
  }
  return width;
}

export function haversineMeters(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function parseGpx(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) {
    throw new Error("GPX を XML として読み込めませんでした。");
  }

  const orderedNames = ["trkpt", "rtept", "wpt"];
  let pointNodes = [];
  for (const name of orderedNames) {
    pointNodes = Array.from(doc.getElementsByTagName(name));
    if (pointNodes.length > 0) break;
  }

  if (pointNodes.length < 2) {
    throw new Error("GPX 内に 2 点以上の trkpt / rtept / wpt が必要です。");
  }

  const points = pointNodes.map((node, index) => {
    const lat = Number.parseFloat(node.getAttribute("lat"));
    const lon = Number.parseFloat(node.getAttribute("lon"));
    const eleNode = Array.from(node.childNodes).find((child) => child.localName === "ele");
    const elevation = eleNode ? Number.parseFloat(eleNode.textContent ?? "") : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`${index + 1} 点目の緯度経度が不正です。`);
    }
    return {
      lat,
      lon,
      elevation: Number.isFinite(elevation) ? elevation : null,
      node,
    };
  });

  return { doc, points };
}

export function computeRouteStats(points, smoothingWindow = 9) {
  const distancesKm = [0];
  const elevations = points.map((point) => point.elevation ?? 0);
  const segmentMeters = [];
  const rawSlopes = [0];
  let totalMeters = 0;
  let ascent = 0;
  let descent = 0;

  for (let i = 1; i < points.length; i += 1) {
    const segment = haversineMeters(points[i - 1], points[i]);
    const deltaElevation = elevations[i] - elevations[i - 1];
    totalMeters += segment;
    distancesKm.push(totalMeters / 1000);
    segmentMeters.push(segment);

    if (deltaElevation > 0) ascent += deltaElevation;
    if (deltaElevation < 0) descent += Math.abs(deltaElevation);
    rawSlopes.push(segment > 0 ? (Math.atan2(deltaElevation, segment) * 180) / Math.PI : 0);
  }

  const slopes = movingAverage(rawSlopes, smoothingWindow);
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);

  return {
    distancesKm,
    elevations,
    slopes,
    segmentMeters,
    totalKm: totalMeters / 1000,
    ascent,
    descent,
    minElevation,
    maxElevation,
  };
}

export function movingAverage(values, windowSize) {
  const size = Math.max(1, Math.trunc(windowSize));
  const radius = Math.floor(size / 2);
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    const slice = values.slice(start, end);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

export function needsElevation(points) {
  return points.some((point) => point.elevation === null);
}

export function getExportCanvasSize(paperKey, width = EXPORT_BASE_WIDTH) {
  const paper = PAPER_SIZES[paperKey] ?? PAPER_SIZES["a4-landscape"];
  // The exported page keeps the selected paper's true aspect ratio. The
  // exaggeration only reshapes the graph drawn inside the page (see the
  // export layout helpers), it must never change the paper size itself.
  return {
    width,
    height: Math.max(220, Math.round(width / paper.ratio)),
    label: paper.label,
  };
}

export function getNiceTickStep(maxValue, targetTicks = 10) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 1;
  const rawStep = maxValue / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

export function getNiceCeil(value, step) {
  if (!Number.isFinite(value) || value <= 0) return step;
  return Math.ceil(value / step) * step;
}

export function getNiceFloor(value, step) {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value / step) * step;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// 必要な縮尺分母 value 以上で、もっともキリのいい n（例: 25000, 50000）へ切り上げる。
export function getNiceScaleDenominator(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  for (const step of NICE_SCALE_STEPS) {
    if (normalized <= step + 1e-9) return Math.round(step * magnitude);
  }
  return Math.round(10 * magnitude);
}

// 断面図の作図寸法と縮尺を求める。
//
// 強調比 exaggeration は「縦の縮尺 ÷ 横の縮尺」（= x 軸と y 軸の比率）と定義する。
// 横の実距離 xMaxKm[km] と縦の実標高差 yRangeM[m] を実寸（mm/px）に投影したとき、
//   exaggeration = (plotHeight / yRange) / (plotWidth / xRange)
// が常に成り立つよう plotHeight/plotWidth を決めるので、用紙サイズが変わっても
// 強調比（縦横比）は変化しない。
//
// さらに横の縮尺分母 n を「キリのいい」値へ切り上げ、その n からグラフ幅を逆算する
// ことで、地形図のような 1/n を保ったまま用紙内に収める。
export function getSectionScale({
  paperWidthMm,
  canvasWidthPx,
  maxPlotWidthPx,
  maxPlotHeightPx,
  xMaxKm,
  yRangeM,
  exaggeration,
}) {
  const mmPerPx = paperWidthMm / canvasWidthPx;
  const xMaxM = Math.max(1e-6, xMaxKm * 1000);
  const yRange = Math.max(1e-6, yRangeM);
  // plotHeight / plotWidth。強調比を満たすための縦横比。
  const heightPerWidth = (exaggeration * yRange) / xMaxM;
  // 用紙の幅・高さの両方に収まる最大のグラフ幅。
  const widthFromHeight = heightPerWidth > 0 ? maxPlotHeightPx / heightPerWidth : maxPlotWidthPx;
  const baseWidth = Math.max(1, Math.min(maxPlotWidthPx, widthFromHeight));
  // baseWidth をそのまま使ったときの横縮尺分母。これ以上の n ならグラフは収まる。
  const idealDenominator = (xMaxKm * 1e6) / (baseWidth * mmPerPx);
  const horizontalScale = getNiceScaleDenominator(idealDenominator);
  const plotWidth = (xMaxKm * 1e6) / (horizontalScale * mmPerPx);
  const plotHeight = plotWidth * heightPerWidth;
  const verticalScale = horizontalScale / exaggeration;
  return { plotWidth, plotHeight, mmPerPx, horizontalScale, verticalScale };
}

export function getAutoElevationAxis(minElevation, maxElevation) {
  const minValue = Number.isFinite(minElevation) ? minElevation : 0;
  const maxValue = Number.isFinite(maxElevation) ? maxElevation : 1;
  const range = Math.max(1, maxValue - minValue);
  const padding = Math.max(10, range * 0.08);
  // 上側は広めに余白を取り、グラフ右上の情報枠と標高線が重ならないようにする。
  const topPadding = Math.max(40, range * 0.25);
  const shouldStartAtZero = minValue <= 120 || range > maxValue * 0.55;
  const roughMin = shouldStartAtZero ? 0 : minValue - padding;
  const roughMax = maxValue + topPadding;
  const step = getNiceTickStep(Math.max(1, roughMax - roughMin), 7);
  // 軸を省略（0 から始めない）する場合は、下端を 0.5 目盛りぶん下げて省略記号を
  // 入れる余白を作る。最初の目盛りは従来どおり nice floor から始まり、軸の全範囲が
  // 作図高に対応するので強調比（縦横比）は変わらない。
  const niceFloorMin = getNiceFloor(roughMin, step);
  const min = shouldStartAtZero ? 0 : Math.max(step * 0.5, niceFloorMin - step * 0.5);
  const max = Math.max(step, getNiceCeil(roughMax, step));
  return { min, max, step };
}

export function getAutoSlopeAxis(slopes) {
  const absMax = Math.max(0, ...slopes.map((value) => Math.abs(value)).filter(Number.isFinite));
  const roughLimit = Math.max(5, absMax * 1.12);
  const step = getNiceTickStep(roughLimit * 2, 8);
  const limit = Math.max(step, getNiceCeil(roughLimit, step));
  return { min: -limit, max: limit, step };
}

export async function fillMissingElevations(points, options) {
  const endpoint = options.endpoint.trim();
  const batchSize = Math.min(100, Math.max(1, options.batchSize || DEFAULT_BATCH_SIZE));
  const missing = points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.elevation === null);

  if (missing.length === 0) return { filled: 0 };
  if (!endpoint) {
    throw new Error("標高 API の URL が空です。");
  }

  let filled = 0;
  for (let start = 0; start < missing.length; start += batchSize) {
    const batch = missing.slice(start, start + batchSize);
    options.onProgress?.(Math.min(missing.length, start + batch.length), missing.length);
    const results = await requestElevations(endpoint, batch.map(({ point }) => point));
    results.forEach((result, offset) => {
      const elevation = Number.parseFloat(result.elevation);
      if (Number.isFinite(elevation)) {
        batch[offset].point.elevation = elevation;
        filled += 1;
      }
    });
  }

  if (filled !== missing.length) {
    throw new Error(`標高補完に失敗した点があります。補完 ${filled} / ${missing.length} 点`);
  }

  return { filled };
}

async function requestElevations(endpoint, points) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: points.map((point) => ({
        latitude: point.lat,
        longitude: point.lon,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`標高 API が ${response.status} を返しました。時間をおいて再試行してください。`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload.results)) {
    throw new Error("標高 API の応答形式が想定と異なります。");
  }
  return payload.results;
}

export function writeElevationsToGpx(doc, points) {
  points.forEach((point) => {
    const value = point.elevation;
    if (!Number.isFinite(value)) return;

    let eleNode = Array.from(point.node.childNodes).find((child) => child.localName === "ele");
    if (!eleNode) {
      eleNode = doc.createElement("ele");
      const firstElement = Array.from(point.node.childNodes).find((child) => child.nodeType === 1);
      point.node.insertBefore(eleNode, firstElement ?? null);
    }
    eleNode.textContent = value.toFixed(1);
  });

  return new XMLSerializer().serializeToString(doc);
}

function boot() {
  const fileInput = document.querySelector("#gpx-file");
  const routeButtons = document.querySelector("#route-buttons");
  const routeLibraryNote = document.querySelector("#route-library-note");
  const statusEl = document.querySelector("#status");
  const endpointInput = document.querySelector("#elevation-endpoint");
  const batchSizeInput = document.querySelector("#batch-size");
  const smoothingInput = document.querySelector("#smoothing-window");
  const smoothingOutput = document.querySelector("#smoothing-output");
  const downloadButton = document.querySelector("#download-gpx");
  const fitMapButton = document.querySelector("#fit-map");
  const placeSearchInput = document.querySelector("#place-search");
  const placeSearchButton = document.querySelector("#place-search-button");
  const pickToggleButton = document.querySelector("#pick-toggle");
  const pickClearButton = document.querySelector("#pick-clear");
  const mapPickNote = document.querySelector("#map-pick-note");
  const placeResults = document.querySelector("#place-results");
  const paperSizeInput = document.querySelector("#paper-size");
  const exportExaggerationInput = document.querySelector("#export-exaggeration");
  const exportExaggerationOutput = document.querySelector("#export-exaggeration-output");
  const elevationColorInput = document.querySelector("#elevation-color");
  const slopeColorInput = document.querySelector("#slope-color");
  const pageMarginInput = document.querySelector("#page-margin");
  const pageMarginOutput = document.querySelector("#page-margin-output");
  const previewScaleInput = document.querySelector("#preview-scale");
  const previewScaleOutput = document.querySelector("#preview-scale-output");
  const exportFormatInput = document.querySelector("#export-format");
  const exportElevationButton = document.querySelector("#export-elevation");
  const exportSlopeButton = document.querySelector("#export-slope");
  const exportNote = document.querySelector("#export-note");
  const exportElevationCanvas = document.querySelector("#export-elevation-canvas");
  const exportSlopeCanvas = document.querySelector("#export-slope-canvas");
  const elevationCanvas = document.querySelector("#elevation-chart");
  const slopeCanvas = document.querySelector("#slope-chart");
  const elevationNote = document.querySelector("#elevation-note");
  const slopeNote = document.querySelector("#slope-note");
  const slopeModeInput = document.querySelector("#slope-mode");
  const metrics = {
    distance: document.querySelector("#metric-distance"),
    ascent: document.querySelector("#metric-ascent"),
    descent: document.querySelector("#metric-descent"),
    elevation: document.querySelector("#metric-elevation"),
  };

  let routeLayer = null;
  let hoverMarker = null;
  let elevationChart = null;
  let slopeChart = null;
  let lastHighlightIndex = null;
  let latestGpxText = "";
  let latestFileName = "route.gpx";
  let latestParsed = null;
  let latestStats = null;
  let latestPoints = null;
  let pickMode = false;
  let pickStart = null;
  let pickLayer = null;
  let searchMarker = null;

  const map = L.map("map", { scrollWheelZoom: true }).setView([35.6812, 139.7671], 6);
  // 地形図（国土地理院 標準地図）。日本の山岳の等高線・地形が読み取りやすい。
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution:
      '地形図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院</a>',
  }).addTo(map);

  // 地図をなぞると、最も近いルート点を断面図・傾斜図に印として表示する（地図 → グラフ）。
  map.on("mousemove", (event) => {
    if (!latestPoints?.length) return;
    const index = findNearestPointIndex(event.latlng);
    if (index == null) return;
    const point = latestPoints[index];
    const pixel = map.latLngToContainerPoint([point.lat, point.lon]);
    if (pixel.distanceTo(event.containerPoint) > 40) {
      clearHighlight();
      return;
    }
    highlightAtIndex(index);
  });
  map.on("mouseout", clearHighlight);
  // 2点選択モードでは、地図クリックで断面図の始点・終点を指定する。
  map.on("click", handleMapClick);

  for (const canvas of [elevationCanvas, slopeCanvas]) {
    canvas.addEventListener("mouseleave", clearHighlight);
  }

  loadRouteLibrary();

  smoothingInput.addEventListener("input", () => {
    smoothingOutput.value = `${smoothingInput.value} 点`;
    if (latestParsed) renderAnalysis(latestParsed.points);
  });

  paperSizeInput.addEventListener("change", () => {
    if (latestStats) renderExportCanvases();
  });

  exportExaggerationInput.addEventListener("input", () => {
    exportExaggerationOutput.value = `1：${exportExaggerationInput.value}`;
    if (latestStats) renderExportCanvases();
  });

  pageMarginInput.addEventListener("input", () => {
    pageMarginOutput.value = `${pageMarginInput.value}%`;
    if (latestStats) renderExportCanvases();
  });

  previewScaleInput.addEventListener("input", () => {
    previewScaleOutput.value = `${previewScaleInput.value}%`;
    applyPreviewScale();
  });

  [elevationColorInput, slopeColorInput].forEach((input) => {
    input.addEventListener("input", () => {
      if (latestStats && latestPoints) {
        renderCharts(latestStats.distancesKm.map((km) => km.toFixed(2)), latestStats, latestPoints);
        renderExportCanvases();
      }
    });
  });

  slopeModeInput.addEventListener("change", () => {
    if (latestStats && latestPoints) {
      renderCharts(latestStats.distancesKm.map((km) => km.toFixed(2)), latestStats, latestPoints);
      renderExportCanvases();
    }
  });

  exportElevationButton.addEventListener("click", () => {
    exportCanvas(exportElevationCanvas, `${latestFileName}_profile`);
  });

  exportSlopeButton.addEventListener("click", () => {
    exportCanvas(exportSlopeCanvas, `${latestFileName}_slope`);
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    clearRouteSelection();
    setBusy(true);

    try {
      const xmlText = await file.text();
      await analyzeGpxText(xmlText, file.name.replace(/\.gpx$/i, "") || "route");
    } catch (error) {
      console.error(error);
      updateStatus(error.message || "処理中にエラーが発生しました。");
      downloadButton.disabled = true;
    } finally {
      setBusy(false);
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!latestGpxText) return;
    const blob = new Blob([latestGpxText], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${latestFileName}_elevation.gpx`;
    link.click();
    URL.revokeObjectURL(url);
  });

  fitMapButton.addEventListener("click", () => {
    if (routeLayer) map.fitBounds(routeLayer.getBounds(), { padding: [28, 28] });
  });

  let placeSearchTimer = null;
  placeSearchInput.addEventListener("input", () => {
    const query = placeSearchInput.value.trim();
    window.clearTimeout(placeSearchTimer);
    if (query.length < 2) {
      hidePlaceResults();
      return;
    }
    placeSearchTimer = window.setTimeout(() => loadPlaceResults(query), 300);
  });
  placeSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitPlaceSearch();
    } else if (event.key === "Escape") {
      hidePlaceResults();
    }
  });
  placeSearchButton.addEventListener("click", submitPlaceSearch);
  // 検索ボックスの外をクリックしたら候補を閉じる。
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".map-search")) hidePlaceResults();
  });

  pickToggleButton.addEventListener("click", () => {
    if (pickMode) {
      setPickMode(false);
    } else {
      clearPickSelection();
      setPickMode(true);
    }
  });

  pickClearButton.addEventListener("click", () => {
    clearPickSelection();
    if (pickMode) {
      updateStatus("地図で1点目をクリックしてください。");
      mapPickNote.textContent = "1点目を選択";
    }
  });

  async function loadRouteLibrary() {
    try {
      const response = await fetch("./data/routes.json", { cache: "no-store" });
      if (!response.ok) throw new Error("登録済み GPX 一覧を読み込めませんでした。");
      const routes = await response.json();
      routeButtons.textContent = "";
      routes.forEach((route) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = route.name;
        button.dataset.file = route.file;
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => loadRegisteredRoute(route, button));
        routeButtons.append(button);
      });
      routeLibraryNote.textContent = `${routes.length} 件`;
    } catch (error) {
      console.error(error);
      routeLibraryNote.textContent = "読み込み失敗";
    }
  }

  async function loadRegisteredRoute(route, button) {
    setBusy(true);
    try {
      updateStatus(`${route.name} を読み込んでいます。`);
      const response = await fetch(encodeURI(route.file));
      if (!response.ok) throw new Error(`${route.name} を読み込めませんでした。`);
      const xmlText = await response.text();
      clearRouteSelection();
      button.setAttribute("aria-pressed", "true");
      fileInput.value = "";
      await analyzeGpxText(xmlText, route.name);
    } catch (error) {
      console.error(error);
      updateStatus(error.message || "登録済み GPX の読み込みに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeGpxText(xmlText, routeName) {
    latestFileName = routeName;
    updateStatus("GPX を読み込んでいます。");
    const parsed = parseGpx(xmlText);
    latestParsed = parsed;

    if (needsElevation(parsed.points)) {
      updateStatus("標高が無い点を緯度経度から補完しています。");
      const result = await fillMissingElevations(parsed.points, {
        endpoint: endpointInput.value,
        batchSize: Number.parseInt(batchSizeInput.value, 10),
        onProgress: (done, total) => updateStatus(`標高補完中: ${done} / ${total} 点`),
      });
      elevationNote.textContent = `${result.filled} 点の標高を補完`;
    } else {
      elevationNote.textContent = "GPX 内の標高を使用";
    }

    latestGpxText = writeElevationsToGpx(parsed.doc, parsed.points);
    renderAnalysis(parsed.points);
    downloadButton.disabled = false;
    fitMapButton.disabled = false;
    exportElevationButton.disabled = false;
    exportSlopeButton.disabled = false;
    updateStatus("解析が完了しました。");
  }

  // 入力が「緯度, 経度」の形式ならその座標を返す（緯度経度入力に対応）。
  function parseLatLon(text) {
    const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const lat = Number.parseFloat(match[1]);
    const lon = Number.parseFloat(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  // 候補地のリストを取得する。座標 → 国土地理院（日本）→ OSM Nominatim（海外）。
  async function geocodeCandidates(query) {
    const coords = parseLatLon(query);
    if (coords) {
      return [{ lat: coords.lat, lon: coords.lon, label: `緯度 ${coords.lat}, 経度 ${coords.lon}`, sub: "この座標へ移動" }];
    }
    try {
      const response = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.slice(0, 6).map((item) => {
            const [lon, lat] = item.geometry.coordinates;
            return { lat, lon, label: item.properties?.title ?? query, sub: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
          });
        }
      }
    } catch (error) {
      console.error(error);
    }
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(query)}`);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        return data.map((item) => ({
          lat: Number.parseFloat(item.lat),
          lon: Number.parseFloat(item.lon),
          label: item.display_name,
          sub: item.type ?? "",
        }));
      }
    }
    return [];
  }

  // 入力に応じて候補リストを表示する（Google マップ風の候補選択）。
  async function loadPlaceResults(query) {
    try {
      const candidates = await geocodeCandidates(query);
      if (placeSearchInput.value.trim() !== query) return; // 入力が変わっていたら破棄
      renderPlaceResults(candidates);
      if (candidates.length === 0) updateStatus(`「${query}」に一致する場所が見つかりませんでした。`);
    } catch (error) {
      console.error(error);
    }
  }

  function renderPlaceResults(candidates) {
    placeResults.textContent = "";
    if (candidates.length === 0) {
      placeResults.hidden = true;
      return;
    }
    candidates.forEach((candidate) => {
      const item = document.createElement("li");
      item.setAttribute("role", "option");
      const title = document.createElement("span");
      title.textContent = candidate.label;
      item.append(title);
      if (candidate.sub) {
        const sub = document.createElement("span");
        sub.className = "place-sub";
        sub.textContent = candidate.sub;
        item.append(sub);
      }
      item.addEventListener("click", () => selectPlace(candidate));
      placeResults.append(item);
    });
    placeResults.hidden = false;
  }

  function hidePlaceResults() {
    placeResults.hidden = true;
    placeResults.textContent = "";
  }

  function selectPlace(candidate) {
    hidePlaceResults();
    placeSearchInput.value = candidate.label;
    map.setView([candidate.lat, candidate.lon], 14);
    if (searchMarker) searchMarker.remove();
    searchMarker = L.circleMarker([candidate.lat, candidate.lon], {
      radius: 8,
      color: "#1d4ed8",
      fillColor: "#3b82f6",
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(map);
    searchMarker.bindPopup(candidate.label).openPopup();
    updateStatus(`「${candidate.label}」へ移動しました。地図で2点を選ぶと断面図を作成できます。`);
  }

  // 検索ボタン / Enter: 最有力の候補（座標ならその点）へ移動する。
  async function submitPlaceSearch() {
    const query = placeSearchInput.value.trim();
    if (!query) return;
    window.clearTimeout(placeSearchTimer);
    placeSearchButton.disabled = true;
    updateStatus(`「${query}」を検索しています。`);
    try {
      const candidates = await geocodeCandidates(query);
      if (candidates.length === 0) {
        hidePlaceResults();
        updateStatus(`「${query}」に一致する場所が見つかりませんでした。`);
        return;
      }
      selectPlace(candidates[0]);
    } catch (error) {
      console.error(error);
      updateStatus("場所の検索に失敗しました。ネットワークを確認してください。");
    } finally {
      placeSearchButton.disabled = false;
    }
  }

  function setPickMode(on) {
    pickMode = on;
    pickToggleButton.setAttribute("aria-pressed", String(on));
    pickToggleButton.textContent = on ? "選択中（地図をクリック）" : "2点選択を開始";
    document.querySelector("#map").classList.toggle("picking", on);
    if (on) {
      updateStatus("地図で1点目をクリックしてください。");
      mapPickNote.textContent = "1点目を選択";
    } else {
      mapPickNote.textContent = "住所検索 / 地図で2点クリック";
    }
  }

  function clearPickSelection() {
    pickStart = null;
    if (pickLayer) {
      pickLayer.remove();
      pickLayer = null;
    }
    pickClearButton.disabled = true;
  }

  function drawPickPoints(start, end) {
    if (pickLayer) pickLayer.remove();
    const markers = [
      L.circleMarker([start.lat, start.lon], { radius: 6, color: "#0f5c43", fillColor: "#fff", fillOpacity: 1, weight: 3 }),
    ];
    if (end) {
      markers.push(L.circleMarker([end.lat, end.lon], { radius: 6, color: "#d56b1f", fillColor: "#fff", fillOpacity: 1, weight: 3 }));
      markers.push(L.polyline([[start.lat, start.lon], [end.lat, end.lon]], { color: "#d56b1f", weight: 3, dashArray: "6 5" }));
    }
    pickLayer = L.featureGroup(markers).addTo(map);
  }

  async function handleMapClick(event) {
    if (!pickMode) return;
    const point = { lat: event.latlng.lat, lon: event.latlng.lng };
    if (!pickStart) {
      pickStart = point;
      drawPickPoints(point);
      pickClearButton.disabled = false;
      updateStatus("地図で2点目をクリックしてください。");
      mapPickNote.textContent = "2点目を選択";
      return;
    }
    const start = pickStart;
    const end = point;
    pickStart = null;
    setPickMode(false);
    drawPickPoints(start, end);
    await analyzeMapSection(start, end);
  }

  // 2点間を直線補間してサンプル点を作り、標高を補完して断面図を生成する。
  async function analyzeMapSection(start, end) {
    const distanceMeters = haversineMeters(start, end);
    if (distanceMeters < 5) {
      updateStatus("2点が近すぎます。離れた2点を選んでください。");
      clearPickSelection();
      return;
    }
    setBusy(true);
    try {
      const count = clamp(Math.round(distanceMeters / 50), 25, 300);
      const latlngs = interpolateLine(start, end, count);
      const gpxText = buildGpxFromLatLngs(latlngs);
      clearRouteSelection();
      fileInput.value = "";
      await analyzeGpxText(gpxText, "map-section");
      updateStatus(`地図上の2点（約 ${(distanceMeters / 1000).toFixed(2)} km）から断面図を作成しました。`);
    } catch (error) {
      console.error(error);
      updateStatus(error.message || "断面図の作成に失敗しました。標高 API の状態を確認してください。");
    } finally {
      setBusy(false);
      clearPickSelection();
    }
  }

  function interpolateLine(start, end, count) {
    const points = [];
    const steps = Math.max(1, count - 1);
    for (let i = 0; i < count; i += 1) {
      const t = i / steps;
      points.push({
        lat: start.lat + (end.lat - start.lat) * t,
        lon: start.lon + (end.lon - start.lon) * t,
      });
    }
    return points;
  }

  function buildGpxFromLatLngs(latlngs) {
    const trackPoints = latlngs.map((point) => `<trkpt lat="${point.lat}" lon="${point.lon}"></trkpt>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="GeoSection"><trk><name>map-section</name><trkseg>${trackPoints}</trkseg></trk></gpx>`;
  }

  function renderAnalysis(points) {
    const stats = computeRouteStats(points, Number.parseInt(smoothingInput.value, 10));
    latestStats = stats;
    latestPoints = points;
    const latLngs = points.map((point) => [point.lat, point.lon]);
    const labels = stats.distancesKm.map((km) => km.toFixed(2));

    renderMap(latLngs);
    renderCharts(labels, stats, points);
    renderExportCanvases();
    updateMetrics(stats);
    slopeNote.textContent = `${smoothingInput.value} 点移動平均`;
  }

  function renderMap(latLngs) {
    if (routeLayer) routeLayer.remove();
    const line = L.polyline(latLngs, {
      color: "#1f7a5c",
      weight: 5,
      opacity: 0.9,
      lineJoin: "round",
    });
    const start = L.circleMarker(latLngs[0], { radius: 5, color: "#0f5c43", fillOpacity: 1 });
    const finish = L.circleMarker(latLngs[latLngs.length - 1], { radius: 5, color: "#d56b1f", fillOpacity: 1 });
    routeLayer = L.featureGroup([line, start, finish]).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [28, 28] });
  }

  // 傾斜図の表示系列。トグルで「傾斜角（度）」と「勾配（％ = tan×100）」を切り替える。
  function getSlopeSeries(stats) {
    if (slopeModeInput.value === "grade") {
      return {
        values: stats.slopes.map((deg) => Math.tan((deg * Math.PI) / 180) * 100),
        axisTitle: "勾配 [%]",
        label: "勾配",
      };
    }
    return { values: stats.slopes, axisTitle: "傾斜角 [度]", label: "傾斜角" };
  }

  function renderCharts(labels, stats, points) {
    const colors = getGraphColors();
    const chartOptions = (unit, color) => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `距離 ${items[0].label} km`,
            label: (item) => `${item.dataset.label}: ${item.formattedValue} ${unit}`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "距離 [km]" },
          ticks: { maxTicksLimit: 10 },
          grid: { color: "rgba(99, 112, 105, 0.16)" },
        },
        y: {
          title: { display: true, text: unit },
          grid: { color: "rgba(99, 112, 105, 0.16)" },
        },
      },
      onHover: (_, elements, chart) => {
        if (!elements.length) {
          clearHighlight();
          return;
        }
        // グラフ → 地図マーカー + もう一方のグラフにも印（手前のグラフは Chart.js が処理）。
        const index = elements[0].index;
        showHoverMarker(points[index], color);
        setChartActiveIndex(chart === elevationChart ? slopeChart : elevationChart, index);
        lastHighlightIndex = index;
      },
    });

    const elevationData = {
      labels,
      datasets: [
        {
          label: "標高",
          data: stats.elevations.map((value) => Math.round(value * 10) / 10),
          borderColor: colors.elevation,
          backgroundColor: colorWithAlpha(colors.elevation, 0.16),
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBorderWidth: 3,
          pointHoverBackgroundColor: "#ffffff",
          pointHoverBorderColor: colors.elevation,
          tension: 0.18,
        },
      ],
    };
    const slope = getSlopeSeries(stats);
    const slopeData = {
      labels,
      datasets: [
        {
          label: slope.label,
          data: slope.values.map((value) => Math.round(value * 10) / 10),
          borderColor: colors.slope,
          backgroundColor: colorWithAlpha(colors.slope, 0.12),
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBorderWidth: 3,
          pointHoverBackgroundColor: "#ffffff",
          pointHoverBorderColor: colors.slope,
          tension: 0.16,
        },
      ],
    };

    if (elevationChart) elevationChart.destroy();
    if (slopeChart) slopeChart.destroy();
    elevationChart = new Chart(elevationCanvas, {
      type: "line",
      data: elevationData,
      options: chartOptions("標高 [m]", colors.elevation),
      plugins: [selectionMarkerPlugin],
    });
    slopeChart = new Chart(slopeCanvas, {
      type: "line",
      data: slopeData,
      options: chartOptions(slope.axisTitle, colors.slope),
      plugins: [selectionMarkerPlugin],
    });
  }

  function showHoverMarker(point, color) {
    if (hoverMarker) hoverMarker.remove();
    hoverMarker = L.circleMarker([point.lat, point.lon], {
      radius: 7,
      color,
      weight: 3,
      fillColor: "#ffffff",
      fillOpacity: 1,
    }).addTo(map);
  }

  // 選択箇所を縦の破線でグラフ上に示す Chart.js プラグイン。
  const selectionMarkerPlugin = {
    id: "selectionMarker",
    afterDatasetsDraw(chart) {
      const active = chart.getActiveElements();
      if (!active.length) return;
      const { ctx, chartArea } = chart;
      const x = active[0].element.x;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "rgba(40, 44, 42, 0.55)";
      ctx.stroke();
      ctx.restore();
    },
  };

  function findNearestPointIndex(latlng) {
    let bestIndex = null;
    let bestDistance = Infinity;
    const cosLat = Math.cos((latlng.lat * Math.PI) / 180);
    for (let i = 0; i < latestPoints.length; i += 1) {
      const dLat = latestPoints[i].lat - latlng.lat;
      const dLon = (latestPoints[i].lon - latlng.lng) * cosLat;
      const distance = dLat * dLat + dLon * dLon;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  // 地図 → グラフ。指定インデックスの点を地図マーカーと両グラフの印に反映する。
  function highlightAtIndex(index) {
    if (!latestPoints || index == null || index < 0 || index >= latestPoints.length) return;
    if (index === lastHighlightIndex) return;
    lastHighlightIndex = index;
    showHoverMarker(latestPoints[index], getGraphColors().elevation);
    setChartActiveIndex(elevationChart, index);
    setChartActiveIndex(slopeChart, index);
  }

  function setChartActiveIndex(chart, index) {
    if (!chart) return;
    const element = chart.getDatasetMeta(0)?.data?.[index];
    chart.setActiveElements([{ datasetIndex: 0, index }]);
    if (chart.tooltip && element) {
      chart.tooltip.setActiveElements([{ datasetIndex: 0, index }], { x: element.x, y: element.y });
    }
    chart.update("none");
  }

  function clearHighlight() {
    lastHighlightIndex = null;
    if (hoverMarker) {
      hoverMarker.remove();
      hoverMarker = null;
    }
    for (const chart of [elevationChart, slopeChart]) {
      if (!chart) continue;
      chart.setActiveElements([]);
      if (chart.tooltip) chart.tooltip.setActiveElements([], { x: 0, y: 0 });
      chart.update("none");
    }
  }

  function renderExportCanvases() {
    if (!latestStats) return;
    const exaggeration = Number.parseFloat(exportExaggerationInput.value) || 1;
    const size = getExportCanvasSize(paperSizeInput.value, EXPORT_BASE_WIDTH);
    const options = getExportOptions();
    applyPreviewScale();
    const scaleInfo = drawElevationExport(exportElevationCanvas, latestStats, size, exaggeration, options);
    drawSlopeExport(exportSlopeCanvas, latestStats, size, options);
    exportNote.textContent =
      `${size.label} / 強調比 1：${exaggeration} / 横縮尺 1：${formatScaleDenominator(scaleInfo.horizontalScale)}` +
      ` / 縦縮尺 1：${formatScaleDenominator(scaleInfo.verticalScale)}`;
  }

  function drawElevationExport(canvas, stats, size, exaggeration, options) {
    setupCanvas(canvas, size);
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const yAxis = getAutoElevationAxis(stats.minElevation, stats.maxElevation);
    const xMax = Math.max(1, getNiceCeil(stats.totalKm, getNiceTickStep(stats.totalKm, 12)));
    const layout = getElevationExportLayout(width, height, options.marginPercent, exaggeration, {
      paperWidthMm: options.paperWidthMm,
      xMaxKm: xMax,
      yRangeM: yAxis.max - yAxis.min,
    });
    const { plot } = layout;

    drawWhitePage(ctx, width, height);
    drawPlotFrame(ctx, plot, xMax, yAxis.min, yAxis.max, "水平距離 [km]", "垂直距離 [m]", {
      yStep: yAxis.step,
      xLabelAlign: "left",
      showYAxisBreak: yAxis.min > 0,
      tickFontSize: layout.tickFontSize,
      labelFontSize: layout.labelFontSize,
      xTickOffset: layout.xTickOffset,
      xLabelOffset: layout.xLabelOffset,
      yLabelOffset: layout.yLabelOffset,
      // X 軸ラベルと表の行見出しの右端を揃えるため、同じ gap を使う。
      xLabelGap: layout.tableLabelGap,
    });
    drawLine(ctx, plot, stats.distancesKm, stats.elevations, xMax, yAxis.min, yAxis.max, options.elevationColor, layout.lineWidth);

    // タイトルはグラフ上のヘッダに中央寄せ。縮尺・強調比などはグラフ内の右上に
    // まとめて配置し、作図領域に合わせてサイズを自動調整する。
    const headerWidth = layout.infoRight - (width - layout.infoRight);
    drawCenteredTextFit(ctx, "断面図", width / 2, plot.top - Math.round(layout.titleFontSize * 1.3), headerWidth, layout.titleFontSize, "#000");
    drawPlotInfoBox(ctx, plot, [
      `強調比 1：${exaggeration}`,
      `水平 1：${formatScaleDenominator(layout.horizontalScale)}`,
      `垂直 1：${formatScaleDenominator(layout.verticalScale)}`,
      `総距離 ${stats.totalKm.toFixed(2)} km`,
    ], layout.infoFontSize);
    drawElevationTable(ctx, plot.left, layout.tableTop, plot.right - plot.left, layout.tableHeight, {
      fontSize: layout.tableFontSize,
      labelGap: layout.tableLabelGap,
    });
    return { horizontalScale: layout.horizontalScale, verticalScale: layout.verticalScale };
  }

  function drawSlopeExport(canvas, stats, size, options) {
    setupCanvas(canvas, size);
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const layout = getSlopeExportLayout(width, height, options.marginPercent);
    const { plot } = layout;
    const slope = getSlopeSeries(stats);
    const yAxis = getAutoSlopeAxis(slope.values);
    const xMax = Math.max(1, getNiceCeil(stats.totalKm, getNiceTickStep(stats.totalKm, 12)));

    drawWhitePage(ctx, width, height);
    drawPlotFrame(ctx, plot, xMax, yAxis.min, yAxis.max, "距離 [km]", slope.axisTitle, { yStep: yAxis.step });
    const zeroY = mapValue(0, yAxis.min, yAxis.max, plot.bottom, plot.top);
    drawLineSegment(ctx, plot.left, zeroY, plot.right, zeroY, "#333", 1, [2, 3]);
    drawLine(ctx, plot, stats.distancesKm, slope.values, xMax, yAxis.min, yAxis.max, options.slopeColor, layout.lineWidth);
    drawCenteredText(ctx, slope.label, width / 2, plot.top - 18, 18, "#000");
  }

  function formatScaleDenominator(value) {
    if (!Number.isFinite(value) || value <= 0) return "-";
    return Math.round(value).toLocaleString("en-US");
  }

  function getExportOptions() {
    const paper = PAPER_SIZES[paperSizeInput.value] ?? PAPER_SIZES["a4-landscape"];
    return {
      elevationColor: elevationColorInput.value || DEFAULT_ELEVATION_COLOR,
      slopeColor: slopeColorInput.value || DEFAULT_SLOPE_COLOR,
      marginPercent: clamp(Number.parseInt(pageMarginInput.value, 10) || 8, 4, 16),
      paperWidthMm: paper.widthMm,
    };
  }

  function getGraphColors() {
    return {
      elevation: elevationColorInput.value || DEFAULT_ELEVATION_COLOR,
      slope: slopeColorInput.value || DEFAULT_SLOPE_COLOR,
    };
  }

  function applyPreviewScale() {
    document.documentElement.style.setProperty("--paper-preview-scale", `${previewScaleInput.value}%`);
  }

  function getElevationExportLayout(width, height, marginPercent, exaggeration, scaleInput) {
    const scale = clamp(Math.min(width / EXPORT_BASE_WIDTH, height / 980), 0.45, 1.1);
    const pageMarginX = Math.round(width * (marginPercent / 100));
    const pageMarginY = Math.round(height * (marginPercent / 100));
    const tableFontSize = Math.max(9, Math.round(16 * scale));
    const tableLabelGap = Math.max(8, Math.round(14 * scale));
    // 行ラベルは作図枠の左側にぶら下げるため、最長ラベルが収まる左余白を必ず確保する。
    const labelBand = Math.max(...ELEVATION_TABLE_ROWS.map((row) => estimateTextWidth(row, tableFontSize)));
    const fullLeft = Math.max(
      pageMarginX + Math.round(78 * scale),
      Math.round(width * 0.13),
      pageMarginX + Math.ceil(labelBand) + tableLabelGap + 10,
    );
    const fullRight = width - Math.max(pageMarginX, Math.round(width * 0.045));
    // ヘッダはタイトル 1 行ぶんのみ確保する（縮尺・強調比はグラフ内右上へ移動）。
    const top = Math.max(pageMarginY + Math.round(40 * scale), Math.round(46 * scale));
    const bottomPad = Math.max(pageMarginY, Math.round(16 * scale));
    const minPlotHeight = Math.max(76, Math.round(120 * scale));
    const minPlotWidth = Math.max(Math.round(width * 0.16), 160);
    const tableHeight = clamp(Math.round(height * 0.12), Math.round(44 * scale), Math.round(110 * scale));
    const xLabelBand = Math.max(Math.round(46 * scale), 30);
    const maxPlotWidth = fullRight - fullLeft;
    const maxPlotHeight = Math.max(minPlotHeight, height - bottomPad - tableHeight - xLabelBand - top);

    // 用紙サイズに依らず強調比（縦横比）を一定に保ち、横縮尺 n をキリよく丸める。
    const { plotWidth, plotHeight, horizontalScale, verticalScale } = getSectionScale({
      paperWidthMm: scaleInput.paperWidthMm,
      canvasWidthPx: width,
      maxPlotWidthPx: maxPlotWidth,
      maxPlotHeightPx: maxPlotHeight,
      xMaxKm: scaleInput.xMaxKm,
      yRangeM: scaleInput.yRangeM,
      exaggeration,
    });
    const drawWidth = clamp(Math.round(plotWidth), minPlotWidth, maxPlotWidth);
    const drawHeight = clamp(Math.round(plotHeight), minPlotHeight, maxPlotHeight);
    const centerX = Math.round((fullLeft + fullRight) / 2);
    const left = centerX - Math.round(drawWidth / 2);
    const right = left + drawWidth;
    const plotBottom = top + drawHeight;
    const tableTop = plotBottom + xLabelBand;

    return {
      plot: { left, top, right, bottom: plotBottom },
      tableTop,
      tableHeight,
      infoRight: fullRight,
      horizontalScale,
      verticalScale,
      tickFontSize: Math.max(9, Math.round(14 * scale)),
      labelFontSize: Math.max(10, Math.round(14 * scale)),
      titleFontSize: Math.max(13, Math.round(20 * scale)),
      infoFontSize: Math.max(11, Math.round(17 * scale)),
      tableFontSize,
      tableLabelGap,
      xTickOffset: Math.max(5, Math.round(8 * scale)),
      xLabelOffset: Math.max(22, Math.round(34 * scale)),
      yLabelOffset: Math.max(38, Math.round(58 * scale)),
      lineWidth: Math.max(1.5, Math.round(3 * scale * 10) / 10),
    };
  }

  function getSlopeExportLayout(width, height, marginPercent) {
    const scale = clamp(Math.min(width / EXPORT_BASE_WIDTH, height / 820), 0.48, 1.1);
    const pageMarginX = Math.round(width * (marginPercent / 100));
    const pageMarginY = Math.round(height * (marginPercent / 100));
    // 傾斜図の縦軸は「角度（度）」で長さではないため、強調比（長さの比率）は
    // 適用しない。用紙の縦横比に合わせて作図領域いっぱいに描く。
    const left = Math.max(pageMarginX + Math.round(58 * scale), Math.round(width * 0.11));
    const right = width - Math.max(pageMarginX, Math.round(width * 0.045));
    const top = Math.max(pageMarginY + Math.round(32 * scale), Math.round(52 * scale));
    const bottomGap = Math.max(pageMarginY + Math.round(44 * scale), Math.round(70 * scale));
    const bottom = Math.max(top + Math.round(110 * scale), height - bottomGap);
    return {
      plot: { left, top, right, bottom },
      tickFontSize: Math.max(9, Math.round(14 * scale)),
      labelFontSize: Math.max(10, Math.round(14 * scale)),
      titleFontSize: Math.max(11, Math.round(18 * scale)),
      infoFontSize: Math.max(10, Math.round(18 * scale)),
      xTickOffset: Math.max(5, Math.round(8 * scale)),
      xLabelOffset: Math.max(22, Math.round(34 * scale)),
      yLabelOffset: Math.max(38, Math.round(58 * scale)),
      lineWidth: Math.max(1.2, Math.round(2 * scale * 10) / 10),
    };
  }

  function colorWithAlpha(hex, alpha) {
    const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : DEFAULT_ELEVATION_COLOR.slice(1);
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function setupCanvas(canvas, size) {
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.style.aspectRatio = `${size.width} / ${size.height}`;
  }

  function drawWhitePage(ctx, width, height) {
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.font = "14px 'Yu Gothic', Meiryo, sans-serif";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.restore();
  }

  function drawPlotFrame(ctx, plot, xMax, yMin, yMax, xLabel, yLabel, options = {}) {
    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.2;
    const plotWidth = plot.right - plot.left;
    const plotHeight = plot.bottom - plot.top;
    ctx.strokeRect(plot.left, plot.top, plotWidth, plotHeight);

    const tickFontSize = options.tickFontSize ?? 14;
    const labelFontSize = options.labelFontSize ?? 14;
    const xTickOffset = options.xTickOffset ?? 8;
    const xLabelOffset = options.xLabelOffset ?? 38;
    const yLabelOffset = options.yLabelOffset ?? 58;
    ctx.font = `${tickFontSize}px 'Yu Gothic', Meiryo, sans-serif`;
    ctx.fillStyle = "#000";

    // X 軸の目盛り間隔は作図幅に合わせて決め、ラベルの重なり・はみ出しを防ぐ。
    // ラベルは整数 km なので刻みも 1 以上の整数に丸める。
    const xLabelWidth = Math.max(ctx.measureText(String(Math.round(xMax))).width, ctx.measureText("0").width);
    const xTickTargets = clamp(Math.floor(plotWidth / (xLabelWidth + 16)), 2, 20);
    const xStep = Math.max(1, Math.round(getNiceTickStep(xMax, xTickTargets)));

    // Y 軸も作図高に合わせ、キリのいい刻みの整数倍へ間引いて重なりを防ぐ。
    const baseYStep = options.yStep ?? getNiceTickStep(yMax - yMin, 8);
    const maxYTicks = Math.max(2, Math.floor(plotHeight / (tickFontSize * 1.7)));
    const yMultiple = Math.max(1, Math.ceil((yMax - yMin) / baseYStep / maxYTicks));
    const yStep = baseYStep * yMultiple;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let x = 0; x <= xMax + 0.0001; x += xStep) {
      const px = mapValue(x, 0, xMax, plot.left, plot.right);
      drawLineSegment(ctx, px, plot.top, px, plot.bottom, "#b7b7b7", 1);
      ctx.fillText(String(Math.round(x)), px, plot.bottom + xTickOffset);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const yStart = Math.ceil(yMin / yStep) * yStep;
    for (let y = yStart; y <= yMax + 0.0001; y += yStep) {
      const py = mapValue(y, yMin, yMax, plot.bottom, plot.top);
      drawLineSegment(ctx, plot.left, py, plot.right, py, "#b7b7b7", 1);
      ctx.fillText(String(Math.round(y)), plot.left - 10, py);
    }

    ctx.textAlign = options.xLabelAlign === "left" ? "right" : "center";
    ctx.textBaseline = "top";
    ctx.font = `${labelFontSize}px 'Yu Gothic', Meiryo, sans-serif`;
    // 左寄せの X 軸ラベルは、下の表の行見出しと右端を揃える（同じ left からの
    // gap を使うので、縦横比が変わっても縦に綺麗に並ぶ）。
    const leftLabelGap = options.xLabelGap ?? 16;
    ctx.fillText(xLabel, options.xLabelAlign === "left" ? plot.left - leftLabelGap : (plot.left + plot.right) / 2, plot.bottom + xLabelOffset);
    ctx.save();
    ctx.translate(plot.left - yLabelOffset, (plot.top + plot.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    // 縦軸タイトルが作図高を超える場合は縮めて枠外へはみ出さないようにする。
    const yTitleWidth = ctx.measureText(yLabel).width;
    if (yTitleWidth > plotHeight - 8) {
      ctx.font = `${Math.max(8, Math.floor(labelFontSize * ((plotHeight - 8) / yTitleWidth)))}px 'Yu Gothic', Meiryo, sans-serif`;
    }
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
    if (options.showYAxisBreak) {
      // 最初の目盛り（yStart）と軸の下端（plot.bottom）の間にできた余白の中央へ、
      // Y 軸線上に省略記号を置く。これで 原点 → 記号 → 目盛り の順に並ぶ。
      const firstTickPy = mapValue(yStart, yMin, yMax, plot.bottom, plot.top);
      const gap = plot.bottom - firstTickPy;
      drawYAxisBreak(ctx, plot.left, plot.bottom - gap / 2, gap);
    }
    ctx.restore();
  }

  function drawYAxisBreak(ctx, x, y, gapHeight = 16) {
    ctx.save();
    const width = 28;
    // 記号の縦サイズを余白の高さに合わせて調整し、目盛りと重ならないようにする。
    const amplitude = clamp(gapHeight * 0.12, 2, 3.2);
    const lineSpacing = clamp(gapHeight * 0.26, 4, 6);
    const drawWave = (strokeStyle, lineWidth) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let line = 0; line < 2; line += 1) {
        const offsetY = y - lineSpacing / 2 + line * lineSpacing;
        ctx.beginPath();
        for (let i = 0; i <= width; i += 2) {
          const px = x - width / 2 + i;
          const py = offsetY + Math.sin((i / width) * Math.PI * 2) * amplitude;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    };
    drawWave("#fff", 6);
    drawWave("#000", 2.2);
    ctx.restore();
  }

  function drawLine(ctx, plot, xs, ys, xMax, yMin, yMax, color, lineWidth) {
    ctx.save();
    ctx.beginPath();
    xs.forEach((x, index) => {
      const px = mapValue(x, 0, xMax, plot.left, plot.right);
      const py = mapValue(ys[index], yMin, yMax, plot.bottom, plot.top);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  function drawElevationTable(ctx, left, top, width, height, options = {}) {
    const rows = ELEVATION_TABLE_ROWS;
    const labelGap = options.labelGap ?? 14;
    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(left, top, width, height);
    for (let i = 1; i < rows.length; i += 1) {
      const y = top + (height / rows.length) * i;
      drawLineSegment(ctx, left, y, left + width, y, "#000", 1.2);
    }
    ctx.fillStyle = "#000";
    // ラベルは枠の左側にぶら下げる。左余白に収まらなければフォントを縮めて
    // 用紙の左端からはみ出さないようにする（安全策）。
    let fontSize = options.fontSize ?? 16;
    const available = left - labelGap - 4;
    ctx.font = `${fontSize}px 'Yu Gothic', Meiryo, sans-serif`;
    const widest = Math.max(...rows.map((row) => ctx.measureText(row).width));
    if (widest > available && widest > 0) {
      fontSize = Math.max(8, Math.floor(fontSize * (available / widest)));
      ctx.font = `${fontSize}px 'Yu Gothic', Meiryo, sans-serif`;
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    rows.forEach((label, index) => {
      const y = top + (height / rows.length) * (index + 0.5);
      ctx.fillText(label, left - labelGap, y);
    });
    ctx.restore();
  }

  // グラフ内の右上に複数行の情報（縮尺・強調比など）を白背景の枠付きで描く。
  // 作図領域の幅・高さに収まるようフォントサイズを自動調整する。
  function drawPlotInfoBox(ctx, plot, lines, baseSize) {
    if (!lines.length) return;
    const plotWidth = plot.right - plot.left;
    const plotHeight = plot.bottom - plot.top;
    ctx.save();
    // 高さ・幅の両方に収まる最大のフォントサイズを求める。
    // boxHeight(size) ≈ size * (2*0.5 + (N-1)*1.45 + 1) = size * (2 + 1.45(N-1))
    const heightFactor = 2 + 1.45 * (lines.length - 1);
    let size = Math.min(baseSize, Math.floor((plotHeight * 0.6) / heightFactor));
    size = Math.max(8, size);
    ctx.font = `${size}px 'Yu Gothic', Meiryo, sans-serif`;
    let maxLineWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const limitWidth = plotWidth * 0.55;
    if (maxLineWidth > limitWidth && maxLineWidth > 0) {
      size = Math.max(8, Math.floor(size * (limitWidth / maxLineWidth)));
      ctx.font = `${size}px 'Yu Gothic', Meiryo, sans-serif`;
      maxLineWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    }
    const innerPad = Math.round(size * 0.5);
    const lineHeight = Math.round(size * 1.45);
    const boxWidth = maxLineWidth + innerPad * 2;
    const boxHeight = innerPad * 2 + (lines.length - 1) * lineHeight + size;
    const margin = Math.max(4, Math.round(size * 0.5));
    const boxRight = plot.right - margin;
    const boxLeft = boxRight - boxWidth;
    const boxTop = plot.top + margin;
    ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = 1;
    ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight);
    ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight);
    ctx.fillStyle = "#000";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
      ctx.fillText(line, boxRight - innerPad, boxTop + innerPad + index * lineHeight);
    });
    ctx.restore();
  }

  // 中央寄せで描くが、maxWidth に収まらなければフォントを縮めてはみ出しを防ぐ。
  function drawCenteredTextFit(ctx, text, x, y, maxWidth, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    let fontSize = size;
    ctx.font = `${fontSize}px 'Yu Gothic', Meiryo, sans-serif`;
    const measured = ctx.measureText(text).width;
    if (measured > maxWidth && measured > 0) {
      fontSize = Math.max(8, Math.floor(fontSize * (maxWidth / measured)));
      ctx.font = `${fontSize}px 'Yu Gothic', Meiryo, sans-serif`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawLineSegment(ctx, x1, y1, x2, y2, color, width, dash = []) {
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCenteredText(ctx, text, x, y, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${size}px 'Yu Gothic', Meiryo, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function mapValue(value, fromMin, fromMax, toMin, toMax) {
    if (fromMax === fromMin) return toMin;
    return toMin + ((value - fromMin) / (fromMax - fromMin)) * (toMax - toMin);
  }

  // 選択された出力形式（PNG / PDF）でキャンバスを書き出す。
  function exportCanvas(canvas, baseName) {
    const format = exportFormatInput.value === "pdf" ? "pdf" : "png";
    if (format === "pdf") {
      try {
        downloadCanvasAsPdf(canvas, `${baseName}.pdf`, paperSizeInput.value);
      } catch (error) {
        console.error(error);
        updateStatus("PDF の生成に失敗しました。PNG で保存するか、時間をおいて再試行してください。");
      }
      return;
    }
    downloadCanvas(canvas, `${baseName}.png`);
  }

  function downloadCanvas(canvas, filename) {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = filename;
    link.click();
  }

  // 用紙の実寸（mm）に合わせた 1 ページの PDF を作り、キャンバス画像を全面に貼る。
  // キャンバスは用紙と同じ縦横比で描かれているため、歪まずにページ全体へ収まる。
  function downloadCanvasAsPdf(canvas, filename, paperKey) {
    const jsPdfNamespace = window.jspdf;
    if (!jsPdfNamespace?.jsPDF) {
      throw new Error("jsPDF が読み込まれていません。");
    }
    const paper = PAPER_SIZES[paperKey] ?? PAPER_SIZES["a4-landscape"];
    const widthMm = paper.widthMm;
    const heightMm = widthMm / paper.ratio;
    const orientation = widthMm >= heightMm ? "landscape" : "portrait";
    const pdf = new jsPdfNamespace.jsPDF({ orientation, unit: "mm", format: [widthMm, heightMm] });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidth, pageHeight);
    pdf.save(filename);
  }

  function updateMetrics(stats) {
    metrics.distance.textContent = `${stats.totalKm.toFixed(2)} km`;
    metrics.ascent.textContent = `${Math.round(stats.ascent)} m`;
    metrics.descent.textContent = `${Math.round(stats.descent)} m`;
    metrics.elevation.textContent = `${Math.round(stats.minElevation)} - ${Math.round(stats.maxElevation)} m`;
  }

  function updateStatus(message) {
    statusEl.textContent = message;
  }

  function setBusy(isBusy) {
    fileInput.disabled = isBusy;
    endpointInput.disabled = isBusy;
    batchSizeInput.disabled = isBusy;
    paperSizeInput.disabled = isBusy;
    exportExaggerationInput.disabled = isBusy;
    elevationColorInput.disabled = isBusy;
    slopeColorInput.disabled = isBusy;
    slopeModeInput.disabled = isBusy;
    pageMarginInput.disabled = isBusy;
    previewScaleInput.disabled = isBusy;
    exportFormatInput.disabled = isBusy;
    exportElevationButton.disabled = isBusy || !latestStats;
    exportSlopeButton.disabled = isBusy || !latestStats;
    placeSearchInput.disabled = isBusy;
    placeSearchButton.disabled = isBusy;
    pickToggleButton.disabled = isBusy;
    pickClearButton.disabled = isBusy || (!pickStart && !pickLayer);
    routeButtons.querySelectorAll("button").forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function clearRouteSelection() {
    routeButtons.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", "false");
    });
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.GeoSectionCore = {
    computeRouteStats,
    fillMissingElevations,
    getAutoElevationAxis,
    getAutoSlopeAxis,
    getExportCanvasSize,
    getNiceCeil,
    getNiceScaleDenominator,
    getNiceTickStep,
    getSectionScale,
    haversineMeters,
    movingAverage,
    needsElevation,
    parseGpx,
    writeElevationsToGpx,
  };
  window.addEventListener("DOMContentLoaded", boot);
}
