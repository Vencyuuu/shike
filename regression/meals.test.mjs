import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCost, normalizeMeal, groupMeals } from "../src/domain/meals.js";
import { migrations } from "../src/data/schema.js";
import { encodeBackup, decodeBackup } from "../src/domain/backup-format.js";

test("金额保存到分：未填写、零元、两位小数与非法输入互不混淆", () => {
  assert.equal(parseCost(""), null);
  assert.equal(parseCost("0"), 0);
  assert.equal(parseCost("18.6"), 1860);
  assert.equal(parseCost("39.99"), 3999);
  for (const value of ["-1", "1.001", "1e3", "1,200", "Infinity"])
    assert.throws(() => parseCost(value));
});
test("评分可为空，仅接受半星步进；位置必须为合法经纬度", () => {
  assert.deepEqual(normalizeMeal(), {
    cost_cents: null,
    rating: null,
    location: null,
  });
  assert.equal(normalizeMeal({ rating: 4.5 }).rating, 4.5);
  for (const rating of [0, 5.5, 3.2, NaN])
    assert.throws(() => normalizeMeal({ rating }));
  assert.throws(() =>
    normalizeMeal({ location: { latitude: 100, longitude: 118 } }),
  );
});
test("同日福州早餐与厦门午餐保持两组，按时间排序并保留各自元数据", () => {
  const photo = (id, group, time, cost, city) => ({
    id,
    group_id: group,
    day_key: "2026-11-12",
    captured_at: `2026-11-12T${time}:00.000Z`,
    group_started_at: `2026-11-12T${group === "breakfast" ? "00:00" : "04:00"}:00.000Z`,
    cost_cents: cost,
    location_json: JSON.stringify({ label: city }),
  });
  const input = [
    photo("3", "lunch", "04:00", 6800, "厦门餐厅"),
    photo("2", "breakfast", "00:05", 1800, "福州"),
    photo("1", "breakfast", "00:00", 1800, "福州"),
  ];
  const groups = groupMeals(input);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["breakfast", "lunch"],
  );
  assert.deepEqual(
    groups[0].photos.map((value) => value.id),
    ["1", "2"],
  );
  assert.equal(groups[0].location.label, "福州");
  assert.equal(groups[1].cost_cents, 6800);
  assert.equal(input[0].id, "3");
});
test("真实 SQLite 迁移保留旧照片，历史组可编辑，组内删除不会误删另一餐", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(migrations[0].sql);
    db.exec("INSERT INTO day_entries(day_key) VALUES ('2026-11-12')");
    db.exec(
      "INSERT INTO photo_items(id,day_key,original_path,thumb_path,captured_at,sort_index) VALUES ('old','2026-11-12','a.jpg','b.jpg','2026-11-12T00:00:00Z',0)",
    );
    db.exec(migrations[1].sql);
    assert.equal(
      db.prepare("SELECT group_id FROM photo_items").get().group_id,
      "legacy-2026-11-12",
    );
    db.exec(
      "INSERT INTO meal_groups(id,started_at,cost_cents,rating,location_json) VALUES ('lunch','2026-11-12T04:00:00Z',6800,4.5,'{\"label\":\"厦门\"}')",
    );
    db.exec(
      "INSERT INTO photo_items(id,day_key,original_path,thumb_path,captured_at,sort_index,group_id) VALUES ('new','2026-11-12','c.jpg','d.jpg','2026-11-12T04:00:00Z',1,'lunch')",
    );
    assert.throws(() =>
      db.exec("UPDATE meal_groups SET rating=3.2 WHERE id='lunch'"),
    );
    db.exec(
      "DELETE FROM photo_items WHERE id='old'; DELETE FROM meal_groups WHERE id NOT IN (SELECT group_id FROM photo_items WHERE group_id IS NOT NULL)",
    );
    assert.equal(db.prepare("SELECT * FROM meal_groups").get().id, "lunch");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
  }
});
test("v1 与 v2 备份均可读取，未来版本拒绝恢复", () => {
  const files = { "database/foodlog.db": new TextEncoder().encode("fixture") };
  assert.equal(
    decodeBackup(encodeBackup(files, 0, 0, 1)).manifest.db_schema_version,
    1,
  );
  assert.equal(
    decodeBackup(encodeBackup(files, 0, 0, 2)).manifest.db_schema_version,
    2,
  );
  assert.throws(() => decodeBackup(encodeBackup(files, 0, 0, 3)), /版本不兼容/);
});

test("真实 SQLite 数据经过备份封装与恢复后保留餐次、照片关联和可选信息", () => {
  const directory = mkdtempSync(join(tmpdir(), "shike-meal-backup-"));
  const source = join(directory, "source.db");
  const restored = join(directory, "restored.db");
  let database;
  try {
    database = new DatabaseSync(source);
    for (const migration of migrations) database.exec(migration.sql);
    database.exec(
      "PRAGMA user_version=2; INSERT INTO day_entries(day_key) VALUES ('2026-11-12')",
    );
    database
      .prepare(
        "INSERT INTO meal_groups(id,started_at,cost_cents,rating,location_json) VALUES (?,?,?,?,?)",
      )
      .run(
        "breakfast",
        "2026-11-12T00:00:00Z",
        1860,
        4.5,
        JSON.stringify({
          latitude: 26.0745,
          longitude: 119.2965,
          label: "福州早餐",
        }),
      );
    database.exec(
      "INSERT INTO photo_items(id,day_key,original_path,thumb_path,captured_at,sort_index,group_id) VALUES ('photo','2026-11-12','media/Originals/photo.jpg','media/Thumbs/photo.jpg','2026-11-12T00:00:00Z',0,'breakfast')",
    );
    database.close();
    database = null;
    const archive = encodeBackup(
      {
        "database/foodlog.db": readFileSync(source),
        "media/Originals/photo.jpg": new Uint8Array([1, 2, 3]),
        "media/Thumbs/photo.jpg": new Uint8Array([4, 5]),
      },
      1,
      1,
    );
    const decoded = decodeBackup(archive);
    writeFileSync(restored, decoded.files["database/foodlog.db"]);
    database = new DatabaseSync(restored);
    const meal = database
      .prepare(
        "SELECT g.* FROM meal_groups g JOIN photo_items p ON p.group_id=g.id WHERE p.id=?",
      )
      .get("photo");
    assert.equal(meal.cost_cents, 1860);
    assert.equal(meal.rating, 4.5);
    assert.equal(JSON.parse(meal.location_json).label, "福州早餐");
    assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    database?.close();
    for (const file of [source, restored]) {
      try {
        unlinkSync(file);
      } catch {
        /* 中断用例时允许文件尚未生成。 */
      }
    }
    rmdirSync(directory);
  }
});
