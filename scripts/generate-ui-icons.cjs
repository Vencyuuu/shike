// 在高分辨率采样后缩小，生成透明的单色线性图标；运行时由主题 tintColor 着色。
const fs = require("node:fs");
const { PNG } = require("pngjs");
const size = 104;
const samples = 4;
const gear = [];
for (let tooth = 0; tooth < 8; tooth++) {
  for (const [angle, radius] of [
    [-0.5, 9],
    [-0.28, 9],
    [-0.28, 11],
    [0.28, 11],
    [0.28, 9],
    [0.5, 9],
  ]) {
    const theta = ((tooth + angle) * Math.PI) / 4;
    gear.push([13 + Math.cos(theta) * radius, 13 + Math.sin(theta) * radius]);
  }
}
function lineDistance(x, y, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
function ink(name, x, y) {
  // 返回箭头和垃圾桶使用同样的线宽，避免字体图标在不同系统上大小不一致。
  if (name === "back" || name === "trash") {
    const segments =
      name === "back"
        ? [
            [
              [16, 4],
              [7, 13],
            ],
            [
              [7, 13],
              [16, 22],
            ],
          ]
        : [
            [
              [5, 7],
              [21, 7],
            ],
            [
              [10, 4],
              [16, 4],
            ],
            [
              [10, 4],
              [10, 7],
            ],
            [
              [16, 4],
              [16, 7],
            ],
            [
              [7, 7],
              [8, 22],
            ],
            [
              [8, 22],
              [18, 22],
            ],
            [
              [18, 22],
              [19, 7],
            ],
            [
              [11, 11],
              [11, 18],
            ],
            [
              [15, 11],
              [15, 18],
            ],
          ];
    return segments.some(([a, b]) => lineDistance(x, y, a, b) < 0.95);
  }
  if (name === "settings") {
    return (
      Math.abs(Math.hypot(x - 13, y - 13) - 3.6) < 0.9 ||
      gear.some(
        (a, i) => lineDistance(x, y, a, gear[(i + 1) % gear.length]) < 0.85,
      )
    );
  }
  const qx = Math.abs(x - 13) - 6.3,
    qy = Math.abs(y - 13) - 6.3;
  const roundedBox =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    3.4;
  return (
    Math.abs(roundedBox) < 0.9 ||
    Math.abs(Math.hypot(x - 13, y - 13) - 4.3) < 0.9 ||
    Math.hypot(x - 19, y - 7) < 1.2
  );
}
fs.mkdirSync("assets/icons", { recursive: true });
for (const name of ["camera", "settings", "back", "trash"]) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++) {
          if (
            ink(
              name,
              (x + (sx + 0.5) / samples) / 4,
              (y + (sy + 0.5) / samples) / 4,
            )
          )
            covered++;
        }
      const offset = (y * size + x) * 4;
      png.data[offset + 3] = Math.round((255 * covered) / samples ** 2);
    }
  fs.writeFileSync(`assets/icons/${name}.png`, PNG.sync.write(png));
}
