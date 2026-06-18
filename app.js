const EARTH_RADIUS_M = 6371008.8;
const DEFAULT_BATCH_SIZE = 80;

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
    updateStatus("解析が完了しました。");
  }

  function renderAnalysis(points) {
    const stats = computeRouteStats(points, Number.parseInt(smoothingInput.value, 10));
    const latLngs = points.map((point) => [point.lat, point.lon]);
    const labels = stats.distancesKm.map((km) => km.toFixed(2));

    renderMap(latLngs);
    renderCharts(labels, stats, points);
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
    haversineMeters,
    movingAverage,
    needsElevation,
    parseGpx,
    writeElevationsToGpx,
  };
  window.addEventListener("DOMContentLoaded", boot);
}
