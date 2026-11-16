import React, { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, ViewProps } from "react-native";

// 动画设置统一订阅，避免各页面各自监听系统并出现不一致的过渡行为。
const ReducedMotionContext = createContext(true);

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => {
        // 无法读取系统设置时保留静态界面，保证交互始终可用。
      });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return (
    <ReducedMotionContext.Provider value={reduced}>
      {children}
    </ReducedMotionContext.Provider>
  );
}

export const useReducedMotion = () => useContext(ReducedMotionContext);

interface Props extends ViewProps {
  transitionKey?: string;
  preset?: "page" | "dialog";
}

/**
 * 页面淡入并轻微上移，弹窗额外从 96% 缩放进入；全部使用原生动画驱动。
 * 切换只重新启动动画，不用 key 重建子树，保留滚动位置、相机会话和照片选择。
 */
export function MotionView({
  transitionKey = "enter",
  preset = "page",
  style,
  ...props
}: Props) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: preset === "dialog" ? 240 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    // 快速连续导航时停止旧动画，避免回调或动画在卸载后继续执行。
    return () => animation.stop();
  }, [transitionKey, preset, progress, reduced]);
  return (
    <Animated.View
      {...props}
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [preset === "dialog" ? 20 : 12, 0],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [preset === "dialog" ? 0.96 : 1, 1],
              }),
            },
          ],
        },
      ]}
    />
  );
}
