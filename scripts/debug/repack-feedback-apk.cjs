// 仅用于模拟器回归：保留基线原生代码，替换业务字节码后再由官方工具对齐、签名。
// 正式交付包仍通过 Gradle 从完整源码构建。
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync, zipSync } = require('fflate');
const [baseline, exportDirectory, output] = process.argv.slice(2);
for (const target of [baseline, exportDirectory, output]) {
  if (!path.resolve(target).startsWith(process.cwd() + path.sep)) {
    throw new Error('回归构建路径必须位于当前工作区');
  }
}
const metadata = JSON.parse(fs.readFileSync(path.join(exportDirectory, 'metadata.json')));
const bundle = fs.readFileSync(path.join(exportDirectory, metadata.fileMetadata.android.bundle));
const files = unzipSync(fs.readFileSync(baseline));
files['assets/index.android.bundle'] = bundle;
for (const name of Object.keys(files)) {
  if (/^META-INF\/.*\.(SF|RSA|DSA|MF)$/i.test(name)) delete files[name];
}
// native .so 保持不压缩，之后用 zipalign -P 16 保证原生库可直接映射。
fs.writeFileSync(output, zipSync(files, { level: 0 }));
console.log(output, bundle.length);
