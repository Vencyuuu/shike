// 从用户选定的原稿生成 Android 密度资源；只缩放与适配系统遮罩，不改变设计。
const fs = require("node:fs");
const path = require("node:path");
const Jimp = require("jimp-compact");
const resources = path.resolve(__dirname, "../android/app/src/main/res");

(async () => {
  const source = await Jimp.read(path.resolve(
    __dirname, "../assets/branding/shike-icon-c4-upright.png",
  ));
  for (const [density, size] of Object.entries({
    mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192,
  })) {
    const folder = path.join(resources, `mipmap-${density}`);
    const icon = source.clone().resize(size, size);
    await icon.writeAsync(path.join(folder, "ic_launcher.png"));
    await icon.clone().circle().writeAsync(path.join(folder, "ic_launcher_round.png"));
    // 同名旧 WebP 必须移除，否则 Android 会报告重复资源；只处理这两个固定文件。
    for (const name of ["ic_launcher.webp", "ic_launcher_round.webp"]) {
      const old = path.join(folder, name);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
  }
  await source.clone().resize(512, 512).writeAsync(
    path.join(resources, "drawable/shike_launcher_art.png"),
  );
  const adaptive = path.join(resources, "mipmap-anydpi-v26");
  fs.mkdirSync(adaptive, { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/shike_icon_background" />
  <foreground android:drawable="@drawable/shike_launcher_foreground" />
</adaptive-icon>
`;
  for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
    fs.writeFileSync(path.join(adaptive, name), xml);
  }
  fs.writeFileSync(path.join(resources, "drawable/shike_launcher_foreground.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<!-- 适应圆形、圆角矩形等启动器遮罩，保护相框与餐具不被裁切。 -->
<inset xmlns:android="http://schemas.android.com/apk/res/android"
  android:inset="16.6667%">
  <bitmap android:src="@drawable/shike_launcher_art" android:gravity="fill" />
</inset>
`);
  fs.writeFileSync(path.join(resources, "values/shike_icon.xml"),
    '<resources><color name="shike_icon_background">#1c1c1c</color></resources>\n');
  console.log("已生成 C4 摆正版图标及 Android 自适应资源");
})().catch((error) => { console.error(error); process.exitCode = 1; });
