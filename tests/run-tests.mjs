import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import {
  computeRouteStats,
  getAutoElevationAxis,
  getAutoSlopeAxis,
  getExportCanvasSize,
  getNiceCeil,
  getNiceTickStep,
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
assert.deepEqual(getExportCanvasSize("a4-landscape", 1600, 6), { width: 1600, height: 339, label: "A4 横" });
assert.deepEqual(getExportCanvasSize("a4-landscape", 1600, 120), { width: 1600, height: 6788, label: "A4 横" });
assert.equal(getNiceTickStep(44, 12), 5);
assert.equal(getNiceCeil(44.05, 5), 45);
assert.deepEqual(getAutoElevationAxis(0, 900), { min: 0, max: 1000, step: 200 });
assert.deepEqual(getAutoElevationAxis(780, 1040), { min: 750, max: 1100, step: 50 });
assert.deepEqual(getAutoSlopeAxis([-4, 8, 12]), { min: -15, max: 15, step: 5 });

const routes = JSON.parse(await readFile(new URL("../data/routes.json", import.meta.url), "utf8"));
assert.equal(routes.length, 15);
for (const route of routes) {
  assert.ok(route.name);
  assert.ok(route.file.startsWith("./data/"));
  await access(new URL(`..${route.file.slice(1)}`, import.meta.url));
}

console.log("Core tests passed");
