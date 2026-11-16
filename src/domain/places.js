/** 丢弃无效坐标并按 POI 标识去重，避免错误地点进入选择列表。 */
export function normalizePlaces(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      seen.has(item.id) ||
      !Number.isFinite(item.latitude) ||
      Math.abs(item.latitude) > 90 ||
      !Number.isFinite(item.longitude) ||
      Math.abs(item.longitude) > 180 ||
      typeof item.title !== "string" ||
      !item.title.trim()
    )
      return false;
    seen.add(item.id);
    return true;
  });
}
/** 选择店铺时保存店铺的坐标，不把用户站立点误当成店铺位置；当前定位单独作为兜底项。 */
export function selectPlace(fix, place) {
  if (!place) return { ...fix, poiId: null, poiName: null };
  const valid = normalizePlaces([place])[0];
  if (!valid) throw new Error("所选地点无效，请重新选择");
  return {
    latitude: place.latitude,
    longitude: place.longitude,
    accuracy: null,
    capturedAt: fix.capturedAt,
    label: place.title.trim(),
    address: String(place.address || ""),
    provider: "amap",
    coordinateSystem: "GCJ-02",
    poiId: place.id,
    poiName: place.title.trim(),
  };
}
export function placeDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return "";
  return meters < 1000
    ? `${Math.round(meters)} 米`
    : `${(meters / 1000).toFixed(1)} 公里`;
}
