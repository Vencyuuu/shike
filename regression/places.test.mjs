import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePlaces,
  selectPlace,
  placeDistance,
} from "../src/domain/places.js";
import { normalizeMeal } from "../src/domain/meals.js";

const fix = {
  latitude: 26.0714,
  longitude: 119.3013,
  accuracy: 10,
  capturedAt: "2026-11-12T00:00:00Z",
  label: "当前地址",
  provider: "amap",
  coordinateSystem: "GCJ-02",
};
const shop = {
  id: "B001",
  title: "早餐店",
  address: "某路 9 号",
  latitude: 26.0716,
  longitude: 119.3014,
  distance: 35,
};
test("附近地点丢弃非法坐标及重复项，不因空响应或异常名称崩溃", () => {
  assert.deepEqual(
    normalizePlaces([
      shop,
      shop,
      null,
      { ...shop, id: "bad", latitude: 99 },
      { ...shop, id: "bad2", title: 10 },
    ]),
    [shop],
  );
  assert.deepEqual(normalizePlaces(null), []);
});
test("选择店铺保存店铺坐标与 POI 标识，花费评分不受位置选择影响", () => {
  const location = selectPlace(fix, shop);
  const saved = normalizeMeal({ cost_cents: 1850, rating: 4.5, location });
  assert.equal(saved.location.latitude, shop.latitude);
  assert.notEqual(saved.location.latitude, fix.latitude);
  assert.equal(saved.location.poiId, shop.id);
  assert.equal(saved.location.address, shop.address);
  assert.equal(saved.location.coordinateSystem, "GCJ-02");
  assert.equal(saved.location.accuracy, null);
  assert.equal(saved.cost_cents, 1850);
  assert.equal(saved.rating, 4.5);
  assert.equal(fix.label, "当前地址");
});
test("使用当前位置保留真实定位精度，不编造店铺标识", () => {
  const location = selectPlace(fix, null);
  assert.equal(location.latitude, fix.latitude);
  assert.equal(location.accuracy, 10);
  assert.equal(location.poiId, null);
});
test("附近地点距离按米和公里展示，不显示无效距离", () => {
  assert.equal(placeDistance(35), "35 米");
  assert.equal(placeDistance(1500), "1.5 公里");
  assert.equal(placeDistance(-1), "");
});
