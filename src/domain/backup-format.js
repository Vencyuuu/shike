// 从先前构建缓存恢复的等价模块，已移除 Metro 外壳并恢复 JSX。
import * as nobleHashesSha from "@noble/hashes/sha256";
import * as nobleHashesUtils from "@noble/hashes/utils";
import * as fflate from "fflate";
const SCHEMA_VERSION = 2;
const MAX_BYTES = 268435456;
const hash = (bytes) =>
  nobleHashesUtils.bytesToHex(nobleHashesSha.sha256(bytes));
function mediaHash(files) {
  return hash(
    nobleHashesUtils.utf8ToBytes(
      Object.keys(files)
        .filter((path) => path.startsWith("media/"))
        .sort()
        .map((path) => `${path}:${hash(files[path])}`)
        .join("\n"),
    ),
  );
}
function encodeBackup(files, days, photos, schemaVersion = SCHEMA_VERSION) {
  if (
    Object.values(files).reduce((total, bytes) => total + bytes.length, 0) >
    268369920
  ) {
    throw new Error("备份超过当前支持的 256 MB 上限，请减少照片后重试");
  }
  const manifest = {
    format_version: 1,
    app_version: "1.3.0",
    db_schema_version: schemaVersion,
    exported_at: new Date().toISOString(),
    day_count: days,
    photo_count: photos,
    media_count: Object.keys(files).filter((path) => path.startsWith("media/"))
      .length,
    db_sha256: hash(files["database/foodlog.db"]),
    media_sha256: mediaHash(files),
  };
  const bytes = fflate.zipSync(
    {
      ...files,
      "manifest.json": fflate.strToU8(JSON.stringify(manifest)),
    },
    {
      level: 0,
    },
  );
  if (bytes.length > MAX_BYTES)
    throw new Error("备份超过当前支持的 256 MB 上限");
  return bytes;
}

/** 在解压前累计声明大小，并在输出后校验，限制备份包的内存开销。 */
function decodeBackup(bytes) {
  if (bytes.length > MAX_BYTES)
    throw new Error("备份超过当前支持的 256 MB 上限");
  let declared = 0;
  const files = fflate.unzipSync(bytes, {
    filter: (entry) => {
      declared += entry.originalSize;
      if (declared > MAX_BYTES) throw new Error("备份解压大小超过上限");
      if (!(
        entry.name === "manifest.json" ||
        entry.name === "database/foodlog.db" ||
        /^media\/(Originals|Thumbs)\/[\w-]+\.jpg$/.test(entry.name)
      )) {
        throw new Error("备份包含非法路径");
      }
      return true;
    },
  });
  if (!files["manifest.json"] || !files["database/foodlog.db"]) {
    throw new Error("备份缺少清单或数据库");
  }
  const manifest = JSON.parse(fflate.strFromU8(files["manifest.json"]));
  if (
    manifest.format_version !== 1 ||
    !Number.isInteger(manifest.db_schema_version) ||
    manifest.db_schema_version < 1 ||
    manifest.db_schema_version > SCHEMA_VERSION
  ) {
    throw new Error("备份版本不兼容，请使用匹配版本的食刻");
  }
  if (
    ![manifest.day_count, manifest.photo_count, manifest.media_count].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  ) {
    throw new Error("备份清单无效");
  }
  if (
    hash(files["database/foodlog.db"]) !== manifest.db_sha256 ||
    mediaHash(files) !== manifest.media_sha256 ||
    Object.keys(files).filter((path) => path.startsWith("media/")).length !==
      manifest.media_count
  ) {
    throw new Error("备份校验失败，当前数据未被修改");
  }
  return {
    manifest,
    files,
  };
}
export { SCHEMA_VERSION, hash, encodeBackup, decodeBackup };
