import React, { useState } from "react";
import {
  Image,
  ImageProps,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { InteractivePressable } from "./InteractivePressable";

interface Props {
  uri: string;
  style?: ImageProps["style"];
  resizeMode?: ImageProps["resizeMode"];
  onRepair?: () => void;
  accessibilityLabel?: string;
  accessible?: boolean;
}

/** URI 改变时重建加载状态；读取失败必须显示可操作的占位，不能继续留白。 */
export function LocalPhoto(props: Props) {
  return <PhotoContent key={props.uri} {...props} />;
}

function PhotoContent({
  uri,
  style,
  resizeMode = "cover",
  onRepair,
  accessibilityLabel,
  accessible = false,
}: Props) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <View style={[style as StyleProp<ViewStyle>, styles.fallback]}>
        <Text style={styles.message}>图片副本缺失或无法读取</Text>
        {onRepair && (
          <InteractivePressable
            tone="dark"
            accessibilityRole="button"
            onPress={(event) => {
              event.stopPropagation();
              onRepair();
            }}
            style={styles.repair}
          >
            <Text
              style={[styles.message, { color: "#fff", fontWeight: "600" }]}
            >
              重新选择原图
            </Text>
          </InteractivePressable>
        )}
      </View>
    );
  return (
    <Image
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "#ededed",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  message: { color: "#666", fontSize: 12, textAlign: "center" },
  repair: {
    backgroundColor: "#1d1d1f",
    paddingVertical: 12,
    paddingHorizontal: 4,
    minHeight: 44,
    justifyContent: "center",
  },
});
