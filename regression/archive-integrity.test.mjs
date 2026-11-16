import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { encodeBackup, decodeBackup, hash } from '../src/domain/backup-format.js';
import { dayKey, calendarCells } from '../src/domain/model.js';

test('恢复的日期逻辑保持本地归档日期与闰月完整', () => {
  assert.equal(dayKey(new Date(2026, 0, 1, 0, 1)), '2026-01-01');
  assert.equal(calendarCells(new Date(2028, 1, 1)).filter(Boolean).length, 29);
});

test('备份使用标准 SHA-256 并保留媒体字节', () => {
  assert.equal(hash(strToU8('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const files = { 'database/foodlog.db': strToU8('db fixture'),
    'media/Originals/test.jpg': strToU8('original'), 'media/Thumbs/test.jpg': strToU8('thumb') };
  const restored = decodeBackup(encodeBackup(files, 1, 1));
  assert.equal(restored.manifest.photo_count, 1);
  assert.deepEqual(restored.files['media/Originals/test.jpg'], files['media/Originals/test.jpg']);
  const tampered = unzipSync(encodeBackup(files, 1, 1));
  tampered['media/Thumbs/test.jpg'] = strToU8('changed');
  assert.throws(() => decodeBackup(zipSync(tampered)), /校验失败/);
});
