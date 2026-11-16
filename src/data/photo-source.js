/**
 * 导入保留用户选中的真实来源；拍摄只在首次入档时另存原片。
 * 仅成功写入后才更新引用，使提交失败后的重试不会反复生成相册文件。
 */
export async function ensureCaptureSource(item, filename, save) {
  if (!item.isCapture || item.assetId) return item.assetId ?? null;
  const id = await save(item.uri, filename);
  if (typeof id !== "string" || !id) throw new Error("原片未返回有效文件引用");
  item.assetId = id;
  return id;
}
