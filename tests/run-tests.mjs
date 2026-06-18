import assert from "node:assert/strict";
import { computeRouteStats, haversineMeters, movingAverage, needsElevation } from "../app.js";

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

console.log("Core tests passed");
