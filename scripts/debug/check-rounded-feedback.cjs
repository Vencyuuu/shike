// 对实际 APK 长按截图取样：圆角外不能出现矩形涟漪，圆角内必须有可见反馈。
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { PNG } = require("pngjs");
const [snapshot, label, output] = process.argv.slice(2);
const serial = process.env.SHIKE_TEST_SERIAL || "emulator-5584";
assert(/^emulator-\d+$/.test(serial), "只操作隔离测试模拟器");
const adbPath = path.join(process.env.ANDROID_HOME, "platform-tools/adb.exe");
const adb = (...args) => execFileSync(adbPath, ["-s", serial, ...args], {
  maxBuffer: 32 * 1024 * 1024,
});
const directory = ".expo/image-feedback";
const xml = fs.readFileSync(`${directory}/${snapshot}.xml`, "utf8");
const node = [...xml.matchAll(/<node\b([^>]+)>/g)].map((match) =>
  Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)]
    .map((entry) => [entry[1], entry[2]])),
).find((item) => item["content-desc"] === label);
assert(node, `缺少测试按钮：${label}`);
const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number);

function screen(suffix) {
  const raw = adb("exec-out", "screencap", "-p");
  const start = raw.indexOf(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert(start >= 0);
  const bytes = raw.subarray(start);
  fs.writeFileSync(`${directory}/${output}-${suffix}.png`, bytes);
  return PNG.sync.read(bytes);
}

(async () => {
  const before = screen("before");
  const x = String(Math.round((x1 + x2) / 2));
  const y = String(Math.round((y1 + y2) / 2));
  const touch = spawn(adbPath, ["-s", serial, "shell", "input", "swipe",
    x, y, x, y, "2400"]);
  const finished = new Promise((resolve, reject) => {
    touch.on("error", reject);
    touch.on("exit", (code) => code === 0 ? resolve() : reject(new Error("触摸失败")));
  });
  await delay(600);
  const pressed = screen("pressed");
  await finished;
  const radius = (y2 - y1) / 2;
  let leaked = 0;
  let feedback = 0;
  for (let row = y1 + 5; row < y2 - 5; row++) {
    for (let column = x1 + 5; column < x2 - 5; column++) {
      const pixel = (row * before.width + column) * 4;
      const change = Math.max(...[0, 1, 2].map((channel) =>
        Math.abs(before.data[pixel + channel] - pressed.data[pixel + channel])));
      if (change < 12) continue;
      feedback++;
      const cx = Math.max(x1 + radius, Math.min(x2 - radius, column));
      const cy = (y1 + y2) / 2;
      // 留出抗锯齿与按压缩放余量，只检查距外轮廓 6px 以上的角落。
      if (Math.hypot(column - cx, row - cy) > radius + 6) leaked++;
    }
  }
  console.log(JSON.stringify({ label, feedback, leaked }));
  assert(feedback > 100, "没有可见按压反馈");
  assert(leaked < 20, "按压背景超出圆角轮廓");
})().catch((error) => { console.error(error); process.exitCode = 1; });
