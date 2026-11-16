import * as React from "react";
import * as RN from "react-native";
import { InteractivePressable } from "./InteractivePressable";
import { MealActions } from "./MealEditor";
import { useReducedMotion } from "./MotionView";

/** 仅覆盖图片底部，展开时不改变图片尺寸；组改变后由父层 key 重置为收起状态。 */
export function MealOverlay({ group, onEdit }) {
  const [expanded, setExpanded] = React.useState(false);
  const [progress] = React.useState(() => new RN.Animated.Value(0));
  const reduced = useReducedMotion();
  React.useEffect(() => {
    const animation = RN.Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: reduced ? 0 : 220,
      // 高度决定展开区域，需要布局驱动；范围仅限小型文本蒙层。
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, progress, reduced]);
  if (!group) return null;
  const time = new Date(group.started_at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const summary = [
    group.location?.label,
    group.cost_cents != null ? `¥${(group.cost_cents / 100).toFixed(2)}` : null,
    group.rating ? `${group.rating} ★` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <RN.View style={s.overlay}>
      <InteractivePressable
        tone="dark"
        style={s.header}
        onPress={() => setExpanded(!expanded)}
        accessibilityLabel="餐次信息"
        accessibilityState={{ expanded }}
      >
        <RN.View style={s.grow}>
          <RN.Text style={s.title}>
            {group.legacy ? "历史记录" : `${time} 的这一餐`} ·{" "}
            {group.photos.length} 张
          </RN.Text>
          <RN.Text style={s.summary} numberOfLines={1}>
            {summary || "添加花费、评分或地点"}
          </RN.Text>
        </RN.View>
        <RN.Text style={s.chevron}>{expanded ? "⌄" : "⌃"}</RN.Text>
      </InteractivePressable>
      <RN.Animated.View
        style={{
          height: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 182],
          }),
          opacity: progress,
          overflow: "hidden",
        }}
        pointerEvents={expanded ? "auto" : "none"}
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
      >
        <RN.ScrollView contentContainerStyle={s.body}>
          <RN.Text style={s.location} numberOfLines={2}>
            {group.location?.label || "未附加位置"}
          </RN.Text>
          <RN.Text style={s.summary}>
            {group.cost_cents != null
              ? `花费 ¥${(group.cost_cents / 100).toFixed(2)}`
              : "未记录花费"}{" "}
            · {group.rating ? `评分 ${group.rating} / 5` : "未评分"}
          </RN.Text>
          <MealActions metadata={group} dark onEdit={onEdit} />
          {!!group.location?.address && (
            <RN.Text style={s.summary} numberOfLines={2}>
              {group.location.address}
            </RN.Text>
          )}
        </RN.ScrollView>
      </RN.Animated.View>
    </RN.View>
  );
}
const s = RN.StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000c",
    borderTopWidth: RN.StyleSheet.hairlineWidth,
    borderTopColor: "#ffffff33",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    minHeight: 62,
  },
  grow: { flex: 1 },
  title: { color: "#fff", fontSize: 14, fontWeight: "500" },
  summary: { color: "#ccc", fontSize: 12, lineHeight: 20 },
  chevron: { color: "#ddd", fontSize: 24, paddingLeft: 12 },
  body: { paddingHorizontal: 20, gap: 10 },
  location: { color: "#eee", fontSize: 14, lineHeight: 20 },
  place: {
    alignSelf: "center",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
});
