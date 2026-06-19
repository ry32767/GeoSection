const EARTH_RADIUS_M = 6371008.8;
const DEFAULT_BATCH_SIZE = 80;
const EXPORT_BASE_WIDTH = 1600;
const DEFAULT_ELEVATION_COLOR = "#001eff";
const DEFAULT_SLOPE_COLOR = "#008000";
const PAPER_SIZES = {
  "a4-landscape": { ratio: 297 / 210, label: "A4 横" },
  "a4-portrait": { ratio: 210 / 297, label: "A4 縦" },
  "a3-landscape": { ratio: 420 / 297, label: "A3 横" },
  "a3-portrait": { ratio: 297 / 420, label: "A3 縦" },
  wide: { ratio: 16 / 9, label: "ワイド 16:9" },
};

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

export function getAutoElevationAxis(minElevation, maxElevation) {
  const minValue = Number.isFinite(minElevation) ? minElevation : 0;
  const maxValue = Number.isFinite(maxElevation) ? maxElevation : 1;
  const range = Math.max(1, maxValue - minValue);
  const padding = Math.max(10, range * 0.08);
  const shouldStartAtZero = minValue <= 120 || range > maxValue * 0.55;
  const roughMin = shouldStartAtZero ? 0 : minValue - padding;
  const roughMax = maxValue + padding;
  const step = getNiceTickStep(Math.max(1, roughMax - roughMin), 7);
  const min = shouldStartAtZero ? 0 : getNiceFloor(roughMin, step);
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
  const paperSizeInput = document.querySelector("#paper-size");
  const exportExaggerationInput = document.querySelector("#export-exaggeration");
  const exportExaggerationOutput = document.querySelector("#export-exaggeration-output");
  const elevationColorInput = document.querySelector("#elevation-color");
  const slopeColorInput = document.querySelector("#slope-color");
  const pageMarginInput = document.querySelector("#page-margin");
  const pageMarginOutput = document.querySelector("#page-margin-output");
  const previewScaleInput = document.querySelector("#preview-scale");
  const previewScaleOutput = document.querySelector("#preview-scale-output");
  const exportElevationButton = document.querySelector("#export-elevation");
  const exportSlopeButton = document.querySelector("#export-slope");
  const exportNote = document.querySelector("#export-note");
  const exportElevationCanvas = document.querySelector("#export-elevation-canvas");
  const exportSlopeCanvas = document.querySelector("#export-slope-canvas");
  const elevationCanvas = document.querySelector("#elevation-chart");
  const slopeCanvas = document.querySelector("#slope-chart");
  const elevationNote = document.querySelector("#elevation-note");
  const slopeNote = document.querySelector("#slope-note");
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
    exportExaggerationOutput.value = exportExaggerationInput.value;
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

  exportElevationButton.addEventListener("click", () => {
    downloadCanvas(exportElevationCanvas, `${latestFileName}_profile.png`);
  });

  exportSlopeButton.addEventListener("click", () => {
    downloadCanvas(exportSlopeCanvas, `${latestFileName}_slope.png`);
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
    const slopeData = {
      labels,
      datasets: [
        {
          label: "傾斜角",
          data: stats.slopes.map((value) => Math.round(value * 10) / 10),
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
      options: chartOptions("傾斜角 [度]", colors.slope),
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
    const exaggeration = Number.parseInt(exportExaggerationInput.value, 10);
    const size = getExportCanvasSize(paperSizeInput.value, EXPORT_BASE_WIDTH);
    const options = getExportOptions();
    applyPreviewScale();
    drawElevationExport(exportElevationCanvas, latestStats, size, exaggeration, options);
    drawSlopeExport(exportSlopeCanvas, latestStats, size, exaggeration, options);
    exportNote.textContent = `${size.label} / 縦強調 ${exaggeration} / ${size.width}x${size.height}px`;
  }

  function drawElevationExport(canvas, stats, size, exaggeration, options) {
    setupCanvas(canvas, size);
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const layout = getElevationExportLayout(width, height, options.marginPercent, exaggeration);
    const { plot } = layout;
    const margin = { top: plot.top };
    const yAxis = getAutoElevationAxis(stats.minElevation, stats.maxElevation);
    const xMax = Math.max(1, getNiceCeil(stats.totalKm, getNiceTickStep(stats.totalKm, 12)));

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
    });
    drawLine(ctx, plot, stats.distancesKm, stats.elevations, xMax, yAxis.min, yAxis.max, options.elevationColor, layout.lineWidth);

    drawCenteredText(ctx, "断面図", width / 2, margin.top - 18, 18, "#000");
    drawRightText(ctx, `水平：垂直 = 1：${exaggeration}`, plot.right - 12, plot.top + 22, 18, "#000");
    drawRightText(ctx, `総距離: ${stats.totalKm.toFixed(2)} km`, plot.right - 12, plot.top + 52, 18, "#000");
    drawElevationTable(ctx, plot.left, layout.tableTop, plot.right - plot.left, layout.tableHeight, {
      fontSize: layout.tableFontSize,
      labelGap: layout.tableLabelGap,
    });
  }

  function drawSlopeExport(canvas, stats, size, exaggeration, options) {
    setupCanvas(canvas, size);
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const layout = getSlopeExportLayout(width, height, options.marginPercent, exaggeration);
    const { plot } = layout;
    const yAxis = getAutoSlopeAxis(stats.slopes);
    const xMax = Math.max(1, getNiceCeil(stats.totalKm, getNiceTickStep(stats.totalKm, 12)));

    drawWhitePage(ctx, width, height);
    drawPlotFrame(ctx, plot, xMax, yAxis.min, yAxis.max, "距離 [km]", "傾斜角 [度]", { yStep: yAxis.step });
    const zeroY = mapValue(0, yAxis.min, yAxis.max, plot.bottom, plot.top);
    drawLineSegment(ctx, plot.left, zeroY, plot.right, zeroY, "#333", 1, [2, 3]);
    drawLine(ctx, plot, stats.distancesKm, stats.slopes, xMax, yAxis.min, yAxis.max, options.slopeColor, layout.lineWidth);
    drawCenteredText(ctx, "傾斜角", width / 2, plot.top - 18, 18, "#000");
    drawRightText(ctx, `強調度： ${exaggeration}`, plot.right - 18, plot.top + 28, 18, "#000");
  }

  function getExportOptions() {
    return {
      elevationColor: elevationColorInput.value || DEFAULT_ELEVATION_COLOR,
      slopeColor: slopeColorInput.value || DEFAULT_SLOPE_COLOR,
      marginPercent: clamp(Number.parseInt(pageMarginInput.value, 10) || 8, 4, 16),
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

  function getElevationExportLayout(width, height, marginPercent, exaggeration = 20) {
    const scale = clamp(Math.min(width / EXPORT_BASE_WIDTH, height / 980), 0.45, 1.1);
    const pageMarginX = Math.round(width * (marginPercent / 100));
    const pageMarginY = Math.round(height * (marginPercent / 100));
    const fullLeft = Math.max(pageMarginX + Math.round(78 * scale), Math.round(width * 0.13));
    const fullRight = width - Math.max(pageMarginX, Math.round(width * 0.045));
    const top = Math.max(pageMarginY + Math.round(28 * scale), Math.round(36 * scale));
    const bottomPad = Math.max(pageMarginY, Math.round(16 * scale));
    const minPlotHeight = Math.max(76, Math.round(120 * scale));
    // The paper size is fixed; the exaggeration only reshapes the graph inside
    // the page. Up to 20 it stretches the content height (top-anchored, white
    // margin below). Beyond 20 the height is already maxed out, so it instead
    // narrows the content width (centered, white margin on the sides) to keep
    // raising the vertical-to-horizontal ratio.
    const ratio = exaggeration / 20;
    const vScale = clamp(Math.min(ratio, 1), 0.2, 1);
    const hScale = ratio > 1 ? 1 / ratio : 1;
    const plotWidth = Math.max(Math.round(width * 0.18), Math.round((fullRight - fullLeft) * hScale));
    const centerX = Math.round((fullLeft + fullRight) / 2);
    const left = centerX - Math.round(plotWidth / 2);
    const right = left + plotWidth;
    const minContent = top + bottomPad + minPlotHeight + Math.round(140 * scale);
    const contentHeight = Math.min(height, Math.max(minContent, Math.round(height * vScale)));
    let tableHeight = clamp(Math.round(contentHeight * 0.14), Math.round(44 * scale), Math.round(92 * scale));
    let xLabelBand = Math.max(Math.round(46 * scale), 30);
    let tableTop = contentHeight - bottomPad - tableHeight;
    let plotBottom = tableTop - xLabelBand;

    if (plotBottom - top < minPlotHeight) {
      const available = Math.max(86, contentHeight - top - bottomPad - minPlotHeight);
      tableHeight = clamp(Math.round(available * 0.48), 34, 76);
      xLabelBand = clamp(available - tableHeight, 28, 54);
      tableTop = contentHeight - bottomPad - tableHeight;
      plotBottom = Math.max(top + minPlotHeight, tableTop - xLabelBand);
    }

    return {
      plot: { left, top, right, bottom: plotBottom },
      tableTop: Math.max(plotBottom + xLabelBand, tableTop),
      tableHeight,
      tickFontSize: Math.max(9, Math.round(14 * scale)),
      labelFontSize: Math.max(10, Math.round(14 * scale)),
      titleFontSize: Math.max(11, Math.round(18 * scale)),
      infoFontSize: Math.max(10, Math.round(18 * scale)),
      tableFontSize: Math.max(9, Math.round(16 * scale)),
      tableLabelGap: Math.max(8, Math.round(14 * scale)),
      xTickOffset: Math.max(5, Math.round(8 * scale)),
      xLabelOffset: Math.max(22, Math.round(34 * scale)),
      yLabelOffset: Math.max(38, Math.round(58 * scale)),
      lineWidth: Math.max(1.5, Math.round(3 * scale * 10) / 10),
      infoLine1: Math.max(16, Math.round(22 * scale)),
      infoLine2: Math.max(34, Math.round(52 * scale)),
    };
  }

  function getSlopeExportLayout(width, height, marginPercent, exaggeration = 20) {
    const scale = clamp(Math.min(width / EXPORT_BASE_WIDTH, height / 820), 0.48, 1.1);
    const pageMarginX = Math.round(width * (marginPercent / 100));
    const pageMarginY = Math.round(height * (marginPercent / 100));
    const fullLeft = Math.max(pageMarginX + Math.round(58 * scale), Math.round(width * 0.11));
    const fullRight = width - Math.max(pageMarginX, Math.round(width * 0.045));
    const top = Math.max(pageMarginY + Math.round(32 * scale), Math.round(52 * scale));
    // Same fixed-paper rule as the elevation chart: up to 20 stretches the
    // content height, beyond 20 narrows the content width (centered) so the
    // exaggeration keeps increasing without resizing the page.
    const ratio = exaggeration / 20;
    const vScale = clamp(Math.min(ratio, 1), 0.2, 1);
    const hScale = ratio > 1 ? 1 / ratio : 1;
    const plotWidth = Math.max(Math.round(width * 0.18), Math.round((fullRight - fullLeft) * hScale));
    const centerX = Math.round((fullLeft + fullRight) / 2);
    const left = centerX - Math.round(plotWidth / 2);
    const right = left + plotWidth;
    const bottomGap = Math.max(pageMarginY + Math.round(44 * scale), Math.round(70 * scale));
    const minContent = top + Math.round(110 * scale) + bottomGap;
    const contentHeight = Math.min(height, Math.max(minContent, Math.round(height * vScale)));
    const bottom = Math.max(top + Math.round(110 * scale), contentHeight - bottomGap);
    return {
      plot: { left, top, right, bottom: Math.min(bottom, contentHeight - Math.max(36, pageMarginY)) },
      tickFontSize: Math.max(9, Math.round(14 * scale)),
      labelFontSize: Math.max(10, Math.round(14 * scale)),
      titleFontSize: Math.max(11, Math.round(18 * scale)),
      infoFontSize: Math.max(10, Math.round(18 * scale)),
      xTickOffset: Math.max(5, Math.round(8 * scale)),
      xLabelOffset: Math.max(22, Math.round(34 * scale)),
      yLabelOffset: Math.max(38, Math.round(58 * scale)),
      lineWidth: Math.max(1.2, Math.round(2 * scale * 10) / 10),
      infoLine1: Math.max(18, Math.round(28 * scale)),
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
    ctx.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);

    const xStep = xMax <= 60 ? 1 : Math.max(1, getNiceTickStep(xMax, 18));
    const yStep = options.yStep ?? getNiceTickStep(yMax - yMin, 8);
    const tickFontSize = options.tickFontSize ?? 14;
    const labelFontSize = options.labelFontSize ?? 14;
    const xTickOffset = options.xTickOffset ?? 8;
    const xLabelOffset = options.xLabelOffset ?? 38;
    const yLabelOffset = options.yLabelOffset ?? 58;
    ctx.font = `${tickFontSize}px 'Yu Gothic', Meiryo, sans-serif`;
    ctx.fillStyle = "#000";
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
    ctx.fillText(xLabel, options.xLabelAlign === "left" ? plot.left - 16 : (plot.left + plot.right) / 2, plot.bottom + xLabelOffset);
    ctx.save();
    ctx.translate(plot.left - yLabelOffset, (plot.top + plot.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
    if (options.showYAxisBreak) {
      drawYAxisBreak(ctx, plot.left + 10, plot.bottom - 4);
    }
    ctx.restore();
  }

  function drawYAxisBreak(ctx, x, y) {
    ctx.save();
    const width = 28;
    const amplitude = 3.2;
    const drawWave = (strokeStyle, lineWidth) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let line = 0; line < 2; line += 1) {
        const offsetY = y - 7 + line * 6;
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
    const rows = ["地点間距離 [km]", "地点名（標高 [m]）", "植生"];
    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(left, top, width, height);
    for (let i = 1; i < rows.length; i += 1) {
      const y = top + (height / rows.length) * i;
      drawLineSegment(ctx, left, y, left + width, y, "#000", 1.2);
    }
    ctx.fillStyle = "#000";
    ctx.font = `${options.fontSize ?? 16}px 'Yu Gothic', Meiryo, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    rows.forEach((label, index) => {
      const y = top + (height / rows.length) * (index + 0.5);
      ctx.fillText(label, left - (options.labelGap ?? 14), y);
    });
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

  function drawRightText(ctx, text, x, y, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${size}px 'Yu Gothic', Meiryo, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function mapValue(value, fromMin, fromMax, toMin, toMax) {
    if (fromMax === fromMin) return toMin;
    return toMin + ((value - fromMin) / (fromMax - fromMin)) * (toMax - toMin);
  }

  function downloadCanvas(canvas, filename) {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = filename;
    link.click();
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
    pageMarginInput.disabled = isBusy;
    previewScaleInput.disabled = isBusy;
    exportElevationButton.disabled = isBusy || !latestStats;
    exportSlopeButton.disabled = isBusy || !latestStats;
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
    getNiceTickStep,
    haversineMeters,
    movingAverage,
    needsElevation,
    parseGpx,
    writeElevationsToGpx,
  };
  window.addEventListener("DOMContentLoaded", boot);
}
