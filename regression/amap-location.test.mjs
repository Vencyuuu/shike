import assert from "node:assert/strict";
import test from "node:test";
import { amapResultToLocation } from "../src/domain/location.js";
import { normalizeMeal } from "../src/domain/meals.js";

test("高德结果保留 GCJ-02 坐标系、地址与餐厅名，不进行二次坐标转换", () => {
  const result = amapResultToLocation({
    latitude: 26.0745,
    longitude: 119.2965,
    accuracy: 15,
    timestamp: Date.parse("2026-11-12T00:00:00Z"),
    address: "福建省福州市某路早餐店",
    poiName: "早餐店",
    aoiName: "某商场",
    coordinateSystem: "GCJ-02",
  });
  assert.equal(result.provider, "amap");
  assert.equal(result.latitude, 26.0745);
  assert.equal(result.coordinateSystem, "GCJ-02");
  assert.equal((result.label.match(/早餐店/g) || []).length, 1);
  const saved = normalizeMeal({
    cost_cents: 1860,
    rating: 4.5,
    location: result,
  });
  assert.equal(saved.location.coordinateSystem, "GCJ-02");
  assert.equal(saved.location.provider, "amap");
});
test("高德无地址时仍可保存有效坐标，非法坐标与时间不能写入", () => {
  const base = {
    latitude: 24.4798,
    longitude: 118.0894,
    timestamp: Date.now(),
  };
  assert.equal(amapResultToLocation(base).label, "24.4798, 118.0894");
  assert.throws(() => amapResultToLocation({ ...base, latitude: NaN }));
  assert.throws(() => amapResultToLocation({ ...base, longitude: 181 }));
  assert.throws(() => amapResultToLocation({ ...base, timestamp: Infinity }));
});
test("历史位置不猜测坐标系，后续高德位置与旧位置来源分别保留", () => {
  const old = normalizeMeal({
    location: { latitude: 26, longitude: 119, label: "旧地点" },
  });
  assert.equal(old.location.coordinateSystem, null);
  assert.equal(old.location.provider, null);
});
