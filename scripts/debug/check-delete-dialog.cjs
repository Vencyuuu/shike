// 用实际 APK 的截图与控件树检查删除入口和弹窗，不通过读取样式常量断言结果。
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
function read(name) {
  const base = `.expo/image-feedback/ui-1.1.4-${name}`;
  const xml = fs.readFileSync(base + ".xml", "utf8");
  const nodes = [...xml.matchAll(/<node\b([^>]+)>/g)].map((match) => {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((value) => [
        value[1],
        value[2],
      ]),
    );
    return {
      ...attributes,
      bounds: [...attributes.bounds.matchAll(/\d+/g)].map((value) =>
        Number(value[0]),
      ),
    };
  });
  return { nodes, image: PNG.sync.read(fs.readFileSync(base + ".png")) };
}
function bounds(page, label, control = true) {
  const node = page.nodes.find(
    (value) => value[control ? "content-desc" : "text"] === label,
  );
  assert(node, `未找到：${label}`);
  return node.bounds;
}
const detail = read("detail");
const headerDelete = bounds(detail, "删除");
const pixel =
  ((headerDelete[1] + 5) * detail.image.width + headerDelete[0] + 5) * 4;
assert(detail.image.data[pixel + 1] > 250, "详情删除入口仍有淡红色背景");
const dialog = read("delete");
const cancel = bounds(dialog, "取消");
const remove = bounds(dialog, "删除");
const caption = bounds(
  dialog,
  "将从记录中移除选中的照片，记录本身不可恢复。",
  false,
);
assert(
  Math.abs(cancel[2] - cancel[0] - (remove[2] - remove[0])) <= 2,
  "按钮未等宽",
);
assert.equal(cancel[1], remove[1], "按钮不在同一行");
assert(remove[0] - cancel[2] >= 30, "按钮间距不足");
assert.equal(cancel[0], caption[0], "取消未与内容左侧对齐");
assert.equal(remove[2], caption[2], "删除未与内容右侧对齐");
bounds(dialog, "同时删除源文件（不可恢复）", false);
assert(
  !dialog.nodes.some((value) =>
    value.text.includes("同时从系统相册删除源文件"),
  ),
);
assert(
  read("next").nodes.some((value) => value.text === "2 / 2"),
  "取消后记录数变化或翻页失败",
);
assert(
  read("deleted").nodes.some((value) => value.text === "1 / 1"),
  "确认删除未只移除一条记录",
);
console.log(
  "通过：透明删除入口、等宽满行按钮、按钮间隔、内容对齐、新文案、取消与确认删除。",
);
