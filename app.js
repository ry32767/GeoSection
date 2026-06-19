const EARTH_RADIUS_M = 6371008.8;
const DEFAULT_BATCH_SIZE = 80;
const EXPORT_BASE_WIDTH = 1600;
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

export function getExportCanvasSize(paperKey, width = EXPORT_BASE_WIDTH, exaggeration = 20) {
  const paper = PAPER_SIZES[paperKey] ?? PAPER_SIZES["a4-landscape"];
  const factor = Math.max(0.15, Math.min(8, exaggeration / 20));
  return {
    width,
    height: Math.max(220, Math.round((width / paper.ratio) * factor)),
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
  const exportElevationButton = document.querySelector("#export-elevation");
  const exportSlopeButton = document.querySelector("#export-slope");
  const exportNote = document.querySelector("#export-note");
  const exportElevationCanvas = document.querySelector("#export-elevation-canvas");
  const exportSlopeCanvas = document.querySelector("#export-slope-canvas");
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
  let latestGpxText = "";
  let latestFileName = "route.gpx";
  let latestParsed = null;
  let latestStats = null;

  const map = L.map("map", { scrollWheelZoom: true }).setView([35.6812, 139.7671], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

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
      onHover: (_, elements) => {
        if (!elements.length) return;
        const index = elements[0].index;
        showHoverMarker(points[index], color);
      },
    });

    const elevationData = {
      labels,
      datasets: [
        {
          label: "標高",
          data: stats.elevations.map((value) => Math.round(value * 10) / 10),
          borderColor: "#1f7a5c",
          backgroundColor: "rgba(31, 122, 92, 0.16)",
          fill: true,
          pointRadius: 0,
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
          borderColor: "#d56b1f",
          backgroundColor: "rgba(213, 107, 31, 0.12)",
          fill: true,
          pointRadius: 0,
          tension: 0.16,
        },
      ],
    };

    if (elevationChart) elevationChart.destroy();
    if (slopeChart) slopeChart.destroy();
    elevationChart = new Chart(document.querySelector("#elevation-chart"), {
      type: "line",
      data: elevationData,
      options: chartOptions("標高 [m]", "#1f7a5c"),
    });
    slopeChart = new Chart(document.querySelector("#slope-chart"), {
      type: "line",
      data: slopeData,
      options: chartOptions("傾斜角 [度]", "#d56b1f"),
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

  function renderExportCanvases() {
    if (!latestStats) return;
    const exaggeration = Number.parseInt(exportExaggerationInput.value, 10);
    const size = getExportCanvasSize(paperSizeInput.value, EXPORT_BASE_WIDTH, exaggeration);
    drawElevationExport(exportElevationCanvas, latestStats, size, exaggeration);
    drawSlopeExport(exportSlopeCanvas, latestStats, size, exaggeration);
    exportNote.textContent = `${size.label} / 縦強調 ${exaggeration} / ${size.width}x${size.height}px`;
  }

  function drawElevationExport(canvas, stats, size, exaggeration) {
    setupCanvas(canvas, size);
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const margin = {
      left: Math.round(width * 0.16),
      right: Math.round(width * 0.06),
      top: Math.round(height * 0.08),
      bottom: Math.round(height * 0.26),
    };
    const tableTop = height - margin.bottom + Math.round(height * 0.045);
    const plot = {
      left: margin.left,
      top: margin.top,
      right: width - margin.right,
      bottom: tableTop - Math.round(height * 0.045),
    };
    const yAxis = getAutoElevationAxis(stats.minElevation, stats.maxElevation);
    const xMax = Math.max(1, getNiceCeil(stats.totalKm, getNiceTickStep(stats.totalKm, 12)));

    drawWhitePage(ctx, width, height);
    drawPlotFrame(ctx, plot, xMax, yAxis.min, yAxis.max, "水平距離 [km]", "垂直距離 [m]", yAxis.step);
    drawLine(ctx, plot, stats.distancesKm, stats.elevations, xMax, yAxis.min, yAxis.max, "#001eff", 3);

    drawCenteredText(ctx, "断面図", width / 2, margin.top - 18, 18, "#000");
    drawRightText(ctx, `水平：垂直 = 1：${exaggeration}`, plot.right - 12, plot.top + 22, 18, "#000");
    drawRightText(ctx, `総距離: ${stats.totalKm.toFixed(2)} km`, plot.right - 12, plot.top + 52, 18, "#000");
    drawElevationTable(ctx, plot.left, tableTop, plot.right - plot.left, Math.round(height * 0.14));
  }

  function drawSlopeExport(canvas, stats, size, exaggeration) {
    setupCanvas(canvas, size);
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const plot = {
      left: Math.round(width * 0.13),
      top: Math.round(height * 0.12),
      right: Math.round(width * 0.94),
      bottom: Math.round(height * 0.76),
    };
    const yAxis = getAutoSlopeAxis(stats.slopes);
    const xMax = Math.max(1, getNiceCeil(stats.totalKm, getNiceTickStep(stats.totalKm, 12)));

    drawWhitePage(ctx, width, height);
    drawPlotFrame(ctx, plot, xMax, yAxis.min, yAxis.max, "距離 [km]", "傾斜角 [度]", yAxis.step);
    const zeroY = mapValue(0, yAxis.min, yAxis.max, plot.bottom, plot.top);
    drawLineSegment(ctx, plot.left, zeroY, plot.right, zeroY, "#333", 1, [2, 3]);
    drawLine(ctx, plot, stats.distancesKm, stats.slopes, xMax, yAxis.min, yAxis.max, "#008000", 2);
    drawCenteredText(ctx, "傾斜角", width / 2, plot.top - 18, 18, "#000");
    drawRightText(ctx, `強調度： ${exaggeration}`, plot.right - 18, plot.top + 28, 18, "#000");
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

  function drawPlotFrame(ctx, plot, xMax, yMin, yMax, xLabel, yLabel, explicitYStep = null) {
    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);

    const xStep = xMax <= 60 ? 1 : Math.max(1, getNiceTickStep(xMax, 18));
    const yStep = explicitYStep ?? getNiceTickStep(yMax - yMin, 8);
    ctx.font = "14px 'Yu Gothic', Meiryo, sans-serif";
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let x = 0; x <= xMax + 0.0001; x += xStep) {
      const px = mapValue(x, 0, xMax, plot.left, plot.right);
      drawLineSegment(ctx, px, plot.top, px, plot.bottom, "#b7b7b7", 1);
      ctx.fillText(String(Math.round(x)), px, plot.bottom + 8);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const yStart = Math.ceil(yMin / yStep) * yStep;
    for (let y = yStart; y <= yMax + 0.0001; y += yStep) {
      const py = mapValue(y, yMin, yMax, plot.bottom, plot.top);
      drawLineSegment(ctx, plot.left, py, plot.right, py, "#b7b7b7", 1);
      ctx.fillText(String(Math.round(y)), plot.left - 10, py);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(xLabel, (plot.left + plot.right) / 2, plot.bottom + 38);
    ctx.save();
    ctx.translate(plot.left - 58, (plot.top + plot.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
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

  function drawElevationTable(ctx, left, top, width, height) {
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
    ctx.font = "16px 'Yu Gothic', Meiryo, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    rows.forEach((label, index) => {
      const y = top + (height / rows.length) * (index + 0.5);
      ctx.fillText(label, left - 14, y);
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
