// 对真实 APK 截图配套的控件树进行断言，覆盖时间轴、分组蒙层和可选元数据。
const fs = require("node:fs");
const assert = require("node:assert/strict");
const read = (name) =>
  fs.readFileSync(`.expo/image-feedback/meals-${name}.xml`, "utf8");
const timeline = read("timeline-final");
assert.equal(
  (timeline.match(/content-desc="2026-11-12 的第 \d+ 张照片"/g) || []).length,
  4,
);
assert(
  !timeline.includes("Xiamen_lunch") && !timeline.includes("Fuzhou_breakfast"),
  "时间轴意外出现分组元数据",
);
const xiamen = read("group-xiamen");
const fuzhou = read("group-fuzhou");
assert(
  xiamen.includes("Xiamen_lunch") &&
    xiamen.includes("68.50") &&
    xiamen.includes("3.5 / 5"),
);
assert(
  !xiamen.includes("Fuzhou_breakfast") && !xiamen.includes("18.60"),
  "元数据跨餐次混用",
);
assert(
  fuzhou.includes("Fuzhou_breakfast") &&
    fuzhou.includes("18.60") &&
    fuzhou.includes("4.5 / 5"),
);
assert(read("rating-45").includes("当餐评分, 4.5 星"), "半星滑动未生效");
assert(read("rating-cleared").includes("当餐评分, 未评分"), "评分未能清除");
assert(read("fuzhou-final").includes("26.0745, 119.2965"), "第一组定位未回填");
assert(
  read("xiamen-confirm").includes("24.4798, 118.0894"),
  "第二组定位未回填",
);
assert(read("denied").includes("未获得定位权限"), "拒绝权限缺少降级提示");
const empty = read("empty-group");
assert(empty.includes("未附加位置") && empty.includes("未记录花费 · 未评分"));
assert(
  !empty.includes("68.50") && !empty.includes("Xiamen_lunch"),
  "新拍摄沿用了上一餐信息",
);
console.log(
  "通过：外部图片网格、详情蒙层、半星滑动及清除、两地餐次独立、重启保留、拒绝定位及全部留空保存。",
);
