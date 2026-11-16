/** 高德返回的地址与坐标一起保存，坐标系明确标注，不能把 GCJ-02 当作旧版 WGS84。 */
export function amapResultToLocation(result) {
  const { latitude, longitude } = result;
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(result.timestamp) ||
    Number.isNaN(new Date(result.timestamp).getTime())
  ) {
    throw new Error("高德返回的位置信息无效，请重新获取");
  }
  const names = [result.address, result.aoiName, result.poiName]
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => name.trim());
  // 详细地址通常已包含 AOI / POI 名称，避免重复堆叠相同地址。
  const label = names.reduce(
    (text, name) =>
      text.includes(name) ? text : [text, name].filter(Boolean).join(" · "),
    "",
  );
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(result.accuracy) ? result.accuracy : null,
    capturedAt: new Date(result.timestamp).toISOString(),
    label: label || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    provider: "amap",
    coordinateSystem: result.coordinateSystem || "unknown",
  };
}
