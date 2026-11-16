import { NativeModules, Platform, PermissionsAndroid } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { ensureCaptureSource } from "../data/photo-source";

const native = NativeModules.ShikePhotoStorage;

/** Android 保留系统文档原始 URI，不从缓存路径推测相册文件；取消返回空列表。 */
export async function pickPhotos(multiple = true) {
  if (Platform.OS === "android")
    return (await native.pickPhotos(multiple)) ?? [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: multiple,
    quality: 1,
    orderedSelection: true,
  });
  return result.canceled ? [] : result.assets;
}

export async function saveCaptureSource(item, name) {
  return ensureCaptureSource(item, name, async (uri, filename) => {
    if (Platform.OS === "android") {
      // Android 9 及以下写入公共相册需要旧存储权限；新系统只使用范围存储。
      if (Number(Platform.Version) <= 28) {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        );
        if (permission !== PermissionsAndroid.RESULTS.GRANTED)
          throw new Error("未授予原片保存权限，请允许相册写入或选择可写目录");
      }
      return native.saveCapture(uri, filename);
    }
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) throw new Error("未授予原片保存权限");
    return (await MediaLibrary.Asset.create(uri)).id;
  });
}

export async function deletePhotoSources(items) {
  const ids = [
    ...new Set(items.map((item) => item.source_asset_id).filter(Boolean)),
  ];
  if (Platform.OS === "android") return native.deleteSources(ids);
  const permission = await MediaLibrary.requestPermissionsAsync(false, [
    "photo",
  ]);
  if (!permission.granted) throw new Error("相册权限未授予，记录已保留");
  return MediaLibrary.Asset.delete(ids.map((id) => new MediaLibrary.Asset(id)));
}

export const getCaptureFolder = () =>
  Platform.OS === "android" ? native.getFolder() : Promise.resolve("系统相册");
export const chooseCaptureFolder = () => native.chooseFolder();
export const resetCaptureFolder = () => native.resetFolder();
