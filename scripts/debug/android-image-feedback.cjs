// 仅操作本次测试模拟器，避免误将回归脚本应用到用户真机。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PNG } = require('pngjs');
const serial = process.env.SHIKE_TEST_SERIAL || 'emulator-5584';
if (!/^emulator-\d+$/.test(serial)) throw new Error('回归脚本只允许操作模拟器');
const executable = path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe');
// 相机取景截图可能超过 Node 默认的 1 MiB 缓冲区。
const adb = (...args) => execFileSync(executable, ['-s', serial, ...args], {
  maxBuffer: 32 * 1024 * 1024,
});
const directory = '.expo/image-feedback';
fs.mkdirSync(directory, { recursive: true });

function snapshot(name = 'current') {
  let dumped = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const output = adb('shell', 'uiautomator', 'dump', '/sdcard/shike-image-feedback.xml').toString();
    if (output.includes('dumped to')) { dumped = true; break; }
  }
  if (!dumped) throw new Error('页面尚未稳定，不能复用之前的控件树');
  const xml = adb('shell', 'cat', '/sdcard/shike-image-feedback.xml').toString();
  fs.writeFileSync(path.join(directory, name + '.xml'), xml);
  const screenshot = adb('exec-out', 'screencap', '-p');
  // 折叠屏模拟器可能在 PNG 前输出多显示器提示，按签名截取真实图片数据。
  const signature = screenshot.indexOf(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (signature < 0) throw new Error('测试模拟器未返回有效截图');
  const png = screenshot.subarray(signature);
  fs.writeFileSync(path.join(directory, name + '.png'), png);
  const nodes = [...xml.matchAll(/<node\b([^>]+)>/g)].map(match => {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)]
      .map(attribute => [attribute[1], attribute[2]]));
    const bounds = [...(attributes.bounds || '').matchAll(/\d+/g)].map(value => Number(value[0]));
    return { ...attributes, bounds };
  });
  return { nodes, png: PNG.sync.read(png) };
}

const [command, value] = process.argv.slice(2);
let result = snapshot(command === 'capture' ? value : 'current');
if (command === 'tap') {
  // DocumentsUI 把文件名、大小和时间合成一个无障碍标签，按完整文件名定位该项。
  const find = () => result.nodes.find(node => node['content-desc'] === value || node.text === value
    || (/\.(jpg|jpeg|png)$/i.test(value) && node['content-desc']?.startsWith(value + ', ')));
  let node = find();
  // 相机在异步拍摄时会暂时禁用快门，必须等可用再点击，避免测试本身漏拍。
  for (let attempt = 0; attempt < 5 && (!node || node.enabled === 'false'); attempt++) {
    result = snapshot('waiting');
    node = find();
  }
  if (!node) throw new Error(`未找到控件：${value}`);
  if (node.enabled === 'false') throw new Error(`控件尚不可用：${value}`);
  const [x1, y1, x2, y2] = node.bounds;
  adb('shell', 'input', 'tap', String(Math.floor((x1 + x2) / 2)), String(Math.floor((y1 + y2) / 2)));
} else if (command === 'assert-photos') {
  const nodes = result.nodes.filter(node => /^(照片 \d+|\d{4}-\d{2}-\d{2} 的第 \d+ 张照片)/
    .test(node['content-desc'] || ''));
  const visible = nodes.filter(node => node.bounds[2] - node.bounds[0] >= 60
    && node.bounds[3] - node.bounds[1] >= 60);
  console.log(JSON.stringify({ expected: Number(value), visible: visible.length, nodes }, null, 2));
  if (visible.length < Number(value)) process.exitCode = 1;
} else {
  for (const node of result.nodes) {
    if (node.text || node['content-desc']) console.log(node.text, node['content-desc'], node.bounds);
  }
}
