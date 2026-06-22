import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import {
  computeRouteStats,
  estimateTextWidth,
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
} from "../app.js";

const oneDegreeLonAtEquator = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
assert.ok(oneDegreeLonAtEquator > 111000 && oneDegreeLonAtEquator < 112000);

const route = [
  { lat: 35.0, lon: 135.0, elevation: 100 },
  { lat: 35.001, lon: 135.0, elevation: 130 },
  { lat: 35.002, lon: 135.0, elevation: 90 },
];
const stats = computeRouteStats(route, 1);
assert.equal(stats.distancesKm.length, 3);
assert.ok(stats.totalKm > 0.21 && stats.totalKm < 0.23);
assert.equal(Math.round(stats.ascent), 30);
assert.equal(Math.round(stats.descent), 40);
assert.equal(stats.minElevation, 90);
assert.equal(stats.maxElevation, 130);
assert.equal(needsElevation(route), false);
assert.equal(needsElevation([{ lat: 1, lon: 1, elevation: null }]), true);
assert.deepEqual(movingAverage([0, 10, 20, 30], 3), [5, 10, 20, 25]);
assert.deepEqual(getExportCanvasSize("a4-landscape", 1600), { width: 1600, height: 1131, label: "A4 横" });
assert.deepEqual(getExportCanvasSize("a4-portrait", 1600), { width: 1600, height: 2263, label: "A4 縦" });
// The paper size must keep the selected aspect ratio regardless of the
// exaggeration: the exaggeration only reshapes the graph drawn inside the page.
assert.deepEqual(getExportCanvasSize("a4-landscape", 1600, 6), { width: 1600, height: 1131, label: "A4 横" });
assert.deepEqual(getExportCanvasSize("a4-landscape", 1600, 50), { width: 1600, height: 1131, label: "A4 横" });
assert.equal(getNiceTickStep(44, 12), 5);
assert.equal(getNiceCeil(44.05, 5), 45);
assert.deepEqual(getAutoElevationAxis(0, 900), { min: 0, max: 1200, step: 200 });
assert.deepEqual(getAutoElevationAxis(780, 1040), { min: 750, max: 1150, step: 50 });
assert.deepEqual(getAutoSlopeAxis([-4, 8, 12]), { min: -15, max: 15, step: 5 });

// 文字幅の概算: 全角は font サイズ、半角は約 0.6 倍。
assert.equal(estimateTextWidth("あ", 16), 16);
assert.equal(estimateTextWidth("ab", 10), 12);
assert.ok(estimateTextWidth("地点名（標高 [m]）", 16) > estimateTextWidth("植生", 16));

// キリのいい縮尺分母へ切り上げる。
assert.equal(getNiceScaleDenominator(23000), 25000);
assert.equal(getNiceScaleDenominator(25000), 25000);
assert.equal(getNiceScaleDenominator(26000), 30000);
assert.equal(getNiceScaleDenominator(9000), 10000);
assert.equal(getNiceScaleDenominator(0), 1);

// 強調比（x:y）は用紙サイズに依らず一定。A4 横と A3 横で実現される強調比が一致する。
function realizedExaggeration(scaleResult, xMaxKm, yRangeM) {
  // E = (plotHeight / yRange) / (plotWidth / xRange)
  return (scaleResult.plotHeight / yRangeM) / (scaleResult.plotWidth / (xMaxKm * 1000));
}
const a4 = getSectionScale({
  paperWidthMm: 297,
  canvasWidthPx: 1600,
  maxPlotWidthPx: 1200,
  maxPlotHeightPx: 700,
  xMaxKm: 10,
  yRangeM: 1000,
  exaggeration: 10,
});
const a3 = getSectionScale({
  paperWidthMm: 420,
  canvasWidthPx: 1600,
  maxPlotWidthPx: 1200,
  maxPlotHeightPx: 700,
  xMaxKm: 10,
  yRangeM: 1000,
  exaggeration: 10,
});
assert.ok(Math.abs(realizedExaggeration(a4, 10, 1000) - 10) < 1e-6);
assert.ok(Math.abs(realizedExaggeration(a3, 10, 1000) - 10) < 1e-6);
// 横縮尺はキリのいい値、縦縮尺 = 横縮尺 / 強調比。
assert.equal(a4.verticalScale, a4.horizontalScale / 10);
assert.equal(getNiceScaleDenominator(a4.horizontalScale), a4.horizontalScale);
// グラフは用紙の作図領域に収まる。
assert.ok(a4.plotWidth <= 1200 + 1e-6 && a4.plotHeight <= 700 + 1e-6);
assert.ok(a3.plotWidth <= 1200 + 1e-6 && a3.plotHeight <= 700 + 1e-6);

const routes = JSON.parse(await readFile(new URL("../data/routes.json", import.meta.url), "utf8"));
assert.equal(routes.length, 15);
for (const route of routes) {
  assert.ok(route.name);
  assert.ok(route.file.startsWith("./data/"));
  await access(new URL(`..${route.file.slice(1)}`, import.meta.url));
}

console.log("Core tests passed");
