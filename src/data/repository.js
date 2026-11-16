// 从先前构建缓存恢复的等价模块，已移除 Metro 外壳并恢复 JSX。
import * as SQLite from "expo-sqlite";
import * as expoFileSystem from "expo-file-system";
import * as expoImageManipulator from "expo-image-manipulator";
import * as Domain from "../domain/model";
import * as BackupFormat from "../domain/backup-format";
import { copyPreparedMedia } from "./media-write";
import { migrations } from "./schema";
import { normalizeMeal } from "../domain/meals";
import { saveCaptureSource } from "../services/photos";
class Repository {
  root = new expoFileSystem.Directory(expoFileSystem.Paths.document, "shike");
  readOnly = false;
  warning = null;
  async initialize() {
    this.root.create({
      intermediates: true,
      idempotent: true,
    });
    this.catalog = await SQLite.openDatabaseAsync(
      "catalog.db",
      {},
      this.root.uri,
    );
    await this.catalog.execAsync(
      "CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const active = await this.catalog.getFirstAsync(
      "SELECT value FROM state WHERE key = ?",
      "active",
    );
    const id = active?.value ?? `generation-${Date.now()}`;
    this.generation = new expoFileSystem.Directory(this.root, id);
    this.generation.create({
      intermediates: true,
      idempotent: true,
    });
    this.db = await SQLite.openDatabaseAsync(
      "foodlog.db",
      {},
      this.generation.uri,
    );
    await this.db.execAsync(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;",
    );
    const current = await this.version(this.db);
    if (current > BackupFormat.SCHEMA_VERSION) {
      this.readOnly = true;
      this.warning = "此数据由更新版本创建，请升级 App";
    } else {
      try {
        if (current > 0 && current < BackupFormat.SCHEMA_VERSION)
          await this.createBackup("pre-migration");
        await this.migrate(this.db, current);
      } catch (error) {
        this.readOnly = true;
        this.warning = `数据升级失败，已保留原始数据：${String(error)}`;
      }
    }
    if (!active)
      await this.catalog.runAsync(
        "INSERT INTO state VALUES (?, ?)",
        "active",
        id,
      );
    if (!this.readOnly) {
      await this.repairExistingMedia();
      await this.cleanup();
      try {
        await this.automaticBackup();
      } catch {
        this.warning = [
          this.warning,
          "自动备份未完成，请检查缺失照片或存储空间后重试",
        ]
          .filter(Boolean)
          .join("；");
      }
      // 旧代目录已经有完整恢复前备份，启动时回收中断恢复留下的未引用目录。
      for (let entry of this.root.list()) {
        if (
          entry instanceof expoFileSystem.Directory &&
          entry.name.startsWith("generation-") &&
          entry.name !== this.generation.name
        ) {
          try {
            entry.delete();
          } catch {
            /* 下次启动再次尝试回收。 */
          }
        }
      }
    }
  }
  async version(db) {
    return (await db.getFirstAsync("PRAGMA user_version")).user_version;
  }
  /** 启动与旧备份恢复使用同一迁移链，每条迁移都在独立事务内完成。 */
  async migrate(db, current) {
    for (const migration of migrations.filter(
      (item) => item.version > current,
    )) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.execAsync(migration.sql);
        await transaction.runAsync(
          "INSERT OR IGNORE INTO schema_migrations VALUES (?, ?, ?, ?)",
          migration.version,
          migration.name,
          new Date().toISOString(),
          BackupFormat.hash(new TextEncoder().encode(migration.sql)),
        );
        await transaction.execAsync(
          `PRAGMA user_version = ${migration.version}`,
        );
      });
    }
  }
  writable() {
    if (this.readOnly) throw new Error(this.warning ?? "当前数据处于只读模式");
  }
  uri(path) {
    return new expoFileSystem.File(this.generation, path).uri;
  }
  async photos() {
    // 迁移前备份必须还能读取 v1 数据，不能提前查询尚未创建的餐次表。
    if ((await this.version(this.db)) < 2) {
      return this.db.getAllAsync(
        "SELECT * FROM photo_items ORDER BY day_key DESC, sort_index ASC",
      );
    }
    return this.db.getAllAsync(
      `SELECT p.*, g.started_at AS group_started_at, g.cost_cents, g.rating, g.location_json
       FROM photo_items p LEFT JOIN meal_groups g ON p.group_id = g.id
       ORDER BY p.day_key DESC, p.captured_at ASC, p.sort_index ASC`,
    );
  }
  async updateMeal(id, metadata) {
    this.writable();
    const value = normalizeMeal(metadata);
    const result = await this.db.runAsync(
      "UPDATE meal_groups SET cost_cents = ?, rating = ?, location_json = ? WHERE id = ?",
      value.cost_cents,
      value.rating,
      value.location ? JSON.stringify(value.location) : null,
      id,
    );
    if (!result.changes) throw new Error("这组记录已不存在，请返回后重试");
  }
  /** 旧记录只能由用户明确重新选择原图，不按文件名或媒体编号自动猜测。 */
  async linkSource(id, source) {
    this.writable();
    if (!source) throw new Error("未选择有效原图");
    const result = await this.db.runAsync(
      "UPDATE photo_items SET source_asset_id = ? WHERE id = ?",
      source,
      id,
    );
    if (!result.changes) throw new Error("这张记录已不存在");
  }
  hasMedia(photo) {
    return [photo.original_path, photo.thumb_path].some((path) => {
      const file = new expoFileSystem.File(this.generation, path);
      return file.exists && file.size > 0;
    });
  }

  /** 仅修复已有副本，不申请相册权限，不删除或猜测缺失照片的归属。 */
  async repairExistingMedia() {
    let missing = 0;
    let recoveredLowResolution = 0;
    for (const photo of await this.photos()) {
      const original = new expoFileSystem.File(
        this.generation,
        photo.original_path,
      );
      const thumb = new expoFileSystem.File(this.generation, photo.thumb_path);
      const valid = (file) => file.exists && file.size > 0;
      try {
        if (valid(original) && !valid(thumb)) {
          const context = expoImageManipulator.ImageManipulator.manipulate(
            original.uri,
            { maxWidth: 512, maxHeight: 512 },
          );
          let image;
          let temporary;
          try {
            image = await context.renderAsync();
            temporary = new expoFileSystem.File(
              (
                await image.saveAsync({
                  compress: 0.75,
                  format: expoImageManipulator.SaveFormat.JPEG,
                })
              ).uri,
            );
            thumb.parentDirectory.create({
              intermediates: true,
              idempotent: true,
            });
            await temporary.copy(thumb, { overwrite: true });
          } finally {
            image?.release();
            context.release();
            if (temporary?.exists) temporary.delete();
          }
        } else if (!valid(original) && valid(thumb)) {
          original.parentDirectory.create({
            intermediates: true,
            idempotent: true,
          });
          await thumb.copy(original, { overwrite: true });
          await this.db.runAsync(
            "INSERT OR REPLACE INTO app_meta VALUES (?, ?)",
            `thumbnail_recovery_${photo.id}`,
            "1",
          );
        }
      } catch {
        /* 保留原记录，交给用户重新选择原图修复。 */
      }
      if (!valid(original) || !valid(thumb)) missing++;
      const recovery = await this.db.getFirstAsync(
        "SELECT value FROM app_meta WHERE key = ?",
        `thumbnail_recovery_${photo.id}`,
      );
      if (recovery) recoveredLowResolution++;
    }
    this.warning =
      [
        missing
          ? `${missing} 张旧照片副本缺失，点击照片格可重新选择原图`
          : null,
        recoveredLowResolution
          ? `${recoveredLowResolution} 张旧照片由缩略图恢复，清晰度可能降低`
          : null,
      ]
        .filter(Boolean)
        .join("；") || null;
  }

  async replaceMedia(photo, selected) {
    await this.add([selected], photo.day_key, photo.id);
    await this.cleanup();
    await this.repairExistingMedia();
  }

  async add(items, targetDay, replacingId = null, metadata = {}) {
    this.writable();
    const meal = normalizeMeal(metadata);
    const groupId = `meal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (replacingId && items.filter((item) => item.selected).length !== 1) {
      throw new Error("修复记录时请选择一张原图");
    }
    const rows = [];
    const created = [];
    try {
      for (let [index, item] of items
        .filter((photo) => photo.selected)
        .entries()) {
        let id = `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
        let originalPath = `media/Originals/${id}.jpg`;
        let thumbPath = `media/Thumbs/${id}.jpg`;
        for (let path of [originalPath, thumbPath]) {
          let file = new expoFileSystem.File(this.generation, path);
          file.parentDirectory.create({
            intermediates: true,
            idempotent: true,
          });
          created.push(file);
        }
        // 先限制长边，再生成缩略图；保留沙盒副本，不依赖相册原图存活。
        let context = expoImageManipulator.ImageManipulator.manipulate(
          item.uri,
          {
            maxWidth: 2048,
            maxHeight: 2048,
          },
        );
        let rendered = await context.renderAsync();
        let original = await rendered.saveAsync({
          compress: 0.85,
          format: expoImageManipulator.SaveFormat.JPEG,
        });
        let thumbContext = expoImageManipulator.ImageManipulator.manipulate(
          original.uri,
        );
        thumbContext.resize(
          original.width >= original.height
            ? {
                width: 512,
              }
            : {
                height: 512,
              },
        );
        let thumbnail = await thumbContext.renderAsync();
        let thumb = await thumbnail.saveAsync({
          compress: 0.75,
          format: expoImageManipulator.SaveFormat.JPEG,
        });
        context.release();
        rendered.release();
        thumbContext.release();
        thumbnail.release();
        await copyPreparedMedia({
          original: new expoFileSystem.File(original.uri),
          thumbnail: new expoFileSystem.File(thumb.uri),
          ownedOriginal: new expoFileSystem.File(this.generation, originalPath),
          ownedThumbnail: new expoFileSystem.File(this.generation, thumbPath),
        });
        // 图片处理产生的中间文件仅在副本已落盘后清除。
        for (let uri of new Set([original.uri, thumb.uri])) {
          try {
            new expoFileSystem.File(uri).delete();
          } catch {
            /* 缓存清理失败不影响入档。 */
          }
        }
        rows.push({
          id,
          day_key: targetDay ?? Domain.dayKey(item.capturedAt),
          original_path: originalPath,
          thumb_path: thumbPath,
          captured_at: item.capturedAt.toISOString(),
          // 拍摄原片另存到用户目录，应用副本保持独立；失败时不提交数据库记录。
          source_asset_id: await saveCaptureSource(item, `Shike_${id}.jpg`),
          sort_index: 0,
        });
      }
      await this.db.withExclusiveTransactionAsync(async (transaction) => {
        // 媒体全部落盘后才创建餐次；餐次与照片一同提交，失败不留下空组。
        if (!replacingId && rows.length) {
          const startedAt = rows.map((row) => row.captured_at).sort()[0];
          await transaction.runAsync(
            "INSERT INTO meal_groups(id, started_at, cost_cents, rating, location_json) VALUES (?, ?, ?, ?, ?)",
            groupId,
            startedAt,
            meal.cost_cents,
            meal.rating,
            meal.location ? JSON.stringify(meal.location) : null,
          );
        }
        for (let row of rows) {
          if (replacingId) {
            const existing = await transaction.getFirstAsync(
              "SELECT id FROM photo_items WHERE id = ?",
              replacingId,
            );
            if (!existing) throw new Error("待修复记录已不存在");
            // 只替换文件引用，保留原记录 ID、归档日期、拍摄时间和排序。
            await transaction.runAsync(
              "UPDATE photo_items SET original_path = ?, thumb_path = ?, source_asset_id = ? WHERE id = ?",
              row.original_path,
              row.thumb_path,
              row.source_asset_id,
              replacingId,
            );
            await transaction.runAsync(
              "DELETE FROM app_meta WHERE key = ?",
              `thumbnail_recovery_${replacingId}`,
            );
            continue;
          }
          await transaction.runAsync(
            "INSERT OR IGNORE INTO day_entries(day_key) VALUES (?)",
            row.day_key,
          );
          let next = await transaction.getFirstAsync(
            "SELECT COALESCE(MAX(sort_index), -1) + 1 AS position FROM photo_items WHERE day_key = ?",
            row.day_key,
          );
          await transaction.runAsync(
            "INSERT INTO photo_items (id, day_key, original_path, thumb_path, captured_at, source_asset_id, sort_index, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            row.id,
            row.day_key,
            row.original_path,
            row.thumb_path,
            row.captured_at,
            row.source_asset_id,
            next.position,
            groupId,
          );
        }
      });
    } catch (error) {
      for (let _file of created) {
        try {
          if (_file.exists) _file.delete();
        } catch {
          /* 启动时按数据库引用重试清理。 */
        }
      }
      throw error;
    }
  }
  async remove(ids) {
    this.writable();
    await this.db.withExclusiveTransactionAsync(async (transaction) => {
      for (let id of ids)
        await transaction.runAsync("DELETE FROM photo_items WHERE id = ?", id);
      await transaction.execAsync(
        "DELETE FROM day_entries WHERE day_key NOT IN (SELECT day_key FROM photo_items)",
      );
      await transaction.execAsync(
        "DELETE FROM meal_groups WHERE id NOT IN (SELECT group_id FROM photo_items WHERE group_id IS NOT NULL)",
      );
    });
    // 数据库先提交，媒体后清理；失败时不产生数据库引用的悬空文件。
    await this.cleanup();
  }
  async cleanup() {
    const referenced = new Set(
      (await this.photos()).flatMap((photo) => [
        photo.original_path,
        photo.thumb_path,
      ]),
    );
    for (let name of ["Originals", "Thumbs"]) {
      let directory = new expoFileSystem.Directory(
        this.generation,
        "media",
        name,
      );
      if (!directory.exists) continue;
      for (let entry of directory.list()) {
        if (
          entry instanceof expoFileSystem.File &&
          !referenced.has(`media/${name}/${entry.name}`)
        ) {
          try {
            entry.delete();
          } catch {
            /* 下次启动重试，不回滚已经完成的删除。 */
          }
        }
      }
    }
  }
  async createBackup(prefix = "食刻备份") {
    const photos = await this.photos();
    const files = {
      "database/foodlog.db": await this.db.serializeAsync(),
    };
    for (let path of new Set(
      photos.flatMap((photo) => [photo.original_path, photo.thumb_path]),
    )) {
      files[path] = await new expoFileSystem.File(
        this.generation,
        path,
      ).bytes();
    }
    const bytes = BackupFormat.encodeBackup(
      files,
      new Set(photos.map((photo) => photo.day_key)).size,
      photos.length,
      await this.version(this.db),
    );
    const backups = new expoFileSystem.Directory(this.root, "Backups");
    backups.create({
      intermediates: true,
      idempotent: true,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const temporary = new expoFileSystem.File(
      backups,
      `${prefix}-${stamp}.partial`,
    );
    await temporary.write(bytes);
    const target = new expoFileSystem.File(
      backups,
      `${prefix}-${stamp}.foodlogbackup`,
    );
    await temporary.move(target);
    this.prune(prefix);
    return target;
  }
  prune(prefix) {
    if (prefix === "食刻备份") return;
    const files = new expoFileSystem.Directory(this.root, "Backups")
      .list()
      .filter(
        (entry) =>
          entry instanceof expoFileSystem.File &&
          entry.name.startsWith(`${prefix}-`) &&
          entry.name.endsWith(".foodlogbackup"),
      )
      .sort((a, b) => b.name.localeCompare(a.name));
    for (let file of files.slice(3)) file.delete();
  }
  async automaticBackup() {
    const last = await this.db.getFirstAsync(
      "SELECT value FROM app_meta WHERE key = ?",
      "last_auto_backup",
    );
    if (last && Date.now() - Number(last.value) < 604800000) return;
    await this.createBackup("auto");
    await this.db.runAsync(
      "INSERT OR REPLACE INTO app_meta VALUES (?, ?)",
      "last_auto_backup",
      String(Date.now()),
    );
  }
  async prepareRestore(uri) {
    const { manifest, files } = BackupFormat.decodeBackup(
      await new expoFileSystem.File(uri).bytes(),
    );
    const directory = new expoFileSystem.Directory(
      this.root,
      `generation-${Date.now()}-restored`,
    );
    directory.create({
      intermediates: true,
    });
    let database;
    try {
      for (let [path, bytes] of Object.entries(files)) {
        if (path === "manifest.json") continue;
        let output = new expoFileSystem.File(
          directory,
          path === "database/foodlog.db" ? "foodlog.db" : path,
        );
        output.parentDirectory.create({
          intermediates: true,
          idempotent: true,
        });
        await output.write(bytes);
      }
      database = await SQLite.openDatabaseAsync(
        "foodlog.db",
        {},
        directory.uri,
      );
      const integrity = await database.getFirstAsync("PRAGMA integrity_check");
      const photos = await database.getAllAsync("SELECT * FROM photo_items");
      const days = await database.getAllAsync(
        "SELECT day_key FROM day_entries",
      );
      const references = new Set(
        photos.flatMap((photo) => [photo.original_path, photo.thumb_path]),
      );
      const media = Object.keys(files).filter((path) =>
        path.startsWith("media/"),
      );
      if (
        integrity?.integrity_check !== "ok" ||
        (await this.version(database)) !== manifest.db_schema_version ||
        (await database.getAllAsync("PRAGMA foreign_key_check")).length ||
        photos.length !== manifest.photo_count ||
        days.length !== manifest.day_count ||
        references.size !== media.length ||
        media.some((path) => !references.has(path))
      ) {
        throw new Error("备份记录与照片不一致，已中止恢复");
      }
      // 在隔离的恢复目录中升级旧备份，成功前绝不切换当前数据目录。
      await database.execAsync("PRAGMA foreign_keys = ON");
      await this.migrate(database, manifest.db_schema_version);
      // 备份可在另一台手机恢复，旧设备的媒体 ID 不代表当前设备同一张照片。
      // 清除外部引用以避免按相同编号误删本机原图，应用内照片副本不受影响。
      await database.runAsync("UPDATE photo_items SET source_asset_id = NULL");
      return {
        directory,
        database,
        count: photos.length,
      };
    } catch (error) {
      await database?.closeAsync();
      directory.delete();
      throw error;
    }
  }
  async restore(prepared) {
    await this.createBackup("pre-restore");
    await prepared.database.execAsync(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;",
    );
    // 全部文件写入并校验后，目录指针在独立 SQLite 事务中切换。
    // 进程在提交前退出仍使用旧目录，提交后退出则打开完整的新目录。
    await this.catalog.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "UPDATE state SET value = ? WHERE key = ?",
        prepared.directory.name,
        "active",
      );
    });
    const previous = this.db;
    this.db = prepared.database;
    this.generation = prepared.directory;
    this.readOnly = false;
    this.warning = null;
    try {
      await previous.closeAsync();
    } catch {
      this.warning = "恢复已完成，旧数据库连接将在应用重启后释放";
    }
  }
  storage() {
    const size = (directory) =>
      !directory.exists
        ? 0
        : directory
            .list()
            .reduce(
              (sum, entry) =>
                sum +
                (entry instanceof expoFileSystem.File
                  ? entry.size
                  : size(entry)),
              0,
            );
    return {
      media: size(new expoFileSystem.Directory(this.generation, "media")),
      backups: size(new expoFileSystem.Directory(this.root, "Backups")),
    };
  }
}
export { Repository };
