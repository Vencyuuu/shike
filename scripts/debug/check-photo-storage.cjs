// 读取最终 APK 在隔离模拟器的实际界面树，验证原片目录、导入归档与删除分支。
const fs = require("node:fs");
const assert = require("node:assert/strict");
const directory = process.argv[2] || ".expo/image-feedback";
const read = (name) => fs.readFileSync(`${directory}/storage-${name}.xml`, "utf8");
function sourceSwitch(name) {
  const tag = read(name).match(/<node[^>]*content-desc="同时删除源文件"[^>]*>/)?.[0];
  assert(tag, `${name} 缺少删除开关`);
  return tag;
}
assert(read("upgraded").includes("1 张"), "升级丢失了旧记录");
assert(read("default-saved").includes("2 张"), "默认目录拍摄未入档");
assert(read("custom-settings").includes("自选目录：primary:Documents"));
assert(read("custom-saved").includes("3 张"));
assert(sourceSwitch("custom-delete-dialog").includes('enabled="true"'));
assert(read("custom-deleted").includes("2 / 2"));
assert(read("imported-date").includes("2026-11-15 的第 1 张照片"));
assert(!read("imported-date").includes("加入哪一天"), "仍在重复询问导入日期");
assert(sourceSwitch("import-delete-dialog").includes('enabled="true"'));
assert(read("system-delete").includes("delete this photo"));
assert(read("delete-denied").includes("已取消删除源文件，应用记录已保留"));
assert(read("delete-retained").includes("1 / 1"));
assert(!read("import-source-deleted").includes("2026-11-15 的第 1 张照片"));
assert(read("legacy-dialog").includes("关联原图（请选择同一张照片）"));
assert(sourceSwitch("legacy-dialog").includes('enabled="false"'));
assert(sourceSwitch("legacy-linked").includes('enabled="true"'));
assert(!read("legacy-linked").includes("旧记录未保留源文件引用"));
assert(read("restarted-settings").includes("自选目录：primary:Documents"));
assert(read("record-only-deleted").includes("2 / 2"));
console.log("通过：升级保留、原片目录、指定日期直导、源文件删除与取消、旧记录关联入口。");
