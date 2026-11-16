// 使用真实 APK 的控件树与截图验证布局，不依赖 JSX 或样式实现细节。
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const directory = ".expo/image-feedback";
function read(name) {
  const xml = fs.readFileSync(`${directory}/${name}.xml`, "utf8");
  const nodes = [...xml.matchAll(/<node\b([^>]+)>/g)].map((match) => {
    const node = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((value) => [
        value[1],
        value[2],
      ]),
    );
    node.bounds = [...node.bounds.matchAll(/\d+/g)].map((value) =>
      Number(value[0]),
    );
    return node;
  });
  return {
    nodes,
    png: PNG.sync.read(fs.readFileSync(`${directory}/${name}.png`)),
  };
}
function control(page, label) {
  const node = page.nodes.find((item) => item["content-desc"] === label);
  assert(node, `缺少操作：${label}`);
  return node.bounds;
}
function centered(page, label) {
  const button = control(page, label);
  const text = page.nodes.find((item) => item.text === label)?.bounds;
  assert(text, `缺少文字：${label}`);
  assert(
    Math.abs(button[0] + button[2] - text[0] - text[2]) <= 3,
    `${label} 未水平居中`,
  );
  assert(
    Math.abs(button[1] + button[3] - text[1] - text[3]) <= 3,
    `${label} 未垂直居中`,
  );
}
const home = read("ui-1.1.3-home");
const camera = control(home, "拍照记录");
const settings = control(home, "打开设置");
assert(home.nodes.some((item) => item.text === "记录每一餐"));
assert.equal(camera[0], settings[0]);
assert(camera[3] < settings[1], "拍摄必须位于设置上方，且不重叠");
assert(
  !home.nodes.some((item) => item.text === "拍摄" || item.text === "设置"),
);
const review = read("ui-1.1.3-review");
const select = control(review, "全部取消");
const resume = control(review, "继续拍摄");
assert(
  resume[0] > 40 && resume[2] < review.png.width - 40,
  "继续拍摄缺少左右边距",
);
assert(resume[1] - select[3] >= 30, "筛选操作间距不足");
centered(review, "取消");
centered(review, "完成 (2)");
centered(review, "全部取消");
centered(review, "继续拍摄");
assert.equal(
  review.nodes.filter((item) => /^照片 \d+$/.test(item["content-desc"])).length,
  2,
);
// 工具栏空白区域必须保持纯黑，防止共享组件重新引入常驻灰色胶囊。
const cancel = control(review, "取消");
const offset = ((cancel[1] + 4) * review.png.width + cancel[0] + 4) * 4;
assert(review.png.data[offset] < 10, "工具栏出现多余底色");
const full = read("ui-1.1.3-review-12");
assert.equal(
  full.nodes.filter((item) => /^照片 \d+$/.test(item["content-desc"])).length,
  12,
);
const small = read("ui-1.1.3-small-bottom");
const smallResume = control(small, "继续拍摄");
assert(
  smallResume[1] > 0 && smallResume[3] < small.png.height - 60,
  "小屏滚动后继续拍摄仍不可达",
);
const calendar = read("ui-1.1.3-calendar");
const addNode = calendar.nodes.find((item) =>
  / 添加照片$/.test(item["content-desc"]),
);
assert(addNode, "缺少日历添加入口");
const add = addNode.bounds;
const intersects = (a, b) =>
  Math.min(a[2], b[2]) > Math.max(a[0], b[0]) &&
  Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
assert(
  !intersects(add, control(calendar, "拍照记录")),
  "日历添加按钮被拍摄入口遮挡",
);
assert(add[2] - add[0] < 190, "添加入口仍然过大");
console.log(
  "通过：首页图标顺序、slogan、双张筛选、文字居中、边距与间隔、透明工具栏。",
);
