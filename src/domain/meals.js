/** 金额以整数分保存，避免浮点误差；空白表示未记录，0 元是明确的记录。 */
export function parseCost(input) {
  const text = String(input).trim();
  if (!text) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) {
    throw new Error("请输入有效花费，最多保留两位小数");
  }
  const [yuan, cents = ""] = text.split(".");
  return Number(yuan) * 100 + Number(cents.padEnd(2, "0"));
}

/** 写入前统一校验，编辑、拍摄入档与导入不能绕过相同的数据约束。 */
export function normalizeMeal(value = {}) {
  const cost_cents = value.cost_cents ?? null;
  const rating = value.rating ?? null;
  if (
    cost_cents !== null &&
    (!Number.isSafeInteger(cost_cents) ||
      cost_cents < 0 ||
      cost_cents > 999999999)
  ) {
    throw new Error("花费超出支持范围");
  }
  if (
    rating !== null &&
    (!Number.isFinite(rating) ||
      rating < 0.5 ||
      rating > 5 ||
      !Number.isInteger(rating * 2))
  ) {
    throw new Error("评分应为 0.5 至 5 星，也可以不评分");
  }
  let location = value.location ?? null;
  if (location) {
    if (
      !Number.isFinite(location.latitude) ||
      Math.abs(location.latitude) > 90 ||
      !Number.isFinite(location.longitude) ||
      Math.abs(location.longitude) > 180
    ) {
      throw new Error("位置信息无效，请重新获取");
    }
    location = {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: Number.isFinite(location.accuracy) ? location.accuracy : null,
      capturedAt: location.capturedAt || new Date().toISOString(),
      label: String(location.label || "当前位置")
        .trim()
        .slice(0, 120),
      // 老记录没有来源与坐标系标识时保持未知，不静默转换历史坐标。
      provider: ["amap", "system"].includes(location.provider)
        ? location.provider
        : null,
      coordinateSystem: ["GCJ-02", "WGS84", "unknown"].includes(
        location.coordinateSystem,
      )
        ? location.coordinateSystem
        : null,
      poiId:
        typeof location.poiId === "string"
          ? location.poiId.slice(0, 100)
          : null,
      poiName:
        typeof location.poiName === "string"
          ? location.poiName.slice(0, 120)
          : null,
      address:
        typeof location.address === "string"
          ? location.address.slice(0, 240)
          : null,
    };
  }
  return { cost_cents, rating, location };
}

export function mealFromPhoto(photo) {
  let location = null;
  try {
    location = photo.location_json ? JSON.parse(photo.location_json) : null;
  } catch {
    /* 旧扩展信息异常不影响照片浏览。 */
  }
  return {
    cost_cents: photo.cost_cents ?? null,
    rating: photo.rating ?? null,
    location,
  };
}

/** 日期由调用方先筛选；组与组内照片均按拍摄时间升序，时间相同时按 ID 稳定排序。 */
export function groupMeals(photos) {
  const groups = new Map();
  for (const photo of photos) {
    const id = photo.group_id || `legacy-${photo.day_key}`;
    if (!groups.has(id))
      groups.set(id, {
        id,
        started_at: photo.group_started_at || photo.captured_at,
        legacy: id.startsWith("legacy-"),
        ...mealFromPhoto(photo),
        photos: [],
      });
    groups.get(id).photos.push(photo);
  }
  const byTime = (a, b) =>
    a.captured_at.localeCompare(b.captured_at) || a.id.localeCompare(b.id);
  for (const group of groups.values()) group.photos.sort(byTime);
  return [...groups.values()].sort(
    (a, b) =>
      a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id),
  );
}
