import * as React from "react";
import * as RN from "react-native";
import { LocationPicker } from "./LocationPicker";
import { InteractivePressable } from "./InteractivePressable";
import { MotionView, useReducedMotion } from "./MotionView";
import { normalizeMeal, parseCost } from "../domain/meals";

export function useMealTheme(forceDark) {
  const systemDark = RN.useColorScheme() === "dark";
  const dark = forceDark ?? systemDark;
  return {
    dark,
    background: dark ? "#161616" : "#fff",
    text: dark ? "#f5f5f5" : "#222",
    muted: dark ? "#a0a0a0" : "#777",
    border: dark ? "#383838" : "#dedede",
  };
}

/** 星级区域同时接受点击、连续横滑和无障碍增减，半星与未评分分别保存。 */
function StarRating({ value, onChange, colors }) {
  const ref = React.useRef(null);
  const geometry = React.useRef({ left: 0, width: 240 });
  const update = (event) => {
    const { left, width } = geometry.current;
    onChange(
      Math.max(
        0.5,
        Math.min(
          5,
          Math.ceil(((event.nativeEvent.pageX - left) / width) * 10) / 2,
        ),
      ),
    );
  };
  return (
    <RN.View>
      <RN.View
        ref={ref}
        style={s.stars}
        onLayout={(event) => {
          geometry.current.width = event.nativeEvent.layout.width;
          ref.current?.measureInWindow((left) => {
            geometry.current.left = left;
          });
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => {
          // 弹窗过渡可能改变屏幕坐标，手势开始时重新测量，滑动始终以整排星星为准。
          const pageX = event.nativeEvent.pageX;
          ref.current?.measureInWindow((left) => {
            geometry.current.left = left;
            update({ nativeEvent: { pageX } });
          });
        }}
        onResponderMove={update}
        accessibilityRole="adjustable"
        accessibilityLabel="当餐评分"
        accessibilityHint="左右滑动选择半星至五星，也可以不评分"
        accessibilityValue={{
          min: 0,
          max: 5,
          now: value ?? 0,
          text: value ? `${value} 星` : "未评分",
        }}
        accessibilityActions={[
          { name: "increment", label: "增加半星" },
          { name: "decrement", label: "减少半星" },
        ]}
        onAccessibilityAction={(event) => {
          const next =
            (value ?? 0) +
            (event.nativeEvent.actionName === "increment" ? 0.5 : -0.5);
          onChange(next <= 0 ? null : Math.min(5, next));
        }}
      >
        {[0, 1, 2, 3, 4].map((index) => (
          <RN.View
            style={s.star}
            key={index}
            pointerEvents="none"
            accessible={false}
          >
            <RN.Text style={[s.starText, { color: colors.border }]}>☆</RN.Text>
            <RN.View
              style={[
                s.starFill,
                {
                  width: `${Math.max(0, Math.min(1, (value ?? 0) - index)) * 100}%`,
                },
              ]}
            >
              <RN.Text style={[s.starText, { color: colors.text }]}>★</RN.Text>
            </RN.View>
          </RN.View>
        ))}
      </RN.View>
      <RN.Text style={[s.hint, { color: colors.muted }]}>
        {value ? `${value} / 5 星` : "不评分也没关系"} · 左右滑动，支持半星
      </RN.Text>
      <InteractivePressable onPress={() => onChange(null)} style={s.clear}>
        <RN.Text style={{ color: colors.muted }}>暂不评分</RN.Text>
      </InteractivePressable>
    </RN.View>
  );
}

export function MealActions({ metadata = {}, onEdit, dark }) {
  const colors = useMealTheme(dark);
  return (
    <RN.View style={s.actions}>
      {[
        [
          "cost",
          "花费",
          metadata.cost_cents != null
            ? `¥${(metadata.cost_cents / 100).toFixed(2)}`
            : "选填",
        ],
        [
          "rating",
          "评个分吧",
          metadata.rating ? `${metadata.rating} ★` : "可跳过",
        ],
        ["location", "位置", metadata.location ? "已选择" : "选择地点"],
      ].map(([kind, label, detail]) => (
        <InteractivePressable
          key={kind}
          onPress={() => onEdit(kind)}
          accessibilityLabel={label}
          style={[s.action, s.metadataAction, { borderColor: colors.border }]}
        >
          <RN.Text
            style={{ color: colors.text, fontSize: 14, fontWeight: "500" }}
          >
            {label}
          </RN.Text>
          <RN.Text style={{ color: colors.muted, fontSize: 11 }}>
            {detail}
          </RN.Text>
        </InteractivePressable>
      ))}
    </RN.View>
  );
}

/** 花费、评分和最终保存共用同一编辑器；只有确认回调成功后才关闭。 */
export function MealEditor({ kind, initial = {}, onClose, onSave }) {
  const colors = useMealTheme();
  const reduced = useReducedMotion();
  const [cost, setCost] = React.useState(
    initial.cost_cents == null ? "" : (initial.cost_cents / 100).toFixed(2),
  );
  const [rating, setRating] = React.useState(initial.rating ?? null);
  const [location, setLocation] = React.useState(initial.location ?? null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  async function save() {
    if (saving) return;
    try {
      const metadata = normalizeMeal({
        cost_cents: parseCost(cost),
        rating,
        location,
      });
      setSaving(true);
      await onSave(metadata);
      onClose();
    } catch (error) {
      RN.Alert.alert("未能保存", String(error.message || error));
    } finally {
      setSaving(false);
    }
  }
  if (kind === "location") {
    return (
      <LocationPicker
        colors={colors}
        onClose={onClose}
        onSelect={async (value) => {
          await onSave(
            normalizeMeal({
              cost_cents: parseCost(cost),
              rating,
              location: value,
            }),
          );
          onClose();
        }}
      />
    );
  }
  const showLocation = kind === "confirm";
  return (
    <>
      <RN.Modal
        transparent
        visible
        animationType={reduced ? "none" : "fade"}
        onRequestClose={() => !saving && onClose()}
      >
        <RN.KeyboardAvoidingView
          style={s.scrim}
          behavior={RN.Platform.OS === "ios" ? "padding" : "height"}
        >
          <MotionView
            preset="dialog"
            style={[s.sheet, { backgroundColor: colors.background }]}
          >
            <RN.ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.form}
            >
              <RN.Text style={[s.title, { color: colors.text }]}>
                {
                  {
                    cost: "当餐花费",
                    rating: "评个分吧",
                    location: "这餐在哪里",
                    confirm: "保存这一餐",
                  }[kind]
                }
              </RN.Text>
              <RN.Text style={[s.hint, { color: colors.muted }]}>
                花费、评分和位置都可留空，之后也能在详情中补充。
              </RN.Text>
              {(kind === "cost" || kind === "confirm") && (
                <RN.View>
                  <RN.Text style={[s.label, { color: colors.text }]}>
                    花费（元）
                  </RN.Text>
                  <RN.TextInput
                    accessibilityLabel="当餐花费（元）"
                    value={cost}
                    onChangeText={setCost}
                    placeholder="未记录"
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    maxLength={10}
                    style={[
                      s.input,
                      { color: colors.text, borderColor: colors.border },
                    ]}
                  />
                </RN.View>
              )}
              {(kind === "rating" || kind === "confirm") && (
                <StarRating
                  value={rating}
                  onChange={setRating}
                  colors={colors}
                />
              )}
              {showLocation && (
                <RN.View style={s.location}>
                  <RN.Text style={[s.label, { color: colors.text }]}>
                    位置（选填）
                  </RN.Text>
                  <RN.Text style={[s.hint, { color: colors.muted }]}>
                    从附近地点中选择，或保留当前定位。
                  </RN.Text>
                  {location && (
                    <>
                      <RN.TextInput
                        accessibilityLabel="地点名称"
                        value={location.label}
                        onChangeText={(label) =>
                          setLocation({ ...location, label })
                        }
                        maxLength={120}
                        style={[
                          s.input,
                          { color: colors.text, borderColor: colors.border },
                        ]}
                      />
                      <RN.Text style={[s.hint, { color: colors.muted }]}>
                        {location.latitude.toFixed(4)},{" "}
                        {location.longitude.toFixed(4)}
                      </RN.Text>
                    </>
                  )}
                  <InteractivePressable
                    disabled={saving}
                    onPress={() => {
                      RN.Keyboard.dismiss();
                      setPickerOpen(true);
                    }}
                    style={[s.action, { borderColor: colors.border }]}
                  >
                    <RN.Text style={{ color: colors.text }}>
                      {location ? "更换附近地点" : "选择附近地点"}
                    </RN.Text>
                  </InteractivePressable>
                  {location && (
                    <InteractivePressable
                      style={s.clear}
                      onPress={() => setLocation(null)}
                    >
                      <RN.Text style={{ color: colors.muted }}>
                        不附加位置
                      </RN.Text>
                    </InteractivePressable>
                  )}
                </RN.View>
              )}
              <RN.View style={s.actions}>
                <InteractivePressable
                  disabled={saving}
                  onPress={onClose}
                  style={[s.action, { borderColor: colors.border }]}
                >
                  <RN.Text style={{ color: colors.text }}>取消</RN.Text>
                </InteractivePressable>
                <InteractivePressable
                  disabled={saving}
                  onPress={save}
                  style={[
                    s.action,
                    { backgroundColor: colors.text, borderColor: colors.text },
                  ]}
                >
                  <RN.Text style={{ color: colors.background }}>
                    {saving
                      ? "保存中…"
                      : kind === "confirm"
                        ? "保存记录"
                        : "确定"}
                  </RN.Text>
                </InteractivePressable>
              </RN.View>
            </RN.ScrollView>
          </MotionView>
        </RN.KeyboardAvoidingView>
      </RN.Modal>
      {pickerOpen && (
        <LocationPicker
          colors={colors}
          onClose={() => setPickerOpen(false)}
          onSelect={async (value) => {
            setLocation(value);
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}

const s = RN.StyleSheet.create({
  actions: { flexDirection: "row", gap: 12 },
  metadataAction: { minHeight: 56, paddingHorizontal: 6, gap: 3 },
  action: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  scrim: {
    flex: 1,
    backgroundColor: "#0008",
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  sheet: {
    width: "100%",
    maxWidth: 430,
    maxHeight: "90%",
    borderRadius: 24,
    padding: 24,
  },
  form: { gap: 18 },
  title: { fontSize: 22, fontWeight: "600" },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  hint: { fontSize: 12, lineHeight: 20 },
  input: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 17,
    marginTop: 8,
  },
  stars: {
    flexDirection: "row",
    width: 240,
    maxWidth: "100%",
    alignSelf: "center",
    paddingVertical: 8,
  },
  star: { flex: 1, height: 46 },
  starText: {
    width: 48,
    fontSize: 38,
    lineHeight: 46,
    textAlign: "center",
    includeFontPadding: false,
  },
  starFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    overflow: "hidden",
  },
  clear: {
    minHeight: 44,
    alignSelf: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  location: { gap: 8 },
});
