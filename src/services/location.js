import {
  Alert,
  Linking,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from "react-native";
import { amapResultToLocation } from "../domain/location";
import { normalizePlaces } from "../domain/places";

const bridge = () => {
  const module = NativeModules.ShikeAmapLocation;
  if (!module)
    throw new Error("当前安装包尚未包含高德定位模块，请安装新版 APK");
  return module;
};
const cancelled = () =>
  Object.assign(new Error("已取消定位"), { code: "E_LOCATION_CANCELLED" });
const checkAbort = (signal) => {
  if (signal?.aborted) throw cancelled();
};

/** 同意记录保存在原生层；第一次主动使用时才展示说明，不在应用启动时初始化 SDK。 */
async function ensureAmapConsent(signal) {
  if (await bridge().hasPrivacyConsent()) return;
  checkAbort(signal);
  const agreed = await new Promise((resolve) => {
    Alert.alert(
      "使用高德位置服务",
      "为这组照片选择地点，高德定位及地点搜索 SDK 会处理位置信息、Wi-Fi／基站等网络信息及必要的设备信息，用于定位、地址解析和附近地点搜索。仅在你主动选择位置时调用；照片、花费和评分不会发送给高德。你可以跳过，也可在设置中撤回同意。",
      [
        { text: "暂不使用", style: "cancel", onPress: () => resolve(false) },
        {
          text: "查看隐私政策",
          onPress: () => {
            resolve(false);
            Linking.openURL("https://lbs.amap.com/pages/privacy/").catch(() =>
              Alert.alert(
                "暂时无法打开",
                "请在浏览器访问 lbs.amap.com/pages/privacy/ 查看高德隐私政策。",
              ),
            );
          },
        },
        { text: "同意并继续", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  checkAbort(signal);
  if (!agreed) throw cancelled();
  await bridge().setPrivacyConsent(true);
}

/** Android 使用高德定位与地址解析；未接入 Android Key 的其他平台继续使用系统服务。 */
export async function getMealLocation(signal) {
  if (Platform.OS === "android") {
    await ensureAmapConsent(signal);
    checkAbort(signal);
    const native = bridge();
    // Android 权限与系统开关检查直接使用原生接口，不依赖 Google 定位服务。
    const permissions = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ]);
    checkAbort(signal);
    if (
      !Object.values(permissions).includes(PermissionsAndroid.RESULTS.GRANTED)
    ) {
      throw new Error(
        "未获得定位权限，可不附加位置保存，或在系统设置中开启权限。",
      );
    }
    if (!(await native.isLocationEnabled()))
      throw new Error("请先开启系统定位服务，也可以不附加位置保存。");
    checkAbort(signal);
    const abort = () => {
      native.cancel().catch(() => {});
    };
    signal?.addEventListener("abort", abort);
    try {
      checkAbort(signal);
      const result = await native.getCurrentLocation();
      checkAbort(signal);
      return amapResultToLocation(result);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  // iOS 尚未配置高德 iOS Key；维持系统单次定位，不把 Android Key 用在其他平台。
  const Location = await import("expo-location");
  const permission = await Location.requestForegroundPermissionsAsync();
  checkAbort(signal);
  if (!permission.granted)
    throw new Error("未获得定位权限，可不附加位置保存。");
  const result = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  checkAbort(signal);
  return {
    latitude: result.coords.latitude,
    longitude: result.coords.longitude,
    accuracy: result.coords.accuracy,
    capturedAt: new Date(result.timestamp).toISOString(),
    label: `${result.coords.latitude.toFixed(4)}, ${result.coords.longitude.toFixed(4)}`,
    provider: "system",
    coordinateSystem: "WGS84",
  };
}

export function showLocationPrivacy() {
  Alert.alert(
    "定位服务与隐私",
    "Android 端使用高德定位及地点搜索 SDK。仅主动选择位置时进行定位、地址解析和附近地点搜索；此时高德会处理必要的位置、设备和网络信息。照片、评分与花费保存在本机，不会发送给高德。撤回同意后，下次使用会重新询问。",
    [
      { text: "关闭", style: "cancel" },
      {
        text: "查看高德政策",
        onPress: () =>
          Linking.openURL("https://lbs.amap.com/pages/privacy/").catch(() =>
            Alert.alert("无法打开政策链接"),
          ),
      },
      {
        text: "撤回同意",
        onPress: () => {
          if (Platform.OS !== "android") return;
          bridge()
            .setPrivacyConsent(false)
            .then(() =>
              Alert.alert("已撤回同意", "仍可正常保存照片、花费和评分。"),
            )
            .catch(() => Alert.alert("操作未完成，请稍后重试"));
        },
      },
    ],
  );
}

/** 新关键词取消旧请求，过期的网络回调不得覆盖新的地点列表。 */
export async function searchMealPlaces(fix, keyword, signal) {
  checkAbort(signal);
  if (Platform.OS !== "android") return [];
  const native = NativeModules.ShikeAmapPlaces;
  if (!native) throw new Error("请安装包含附近地点搜索的新版本 APK");
  const abort = () => {
    native.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort);
  try {
    checkAbort(signal);
    const places = await native.searchNearby(
      fix.latitude,
      fix.longitude,
      keyword,
    );
    checkAbort(signal);
    return normalizePlaces(places);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
