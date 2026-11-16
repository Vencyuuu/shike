/** 文件复制的提交屏障；调用方只有等待它完成后，才允许清理临时文件或写数据库。 */
export async function copyPreparedMedia({
  original,
  thumbnail,
  ownedOriginal,
  ownedThumbnail,
}) {
  await original.copy(ownedOriginal);
  await thumbnail.copy(ownedThumbnail);
  for (const file of [ownedOriginal, ownedThumbnail]) {
    if (!file.exists || file.size <= 0)
      throw new Error("图片副本未正确保存，请重试");
  }
}
