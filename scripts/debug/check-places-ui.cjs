// 读取最终 APK 的实际截图与控件树，验证地点选择和主题切换。
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const directory = process.argv[2] || ".expo/image-feedback";

function page(name) {
  const xml = fs.readFileSync(`${directory}/places-${name}.xml`, "utf8");
  const nodes = [...xml.matchAll(/<node\b([^>]+)>/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((entry) => [
        entry[1], entry[2],
      ]),
    ),
  );
  return { xml, nodes };
}

function control(name, label) {
  const node = page(name).nodes.find((item) => item["content-desc"] === label);
  assert(node, `缺少操作：${name} / ${label}`);
  return node;
}

function bounds(node) {
  return node.bounds.match(/\d+/g).map(Number);
}

// 三个入口并排、等宽，位置入口直接可见。
const actions = ["花费", "评个分吧", "位置"].map((label) =>
  bounds(control("review-actions", label)),
);
assert(actions.every((box) => box[1] === actions[0][1]));
assert(actions.every((box) => Math.abs(box[2] - box[0] - 304) <= 1));

// 未选择时不能确认；选中后才允许附加，并保留具体商户。
assert.equal(control("fuzhou-results", "使用这个位置").enabled, "false");
assert.equal(control("selected", "使用这个位置").enabled, "true");
assert.equal(
  control("selected", "选择地点 肯德基(福州茶亭店)").checked,
  "true",
);
assert(page("fuzhou-results").nodes.filter((item) =>
  item["content-desc"].startsWith("选择地点 "),
).length >= 3);
assert(page("search-results").xml.includes('text="KFC"'));
assert(page("search-results").xml.includes("肯德基"));
for (const name of ["detail-dark", "detail-light", "restarted-selection"]) {
  assert(page(name).xml.includes("肯德基(福州茶亭店)"), `${name} 地点丢失`);
}

// 顶部文字已放大，小屏弹窗的确认操作仍处于可见区域。
for (const label of ["返回", "删除"]) {
  const node = page("detail-light").nodes.find((item) => item.text === label);
  const box = bounds(node);
  assert(box[3] - box[1] >= 60);
}
const small = bounds(control("picker-small", "使用这个位置"));
assert(small[0] > 0 && small[2] < 960 && small[3] < 1600);

// 使用空白背景像素确认真实渲染颜色，涵盖手动、跟随系统与重启。
for (const [name, dark] of [
  ["settings-dark", true], ["night-restarted", true],
  ["system-dark", true], ["system-light", false], ["settings-day", false],
]) {
  const png = PNG.sync.read(fs.readFileSync(`${directory}/places-${name}.png`));
  const value = png.data[(100 * png.width + 20) * 4];
  assert(dark ? value < 30 : value > 240, `${name} 背景颜色不符`);
}
console.log("通过：同级入口、地点选择与搜索、保存及重启、顶部导航、小屏与主题切换。");
