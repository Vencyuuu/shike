import React, { useCallback, useState } from "react";
import {
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";

interface Props {
  children: (tileSize: number) => React.ReactNode;
  style?: StyleProp<ViewStyle>;
  horizontalPadding?: number;
}

/**
 * 先测量网格真实宽度，再为每张照片提供明确的正方形尺寸。
 * 不依赖百分比宽度和 aspectRatio 推算自动高度，避免全绝对定位子元素导致格子塌陷。
 */
export function MeasuredPhotoGrid({
  children,
  style,
  horizontalPadding = 0,
}: Props) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (Number.isFinite(nextWidth) && nextWidth > 0) setWidth(nextWidth);
  }, []);
  const tileSize = Math.max(
    0,
    Math.floor((width - horizontalPadding * 2 - 8 * 2) / 3),
  );

  return (
    <View style={[styles.grid, style]} onLayout={onLayout}>
      {tileSize > 0 ? children(tileSize) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    alignSelf: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
