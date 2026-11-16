// 从先前构建缓存恢复的等价模块，已移除 Metro 外壳并恢复 JSX。
/** 使用设备本地年月日，避免 UTC 序列化导致午夜照片跨日。 */
function dayKey(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}
function parseDay(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function dayTitle(key) {
  const date = parseDay(key);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const label =
    key === dayKey(new Date())
      ? "今天"
      : key === dayKey(yesterday)
        ? "昨天"
        : `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return `${label} · 周${"日一二三四五六"[date.getDay()]}`;
}
function calendarCells(month) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (start.getDay() + 6) % 7;
  const count = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  return Array.from(
    {
      length: Math.ceil((offset + count) / 7) * 7,
    },
    (_, index) =>
      index < offset || index >= offset + count
        ? null
        : dayKey(
            new Date(month.getFullYear(), month.getMonth(), index - offset + 1),
          ),
  );
}
export { dayKey, parseDay, dayTitle, calendarCells };
