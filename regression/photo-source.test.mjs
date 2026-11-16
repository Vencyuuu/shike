import assert from "node:assert/strict";
import test from "node:test";
import { ensureCaptureSource } from "../src/data/photo-source.js";

test("相册导入保留源文档 URI，不额外导出原片；旧记录不猜测来源", async () => {
  const save = () => { throw new Error("不应另存导入原图"); };
  assert.equal(await ensureCaptureSource({ assetId: "content://original/2" }, "a.jpg", save),
    "content://original/2");
  assert.equal(await ensureCaptureSource({}, "a.jpg", save), null);
});

test("拍摄原片成功写入后保留引用，数据库失败后的重试不重复生成文件", async () => {
  let calls = 0;
  const item = { isCapture: true, uri: "file:///camera/a.jpg" };
  const save = async (uri, name) => {
    calls++;
    assert.equal(uri, item.uri);
    assert.equal(name, "a.jpg");
    return "content://media/external/images/media/12";
  };
  const first = await ensureCaptureSource(item, "a.jpg", save);
  assert.equal(await ensureCaptureSource(item, "a.jpg", save), first);
  assert.equal(calls, 1);
});

test("目录失效、空间不足或无有效 URI 时不产生虚假引用，允许重试", async () => {
  const item = { isCapture: true, uri: "file:///camera/a.jpg" };
  await assert.rejects(ensureCaptureSource(item, "a.jpg", async () => {
    throw new Error("目录授权已失效");
  }), /目录授权/);
  assert.equal(item.assetId, undefined);
  await assert.rejects(ensureCaptureSource(item, "a.jpg", async () => null), /有效文件引用/);
  assert.equal(item.assetId, undefined);
});
