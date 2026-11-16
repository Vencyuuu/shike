import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { copyPreparedMedia } from "../src/data/media-write.js";

function gate() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("复制未落盘时不能返回，防止调用方提前删除缓存或写入记录", async () => {
  const originalCopy = gate();
  const thumbnailCopy = gate();
  const ownedOriginal = { exists: false, size: 0 };
  const ownedThumbnail = { exists: false, size: 0 };
  let finished = false;
  const operation = copyPreparedMedia({
    original: {
      async copy() {
        await originalCopy.promise;
        Object.assign(ownedOriginal, { exists: true, size: 20 });
      },
    },
    thumbnail: {
      async copy() {
        await thumbnailCopy.promise;
        Object.assign(ownedThumbnail, { exists: true, size: 10 });
      },
    },
    ownedOriginal,
    ownedThumbnail,
  }).then(() => {
    finished = true;
  });
  try {
    await setImmediate();
    assert.equal(
      finished,
      false,
      "异步复制完成前已经返回，会重现缓存被提前清理的问题",
    );
    originalCopy.resolve();
    await setImmediate();
    assert.equal(finished, false, "缩略图尚未保存，不应允许提交");
    thumbnailCopy.resolve();
    await operation;
    assert.equal(finished, true);
  } finally {
    originalCopy.resolve();
    thumbnailCopy.resolve();
    await operation;
  }
});

test("复制失败应向调用方传播，不能误提交记录", async () => {
  const error = new Error("disk full");
  await assert.rejects(
    copyPreparedMedia({
      original: {
        copy: async () => {
          throw error;
        },
      },
      thumbnail: { copy: async () => {} },
      ownedOriginal: { exists: false, size: 0 },
      ownedThumbnail: { exists: false, size: 0 },
    }),
    error,
  );
});

test("复制返回后仍无有效文件时拒绝提交", async () => {
  await assert.rejects(
    copyPreparedMedia({
      original: { copy: async () => {} },
      thumbnail: { copy: async () => {} },
      ownedOriginal: { exists: true, size: 0 },
      ownedThumbnail: { exists: true, size: 10 },
    }),
    /图片副本未正确保存/,
  );
});
