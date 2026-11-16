// 使用实际 APK 的界面树检查高德同意、取消、地址回填与持久化流程。
const fs = require("node:fs");
const assert = require("node:assert/strict");
const read = (name) =>
  fs.readFileSync(`.expo/image-feedback/amap-${name}.xml`, "utf8");
assert(read("consent").includes("使用高德定位"));
assert(read("consent").includes("同意并继续"));
assert(!read("declined").includes("正在获取位置"), "拒绝使用后仍发起定位");
assert(read("cancelled").includes("附加当前位置"));
assert(!read("cancelled").includes("正在获取位置"), "跳过后仍在等待定位");
assert(read("privacy-settings").includes("撤回同意"));
assert(read("consent-after-revoke").includes("使用高德定位"));
const result = read("final-result");
assert(result.includes("福建省福州市"), "高德没有返回测试坐标的中文地址");
assert(result.includes("26.0714, 119.3013"), "高德 GCJ-02 坐标回填不符");
assert(read("saved").includes("福建省福州市"));
assert(read("restarted").includes("福建省福州市"), "重启后餐次地址丢失");
console.log(
  "通过：高德同意与拒绝、取消定位、撤回后重新询问、SDK 中文地址回填、保存与重启保留。",
);
