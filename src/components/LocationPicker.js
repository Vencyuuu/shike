import * as React from "react";
import * as RN from "react-native";
import { MotionView, useReducedMotion } from "./MotionView";
import { InteractivePressable } from "./InteractivePressable";
import { getMealLocation, searchMealPlaces } from "../services/location";
import { placeDistance, selectPlace } from "../domain/places";

/** 定位与 POI 搜索独立管理；只有选中并确认才改变餐次，不将列表第一项自动写入。 */
export function LocationPicker({ colors, onClose, onSelect }) {
  const reduced = useReducedMotion();
  const [fix, setFix] = React.useState(null);
  const [items, setItems] = React.useState([]);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState(null);
  const [locating, setLocating] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [revision, setRevision] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    const controller = new AbortController();
    getMealLocation(controller.signal)
      .then((position) => {
        if (!controller.signal.aborted) {
          setFix(position);
          setLocating(false);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setLocating(false);
          setError(
            reason.code === "E_LOCATION_CANCELLED"
              ? "未获取位置，仍可关闭后继续保存这一餐。"
              : String(reason.message || reason),
          );
        }
      });
    return () => controller.abort();
  }, [revision]);
  React.useEffect(() => {
    if (!fix) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError("");
        searchMealPlaces(fix, query.trim(), controller.signal)
          .then((places) => {
            if (!controller.signal.aborted) {
              setItems(places);
              setLoading(false);
            }
          })
          .catch((reason) => {
            if (!controller.signal.aborted) {
              setLoading(false);
              setItems([]);
              setError(String(reason.message || reason));
            }
          });
      },
      query.trim() ? 400 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fix, query]);
  function refresh() {
    setFix(null);
    setItems([]);
    setError("");
    setLocating(true);
    setSelected(null);
    setRevision((value) => value + 1);
  }
  async function confirm(value) {
    if (saving) return;
    setSaving(true);
    RN.Keyboard.dismiss();
    try {
      await onSelect(value);
    } catch (reason) {
      RN.Alert.alert("未能保存位置", String(reason.message || reason));
    } finally {
      setSaving(false);
    }
  }
  const choices = fix
    ? [{ id: "current", title: "当前位置", address: fix.label }, ...items]
    : [];
  return (
    <RN.Modal
      visible
      transparent
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
          <RN.View style={s.header}>
            <RN.Text style={[s.title, { color: colors.text }]}>
              选择附近地点
            </RN.Text>
            <InteractivePressable
              onPress={onClose}
              disabled={saving}
              style={s.close}
              accessibilityLabel="关闭地点选择"
            >
              <RN.Text style={{ color: colors.text, fontSize: 17 }}>
                关闭
              </RN.Text>
            </InteractivePressable>
          </RN.View>
          <RN.Text style={[s.caption, { color: colors.muted }]}>
            选一个更准确的地点，确认后才附加到这一餐。
          </RN.Text>
          <RN.TextInput
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setSelected(null);
            }}
            editable={!!fix && !saving}
            accessibilityLabel="搜索附近地点"
            placeholder="搜索附近餐厅或地点"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            maxLength={60}
            onSubmitEditing={() => RN.Keyboard.dismiss()}
            style={[
              s.search,
              { color: colors.text, borderColor: colors.border },
            ]}
          />
          <RN.View style={s.status}>
            <RN.Text style={[s.caption, s.grow, { color: colors.muted }]}>
              {locating
                ? "正在定位…"
                : loading
                  ? "正在搜索附近地点…"
                  : fix
                    ? `附近约 2 公里 · ${items.length} 个地点`
                    : "位置尚未获取"}
            </RN.Text>
            <InteractivePressable
              onPress={refresh}
              disabled={locating || saving}
              style={s.refresh}
            >
              <RN.Text style={{ color: colors.text, fontSize: 13 }}>
                重新定位
              </RN.Text>
            </InteractivePressable>
          </RN.View>
          {!!error && (
            <RN.Text
              style={[s.caption, { color: colors.muted, paddingBottom: 8 }]}
            >
              {error}
            </RN.Text>
          )}
          {locating ? (
            <RN.View style={s.empty}>
              <RN.ActivityIndicator color={colors.text} />
              <RN.Text style={[s.caption, { color: colors.muted }]}>
                可以随时关闭或选择不附加位置
              </RN.Text>
            </RN.View>
          ) : (
            <RN.FlatList
              style={s.grow}
              data={choices}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <RN.Text
                  style={[s.caption, { color: colors.muted, padding: 20 }]}
                >
                  暂时无法获取附近地点，可重试或不附加位置。
                </RN.Text>
              }
              ListFooterComponent={
                fix && !loading && !items.length ? (
                  <RN.Text
                    style={[
                      s.caption,
                      { color: colors.muted, paddingVertical: 16 },
                    ]}
                  >
                    没有找到其他地点，试试关键词或选择当前位置。
                  </RN.Text>
                ) : null
              }
              renderItem={({ item }) => (
                <InteractivePressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected?.id === item.id }}
                  accessibilityLabel={`选择地点 ${item.title}`}
                  onPress={() => {
                    setSelected(item);
                    RN.Keyboard.dismiss();
                  }}
                  style={[s.place, { borderBottomColor: colors.border }]}
                >
                  <RN.View style={s.grow}>
                    <RN.View style={s.placeTitle}>
                      <RN.Text
                        style={[s.placeName, s.grow, { color: colors.text }]}
                        numberOfLines={2}
                      >
                        {item.title}
                      </RN.Text>
                      <RN.Text style={[s.caption, { color: colors.muted }]}>
                        {placeDistance(item.distance)}
                      </RN.Text>
                    </RN.View>
                    <RN.Text
                      style={[s.caption, { color: colors.muted }]}
                      numberOfLines={2}
                    >
                      {item.address || "暂无详细地址"}
                    </RN.Text>
                  </RN.View>
                  <RN.View
                    style={[
                      s.radio,
                      {
                        borderColor:
                          selected?.id === item.id
                            ? colors.text
                            : colors.border,
                      },
                    ]}
                  >
                    {selected?.id === item.id && (
                      <RN.View
                        style={[s.radioDot, { backgroundColor: colors.text }]}
                      />
                    )}
                  </RN.View>
                </InteractivePressable>
              )}
            />
          )}
          <RN.Text
            style={[s.caption, { color: colors.muted, marginTop: 10 }]}
            numberOfLines={1}
          >
            {selected ? `已选择：${selected.title}` : "请选择一个地点"}
          </RN.Text>
          <RN.View style={s.footer}>
            <InteractivePressable
              disabled={saving}
              onPress={() => confirm(null)}
              style={[s.button, { borderColor: colors.border }]}
            >
              <RN.Text style={{ color: colors.text, fontSize: 14 }}>
                不附加位置
              </RN.Text>
            </InteractivePressable>
            <InteractivePressable
              disabled={!selected || saving}
              onPress={() =>
                confirm(
                  selectPlace(fix, selected.id === "current" ? null : selected),
                )
              }
              style={[
                s.button,
                { backgroundColor: colors.text, borderColor: colors.text },
              ]}
            >
              <RN.Text
                style={{
                  color: colors.background,
                  fontSize: 14,
                  fontWeight: "600",
                }}
              >
                {saving ? "保存中…" : "使用这个位置"}
              </RN.Text>
            </InteractivePressable>
          </RN.View>
        </MotionView>
      </RN.KeyboardAvoidingView>
    </RN.Modal>
  );
}
const s = RN.StyleSheet.create({
  scrim: {
    flex: 1,
    padding: 20,
    backgroundColor: "#0008",
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    width: "100%",
    maxWidth: 460,
    height: "86%",
    borderRadius: 24,
    padding: 20,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontSize: 21, fontWeight: "600" },
  close: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  caption: { fontSize: 12, lineHeight: 19 },
  grow: { flex: 1 },
  search: {
    height: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginTop: 16,
    fontSize: 15,
  },
  status: { flexDirection: "row", alignItems: "center", gap: 8 },
  refresh: { justifyContent: "center", paddingHorizontal: 4 },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 76,
    paddingVertical: 13,
    borderRadius: 0,
    borderBottomWidth: RN.StyleSheet.hairlineWidth,
  },
  placeTitle: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    marginBottom: 5,
  },
  placeName: { fontSize: 16, lineHeight: 22, fontWeight: "500" },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  footer: { flexDirection: "row", gap: 12, marginTop: 12 },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
});
