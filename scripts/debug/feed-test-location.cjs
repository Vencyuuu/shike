// 仅给隔离 Android 模拟器发送新鲜坐标，覆盖定位订阅建立后的多个采样时刻。
const { execFileSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const path = require("node:path");
const serial = process.env.SHIKE_TEST_SERIAL || "emulator-5584";
if (!/^emulator-\d+$/.test(serial)) throw new Error("仅允许使用测试模拟器");
const [latitude, longitude] = process.argv.slice(2).map(Number);
if (
  !Number.isFinite(latitude) ||
  Math.abs(latitude) > 90 ||
  !Number.isFinite(longitude) ||
  Math.abs(longitude) > 180
) {
  throw new Error("请输入有效的测试纬度与经度");
}
const adb = path.join(process.env.ANDROID_HOME, "platform-tools", "adb.exe");
(async () => {
  for (let index = 0; index < 8; index++) {
    for (const provider of ["gps", "network"]) {
      execFileSync(adb, [
        "-s",
        serial,
        "shell",
        "cmd",
        "location",
        "providers",
        "set-test-provider-location",
        provider,
        "--location",
        `${latitude},${longitude}`,
        "--accuracy",
        "10",
      ]);
    }
    await delay(800);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
