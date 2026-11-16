// 从真实 Android 截图验证点击反馈与控件遮挡，仅用于只读测试模拟器。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { PNG } = require('pngjs');
const serial = process.env.SHIKE_TEST_SERIAL || 'emulator-5584';
if (!/^emulator-\d+$/.test(serial)) throw new Error('只允许操作测试模拟器');
const executable = path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe');
const adb = (...args) => execFileSync(executable, ['-s', serial, ...args]);
const directory = '.expo/image-feedback';
const xml = fs.readFileSync(path.join(directory, 'ui-1.1.2-calendar-final.xml'), 'utf8');
const nodes = [...xml.matchAll(/<node\b([^>]+)>/g)].map(match => {
  const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)]
    .map(value => [value[1], value[2]]));
  return { label: attributes['content-desc'],
    bounds: [...(attributes.bounds || '').matchAll(/\d+/g)].map(value => Number(value[0])) };
});
const gear = nodes.find(node => node.label === '打开设置');
const camera = nodes.find(node => node.label === '拍照记录');
const add = nodes.find(node => / 添加照片$/.test(node.label));
assert(gear && camera && add, '右侧入口或添加按钮缺失');
assert.equal(gear.bounds[0], camera.bounds[0], '右侧入口未对齐');
assert(gear.bounds[3] < camera.bounds[1], '右侧入口发生重叠');
const intersects = (a, b) => Math.min(a[2], b[2]) > Math.max(a[0], b[0])
  && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
assert(!intersects(add.bounds, gear.bounds) && !intersects(add.bounds, camera.bounds), '添加入口被遮挡');
assert(!nodes.some(node => /⌂\s*首页|⚙\s*设置/.test(node.label)), '底部 Tab 仍然存在');
const density = [...adb('shell', 'wm', 'density').toString().matchAll(/density:\s*(\d+)/g)].at(-1);
const scale = Number(density[1]) / 160;
assert((add.bounds[2] - add.bounds[0]) / scale >= 95, '添加按钮宽度不足');
assert((add.bounds[3] - add.bounds[1]) / scale >= 47, '添加按钮高度不足');

function screen(name) {
  const output = adb('exec-out', 'screencap', '-p');
  const signature = output.indexOf(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert(signature >= 0);
  const bytes = output.subarray(signature);
  fs.writeFileSync(path.join(directory, name + '.png'), bytes);
  return PNG.sync.read(bytes);
}

(async () => {
  const before = screen('ui-1.1.2-press-before');
  const [x1, y1, x2, y2] = add.bounds;
  const x = String(Math.floor((x1 + x2) / 2));
  const y = String(Math.floor((y1 + y2) / 2));
  const touch = spawn(executable, ['-s', serial, 'shell', 'input', 'swipe', x, y, x, y, '2200']);
  const finished = new Promise((resolve, reject) => {
    touch.on('error', reject);
    touch.on('exit', code => code === 0 ? resolve() : reject(new Error('测试触摸失败')));
  });
  await delay(600);
  const pressed = screen('ui-1.1.2-pressed');
  await finished;
  let changed = 0;
  for (let row = y1; row < y2; row++) for (let column = x1; column < x2; column++) {
    const pixel = (row * before.width + column) * 4;
    if (Math.abs(before.data[pixel] - pressed.data[pixel]) > 15) changed++;
  }
  assert(changed > 1000, '按住按钮未产生明显的像素反馈');
  console.log(JSON.stringify({ aligned: true, unobscured: true, tabBarRemoved: true,
    addWidthDp: (x2 - x1) / scale, addHeightDp: (y2 - y1) / scale,
    changedPixels: changed }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
