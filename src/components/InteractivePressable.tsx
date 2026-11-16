import React, { createContext, useContext } from "react";
import {
  Pressable,
  PressableProps,
  StyleSheet,
  useColorScheme,
} from "react-native";

const InteractionTone = createContext<boolean | null>(null);

/** 相机等固定黑色界面独立提供交互色调，避免系统浅色主题下按钮文字失去对比。 */
export function DarkInteractionSurface({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <InteractionTone.Provider value={true}>{children}</InteractionTone.Provider>
  );
}

interface Props extends Omit<PressableProps, "android_ripple"> {
  variant?: "surface" | "image" | "floating";
  tone?: "dark" | "light";
}

/** 全应用共享点击热区、禁用状态及贴合按钮轮廓的跨平台按压反馈。 */
export function InteractivePressable({
  children,
  style,
  disabled,
  accessibilityState,
  variant = "surface",
  tone,
  hitSlop = 4,
  ...props
}: Props) {
  const systemDark = useColorScheme() === "dark";
  const contextualDark = useContext(InteractionTone);
  const dark = tone ? tone === "dark" : (contextualDark ?? systemDark);
  return (
    <Pressable
      {...props}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={props.accessibilityRole ?? "button"}
      accessibilityState={{ ...accessibilityState, disabled: !!disabled }}
      // Android 原生涟漪使用独立矩形遮罩，不会继承胶囊和日期的圆角。
      // 统一使用当前视图的圆角底色、透明度与缩放，保留阴影而不增加裁剪容器。
      android_ripple={undefined}
      style={(state) => {
        const resolvedStyle =
          typeof style === "function" ? style(state) : style;
        const existing = StyleSheet.flatten(resolvedStyle);
        return [
          styles.target,
          resolvedStyle,
          // 透明入口按住时补充轻量底色，并直接继承当前视图的圆角。
          // 实色按钮保留原底色，通过下方透明度与缩放提供反馈。
          variant === "surface" &&
            state.pressed &&
            !disabled &&
            (!existing?.backgroundColor ||
              existing.backgroundColor === "transparent") && {
              backgroundColor: dark ? "#ffffff14" : "#00000008",
            },
          // 不依赖常驻底色，照片、文字和图标仍共享清晰的按压反馈。
          {
            opacity:
              (existing?.opacity ?? 1) *
              (disabled ? 0.38 : state.pressed ? 0.55 : 1),
            transform:
              state.pressed && !disabled
                ? [
                    ...(Array.isArray(existing?.transform)
                      ? existing.transform
                      : []),
                    { scale: 0.97 },
                  ]
                : existing?.transform,
          },
        ];
      }}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { minWidth: 44, minHeight: 44, borderRadius: 8 },
});
