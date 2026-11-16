import { InteractivePressable } from "./src/components/InteractivePressable";
// 从先前构建缓存恢复的等价模块，已移除 Metro 外壳并恢复 JSX。
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import * as React from "react";
import * as RN from "react-native";
import * as SafeArea from "react-native-safe-area-context";
import * as expoStatusBar from "expo-status-bar";
import * as srcComponentsCaptureScreen from "./src/components/CaptureScreen";
import * as srcComponentsPhotoViewer from "./src/components/PhotoViewer";
import * as srcDataRepository from "./src/data/repository";
import * as Domain from "./src/domain/model";
import { MeasuredPhotoGrid } from "./src/components/MeasuredPhotoGrid";
import { LocalPhoto } from "./src/components/LocalPhoto";
import { groupMeals } from "./src/domain/meals";
import { MealEditor } from "./src/components/MealEditor";
import { MealOverlay } from "./src/components/MealOverlay";
import { showLocationPrivacy } from "./src/services/location";
import {
  pickPhotos,
  deletePhotoSources,
  getCaptureFolder,
  chooseCaptureFolder,
  resetCaptureFolder,
} from "./src/services/photos";
import {
  ThemeProvider,
  useThemePreference,
} from "./src/components/ThemeProvider";
import {
  MotionProvider,
  MotionView,
  useReducedMotion,
} from "./src/components/MotionView";
const repository = new srcDataRepository.Repository();
function App() {
  return (
    <ThemeProvider>
      <MotionProvider>
        <SafeArea.SafeAreaProvider>
          <Shike />
        </SafeArea.SafeAreaProvider>
      </MotionProvider>
    </ThemeProvider>
  );
}
function Shike() {
  const appearance = useThemePreference();
  const reducedMotion = useReducedMotion();
  const dark = RN.useColorScheme() === "dark";
  const colors = {
    background: dark ? "#000" : "#fff",
    text: dark ? "#f5f5f7" : "#1d1d1f",
    muted: dark ? "#98989d" : "#86868b",
    surface: dark ? "#1c1c1e" : "#f5f5f7",
    separator: dark ? "#262626" : "#e6e6e6",
  };
  const [photos, setPhotos] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const lock = React.useRef(false);
  const [section, setSection] = React.useState("home");
  const [mode, setMode] = React.useState("timeline");
  const [screen, setScreen] = React.useState({
    type: "home",
  });
  const [camera, setCamera] = React.useState(false);
  const captureClose = React.useRef(null);
  const [selectedDay, setSelectedDay] = React.useState(
    Domain.dayKey(new Date()),
  );
  const [month, setMonth] = React.useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selection, setSelection] = React.useState(null);
  const [deleting, setDeleting] = React.useState(null);
  const [deleteSource, setDeleteSource] = React.useState(false);
  const [mealEditor, setMealEditor] = React.useState(null);
  const [captureFolder, setCaptureFolder] = React.useState("");
  const [storage, setStorage] = React.useState({
    media: 0,
    backups: 0,
  });
  async function refresh() {
    setPhotos(await repository.photos());
    setStorage(repository.storage());
    setCaptureFolder(await getCaptureFolder());
  }
  React.useEffect(() => {
    repository
      .initialize()
      .then(refresh)
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoaded(true));
  }, []);
  React.useEffect(() => {
    const listener = RN.BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (busy || camera) return busy;
        if (selection) {
          setSelection(null);
          return true;
        }
        if (section === "settings") {
          setSection("home");
          return true;
        }
        if (screen.type !== "home") {
          back();
          return true;
        }
        return false;
      },
    );
    return () => listener.remove();
  });
  function back() {
    setSelection(null);
    setScreen(
      screen.type === "photo"
        ? {
            type: "day",
            day: screen.day,
          }
        : {
            type: "home",
          },
    );
  }

  /** 全局任务锁阻止备份、恢复与媒体写入相互交错。 */
  async function task(work, rethrow = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (reason) {
      if (rethrow) throw reason;
      RN.Alert.alert("操作未完成", String(reason));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function importPhotos(day) {
    await task(async () => {
      const assets = await pickPhotos();
      if (!assets.length) return;
      // 发起导入时日期已经确定，选择图片后直接归档，不再弹出日期确认。
      await repository.add(
        assets.map((asset) => ({
          uri: asset.uri,
          capturedAt: new Date(),
          assetId: asset.assetId,
          selected: true,
        })),
        day,
      );
      setSelectedDay(day);
    });
  }
  async function repairPhoto(photo) {
    await task(async () => {
      const assets = await pickPhotos(false);
      if (!assets.length) return;
      await repository.replaceMedia(photo, {
        ...assets[0],
        capturedAt: new Date(photo.captured_at),
        selected: true,
      });
    });
  }
  function requestDelete(items) {
    setDeleteSource(false);
    setDeleting(items);
  }
  async function linkOriginal() {
    const photo = deleting?.[0];
    if (!photo || deleting.length !== 1) return;
    setDeleting(null);
    await task(async () => {
      const assets = await pickPhotos(false);
      if (!assets.length) return;
      await repository.linkSource(photo.id, assets[0].assetId);
      // 关联后仍由用户勾选并确认删除，不会自动删除刚选择的原图。
      setDeleteSource(false);
      setDeleting([{ ...photo, source_asset_id: assets[0].assetId }]);
    });
  }
  async function confirmDelete() {
    if (!deleting) return;
    const items = deleting;
    setDeleting(null);
    await task(async () => {
      // 先处理用户明确要求删除的源文件；系统取消或拒绝时保留应用内记录。
      if (deleteSource) await deletePhotoSources(items);
      await repository.remove(items.map((photo) => photo.id));
      setSelection(null);
      if (screen.type === "photo") {
        const remaining = (await repository.photos()).filter(
          (photo) => photo.day_key === screen.day,
        );
        const position = photos
          .filter((photo) => photo.day_key === screen.day)
          .findIndex((photo) => photo.id === screen.id);
        setScreen(
          remaining.length
            ? {
                type: "photo",
                day: screen.day,
                id: remaining[Math.min(position, remaining.length - 1)].id,
              }
            : {
                type: "home",
              },
        );
      }
    });
  }
  async function exportBackup() {
    await task(async () => {
      const file = await repository.createBackup();
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("当前设备暂不支持系统分享");
      await Sharing.shareAsync(file.uri, {
        dialogTitle: "保存食刻备份",
        mimeType: "application/zip",
        UTI: "public.zip-archive",
      });
    });
  }
  async function restoreBackup() {
    await task(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const prepared = await repository.prepareRestore(result.assets[0].uri);
      const confirmed = await new Promise((resolve) =>
        RN.Alert.alert(
          "恢复备份？",
          `校验通过，共 ${prepared.count} 张照片。备份将替换当前记录，替换前会保存当前数据快照。`,
          [
            {
              text: "取消",
              style: "cancel",
              onPress: () => resolve(false),
            },
            {
              text: "确认恢复",
              onPress: () => resolve(true),
            },
          ],
          {
            cancelable: false,
          },
        ),
      );
      if (!confirmed) {
        await prepared.database.closeAsync();
        prepared.directory.delete();
        return;
      }
      try {
        await repository.restore(prepared);
      } catch (reason) {
        await prepared.database.closeAsync();
        prepared.directory.delete();
        throw reason;
      }
      setScreen({
        type: "home",
      });
      RN.Alert.alert("恢复完成", "你的餐桌记忆已完整归档。");
    });
  }
  const text = {
    color: colors.text,
  };
  const muted = {
    color: colors.muted,
  };
  const days = [...new Set(photos.map((photo) => photo.day_key))];
  const dayPhotos = (day) => photos.filter((photo) => photo.day_key === day);
  const button = (label, onPress, disabled = false, destructive = false) => (
    <InteractivePressable
      accessibilityRole={"button"}
      accessibilityLabel={label === "‹ 返回" ? "返回" : label}
      disabled={disabled}
      onPress={onPress}
      style={s.button}
    >
      {(label === "‹ 返回" || destructive) && (
        <RN.Image
          source={
            label === "‹ 返回"
              ? require("./assets/icons/back.png")
              : require("./assets/icons/trash.png")
          }
          style={[
            s.navigationIcon,
            { tintColor: destructive ? "#e24747" : colors.text },
          ]}
        />
      )}
      <RN.Text
        style={[
          text,
          s.buttonText,
          destructive && {
            color: "#ff3b30",
          },
        ]}
      >
        {label === "‹ 返回" ? "返回" : label}
      </RN.Text>
    </InteractivePressable>
  );
  function toggle(photo) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(photo.id)) next.delete(photo.id);
      else next.add(photo.id);
      return next;
    });
  }
  function grid(items, overflow = 0) {
    return (
      <MeasuredPhotoGrid style={s.grid}>
        {(tileSize) => (
          <>
            {items.map((photo, index) => (
              <InteractivePressable
                accessibilityRole={"imagebutton"}
                variant="image"
                accessibilityLabel={`${photo.day_key} 的第 ${index + 1} 张照片`}
                accessibilityState={{
                  selected: selection?.has(photo.id),
                }}
                onPress={() =>
                  selection
                    ? toggle(photo)
                    : !repository.hasMedia(photo)
                      ? repairPhoto(photo)
                      : setScreen({
                          type: "photo",
                          day: photo.day_key,
                          id: photo.id,
                        })
                }
                onLongPress={() =>
                  !repository.readOnly && setSelection(new Set([photo.id]))
                }
                style={[
                  s.tile,
                  { width: tileSize, height: tileSize },
                  {
                    backgroundColor: colors.surface,
                  },
                ]}
                key={photo.id}
              >
                <LocalPhoto
                  uri={repository.uri(photo.thumb_path)}
                  style={RN.StyleSheet.absoluteFill}
                  resizeMode={"cover"}
                  onRepair={() => repairPhoto(photo)}
                />
                {selection && (
                  <RN.Text style={s.check}>
                    {selection.has(photo.id) ? "●" : "○"}
                  </RN.Text>
                )}
              </InteractivePressable>
            ))}
            {overflow > 0 && (
              <InteractivePressable
                style={[
                  s.tile,
                  { width: tileSize, height: tileSize },
                  s.center,
                  {
                    backgroundColor: colors.surface,
                  },
                ]}
                onPress={() =>
                  setScreen({
                    type: "day",
                    day: items[0].day_key,
                  })
                }
              >
                <RN.Text style={[text, s.overflow]}>
                  {"+"}
                  {overflow}
                </RN.Text>
                <RN.Text style={[muted, s.tiny]}>{"查看完整记录 ↗"}</RN.Text>
              </InteractivePressable>
            )}
          </>
        )}
      </MeasuredPhotoGrid>
    );
  }
  function empty(day) {
    return (
      <RN.View style={[s.empty, s.center]}>
        <RN.Text
          style={[
            muted,
            {
              fontSize: 42,
              marginBottom: 20,
            },
          ]}
        >
          {"◷"}
        </RN.Text>
        <RN.Text style={[text, s.subtitle]}>{"这一天还没有记录"}</RN.Text>
        <RN.Text style={[muted, s.caption]}>
          {"吃饭这件小事，值得被记住。"}
        </RN.Text>
        {button(
          "从相册添加第一张照片",
          () => importPhotos(day),
          repository.readOnly,
        )}
      </RN.View>
    );
  }
  function daySection(day, all = false) {
    const items = dayPhotos(day);
    return (
      <RN.View style={s.day}>
        <RN.View style={[s.row, s.dayHeader]}>
          <InteractivePressable
            style={[s.grow, s.dayLink]}
            onPress={() =>
              setScreen({
                type: "day",
                day,
              })
            }
          >
            <RN.Text style={[text, s.subtitle]}>
              {Domain.dayTitle(day)} ›
            </RN.Text>
          </InteractivePressable>
          <RN.Text style={[muted, s.tiny]}>
            {items.length}
            {" 张"}
          </RN.Text>
          <InteractivePressable
            accessibilityLabel={`${day} 添加照片`}
            disabled={repository.readOnly}
            onPress={() => importPhotos(day)}
            style={[s.addPhoto, { borderColor: colors.separator }]}
          >
            <RN.Text style={[s.addPhotoText, text]}>＋ 添加</RN.Text>
          </InteractivePressable>
        </RN.View>
        {items.length
          ? all && screen.type === "day"
            ? groupMeals(items).map((group) => (
                <RN.View
                  key={group.id}
                  style={[s.mealGroup, { borderColor: colors.separator }]}
                >
                  <RN.Text style={[text, s.mealTime]}>
                    {group.legacy
                      ? "历史记录"
                      : new Date(group.started_at).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}{" "}
                    · {group.photos.length} 张
                  </RN.Text>
                  {group.location && (
                    <RN.Text style={[muted, s.caption]}>
                      {group.location.label}
                    </RN.Text>
                  )}
                  {(group.cost_cents != null || group.rating) && (
                    <RN.Text style={[muted, s.caption]}>
                      {[
                        group.cost_cents != null
                          ? `花费 ¥${(group.cost_cents / 100).toFixed(2)}`
                          : null,
                        group.rating ? `${group.rating} ★` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </RN.Text>
                  )}
                  {grid(group.photos)}
                </RN.View>
              ))
            : grid(
                all ? items : items.slice(0, 9),
                !all ? Math.max(0, items.length - 9) : 0,
              )
          : empty(day)}
      </RN.View>
    );
  }
  const hero = (
    <RN.View style={[s.hero, mode === "calendar" && s.calendarHero]}>
      <RN.Text style={[muted, s.brand]}>{"食 刻  S H I K È"}</RN.Text>
      <RN.Text
        style={[text, s.slogan, mode === "calendar" && s.calendarSlogan]}
      >
        {"记录每一餐"}
      </RN.Text>
      <RN.View style={[s.segment, { borderBottomColor: colors.separator }]}>
        {["timeline", "calendar"].map((value) => (
          <InteractivePressable
            accessibilityRole={"tab"}
            accessibilityState={{
              selected: mode === value,
            }}
            onPress={() => {
              setSelection(null);
              setMode(value);
            }}
            style={[
              s.segmentItem,
              mode === value && {
                borderBottomColor: colors.text,
              },
            ]}
            key={value}
          >
            <RN.Text
              style={{
                color: mode === value ? colors.text : colors.muted,
                fontWeight: mode === value ? "600" : "400",
              }}
            >
              {value === "timeline" ? "时间轴" : "日历"}
            </RN.Text>
          </InteractivePressable>
        ))}
      </RN.View>
    </RN.View>
  );
  function calendar() {
    return (
      <RN.View style={s.content}>
        <RN.View style={s.row}>
          {button("‹", () =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)),
          )}
          <RN.Text style={[text, s.grow, s.centerText, s.subtitle]}>
            {month.getFullYear()}
            {" 年 "}
            {month.getMonth() + 1}
            {" 月"}
          </RN.Text>
          {button("›", () =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)),
          )}
        </RN.View>
        <RN.View style={s.calendar}>
          {"一二三四五六日".split("").map((day) => (
            <RN.Text style={[muted, s.weekday]} key={day}>
              {day}
            </RN.Text>
          ))}
        </RN.View>
        <MotionView style={s.calendar} transitionKey={month.toISOString()}>
          {Domain.calendarCells(month).map((day, index) => (
            <RN.View style={s.dateCell} key={day ?? `blank-${index}`}>
              {day && (
                <InteractivePressable
                  accessibilityLabel={`${day}${days.includes(day) ? "，有记录" : ""}`}
                  accessibilityState={{
                    selected: day === selectedDay,
                  }}
                  onPress={() => {
                    setSelectedDay(day);
                    setSelection(null);
                  }}
                  style={[
                    s.date,
                    {
                      backgroundColor:
                        day === selectedDay ? colors.text : "transparent",
                    },
                  ]}
                >
                  <RN.Text
                    style={{
                      color:
                        day === selectedDay ? colors.background : colors.text,
                    }}
                  >
                    {Domain.parseDay(day).getDate()}
                  </RN.Text>
                  {days.includes(day) && (
                    <RN.View
                      style={[
                        s.dot,
                        {
                          backgroundColor:
                            day === selectedDay
                              ? colors.background
                              : colors.text,
                        },
                      ]}
                    />
                  )}
                </InteractivePressable>
              )}
            </RN.View>
          ))}
        </MotionView>
        <MotionView
          transitionKey={selectedDay}
          style={{
            marginTop: 28,
          }}
        >
          {daySection(selectedDay, true)}
        </MotionView>
      </RN.View>
    );
  }
  function settings() {
    const row = (title, subtitle, action) => (
      <InteractivePressable
        onPress={action}
        style={[s.settingsRow, { borderBottomColor: colors.separator }]}
        accessibilityRole={"button"}
      >
        <RN.View style={s.grow}>
          <RN.Text style={[text, s.subtitle]}>{title}</RN.Text>
          <RN.Text style={[muted, s.caption]}>{subtitle}</RN.Text>
        </RN.View>
        <RN.Text
          style={[
            muted,
            {
              fontSize: 24,
            },
          ]}
        >
          {"›"}
        </RN.Text>
      </InteractivePressable>
    );
    return (
      <RN.ScrollView contentContainerStyle={s.settings}>
        <InteractivePressable
          style={s.backHome}
          onPress={() => setSection("home")}
          accessibilityLabel="返回首页"
        >
          <RN.Image
            source={require("./assets/icons/back.png")}
            style={[s.navigationIcon, { tintColor: colors.text }]}
          />
          <RN.Text style={[text, s.backText]}>返回首页</RN.Text>
        </InteractivePressable>
        <RN.Text style={[text, s.pageTitle]}>{"设置"}</RN.Text>
        <RN.Text style={[text, s.appearanceTitle]}>外观</RN.Text>
        <RN.View style={s.appearanceOptions}>
          {[
            ["system", "跟随系统"],
            ["light", "日间"],
            ["dark", "夜晚"],
          ].map(([value, label]) => (
            <InteractivePressable
              key={value}
              accessibilityLabel={`外观：${label}`}
              accessibilityState={{ selected: appearance.mode === value }}
              onPress={() => appearance.setMode(value)}
              style={[
                s.appearanceOption,
                {
                  borderColor: colors.separator,
                  backgroundColor:
                    appearance.mode === value ? colors.text : "transparent",
                },
              ]}
            >
              <RN.Text
                style={{
                  fontSize: 14,
                  fontWeight: "500",
                  color:
                    appearance.mode === value ? colors.background : colors.text,
                }}
              >
                {label}
              </RN.Text>
            </InteractivePressable>
          ))}
        </RN.View>
        <RN.View
          style={{
            paddingVertical: 32,
          }}
        >
          <RN.Text style={[text, s.subtitle]}>{"你的餐桌记忆"}</RN.Text>
          <RN.Text style={[muted, s.caption]}>
            {days.length}
            {" 天 · "}
            {photos.length}
            {" 张照片"}
          </RN.Text>
        </RN.View>
        {row("拍摄原片保存目录", captureFolder || "读取中…", () => {
          if (RN.Platform.OS !== "android") return;
          RN.Alert.alert(
            "拍摄原片保存目录",
            "只影响之后确认保存的拍摄照片；既有照片不会移动，应用会继续保留独立副本。",
            [
              { text: "取消", style: "cancel" },
              {
                text: "恢复系统相册",
                onPress: () =>
                  task(async () => {
                    setCaptureFolder(await resetCaptureFolder());
                  }),
              },
              {
                text: "选择目录",
                onPress: () =>
                  task(async () => {
                    const folder = await chooseCaptureFolder();
                    if (folder) setCaptureFolder(folder);
                  }),
              },
            ],
          );
        })}
        <RN.Text style={[muted, s.caption]}>
          拍摄原片保存到上述位置；记录与缩略图保存在应用内。卸载会清除应用内记录，自选目录原片仍保留。
        </RN.Text>
        {row(
          "导出备份文件",
          "将全部记录和照片，保存在你选择的位置",
          exportBackup,
        )}
        {row(
          "从备份文件恢复",
          "校验通过后恢复，自动保留当前数据快照",
          restoreBackup,
        )}
        <RN.Text style={[muted, s.caption]}>
          {"应用内照片占用 "}
          {(storage.media / 1048576).toFixed(1)}
          {" MB"}
        </RN.Text>
        <RN.Text style={[muted, s.caption]}>
          {"备份占用 "}
          {(storage.backups / 1048576).toFixed(1)}
          {" MB"}
        </RN.Text>
        <RN.View
          style={{
            height: 24,
          }}
        />
        {row(
          "定位服务与隐私",
          "主动附加位置时使用高德定位，可撤回同意",
          showLocationPrivacy,
        )}
        {row("关于食刻", "Shikè 1.4.0 · 记录每一餐", () =>
          RN.Alert.alert(
            "食刻 Shikè 1.4.0",
            "照片、花费和评分保存在本机，无账号。主动使用高德定位时，必要的位置、设备与网络信息会发送给高德用于定位和地址解析。卸载应用会清除本地记录，请定期导出备份。\n\nReact Native · Expo · SQLite",
          ),
        )}
      </RN.ScrollView>
    );
  }
  const viewing =
    screen.type === "photo"
      ? groupMeals(dayPhotos(screen.day)).flatMap((group) => group.photos)
      : [];
  const viewedIndex =
    screen.type === "photo"
      ? Math.max(
          0,
          viewing.findIndex((photo) => photo.id === screen.id),
        )
      : 0;
  const viewedPhoto = viewing[viewedIndex];
  const viewedGroup = viewedPhoto
    ? groupMeals(viewing).find((group) => group.id === viewedPhoto.group_id)
    : null;
  if (!loaded)
    return (
      <SafeArea.SafeAreaView
        style={[
          s.root,
          s.center,
          {
            backgroundColor: colors.background,
          },
        ]}
      >
        <RN.ActivityIndicator color={colors.text} />
        <RN.Text style={[muted, s.caption]}>{"正在打开餐桌记忆…"}</RN.Text>
      </SafeArea.SafeAreaView>
    );
  if (error)
    return (
      <SafeArea.SafeAreaView
        style={[
          s.root,
          s.center,
          s.content,
          {
            backgroundColor: colors.background,
          },
        ]}
      >
        <RN.Text style={text}>{"无法打开本地数据，原文件已保留。"}</RN.Text>
        <RN.Text style={[muted, s.caption]}>{error}</RN.Text>
      </SafeArea.SafeAreaView>
    );
  return (
    <SafeArea.SafeAreaView
      style={[
        s.root,
        {
          backgroundColor: colors.background,
        },
      ]}
    >
      <expoStatusBar.StatusBar style={dark ? "light" : "dark"} />
      {/* 页面切换共用轻量过渡；不把照片 ID 放入键中，翻页由图片列表自己动画。 */}
      <MotionView
        style={s.grow}
        transitionKey={`${screen.type}:${section}:${mode}`}
      >
        {screen.type !== "home" && (
          <RN.View style={[s.row, s.content]}>
            {button("‹ 返回", back)}
            <RN.Text style={[text, s.grow, s.centerText]}>
              {screen.type === "day"
                ? Domain.dayTitle(screen.day)
                : `${viewedIndex + 1} / ${viewing.length}`}
            </RN.Text>
            {screen.type === "photo" &&
              viewedPhoto &&
              button(
                "删除",
                () => requestDelete([viewedPhoto]),
                repository.readOnly,
                true,
              )}
          </RN.View>
        )}
        {repository.warning && (
          <RN.View
            style={[
              s.content,
              {
                backgroundColor: colors.surface,
              },
            ]}
          >
            <RN.Text style={[text, s.caption]}>{repository.warning}</RN.Text>
            {button("备份与恢复", () => {
              setScreen({
                type: "home",
              });
              setSection("settings");
            })}
          </RN.View>
        )}
        {selection && (
          <RN.View style={[s.row, s.content]}>
            {button("取消", () => setSelection(null))}
            <RN.Text style={[text, s.grow, s.centerText]}>
              {"已选 "}
              {selection.size}
              {" 张"}
            </RN.Text>
            {button(
              "删除",
              () =>
                requestDelete(
                  photos.filter((photo) => selection.has(photo.id)),
                ),
              !selection.size,
              true,
            )}
          </RN.View>
        )}
        {screen.type === "photo" && viewedPhoto ? (
          <RN.View
            style={[
              s.grow,
              {
                backgroundColor: "#000",
              },
            ]}
          >
            <RN.View style={s.grow}>
              <srcComponentsPhotoViewer.PhotoViewer
                photos={viewing}
                selectedId={viewedPhoto.id}
                uri={(path) => repository.uri(path)}
                onRepair={repairPhoto}
                onSelect={(photo) =>
                  setScreen({
                    type: "photo",
                    day: photo.day_key,
                    id: photo.id,
                  })
                }
              />
              {viewedGroup && (
                <MealOverlay
                  key={viewedGroup.id}
                  group={viewedGroup}
                  onEdit={(kind) => setMealEditor({ kind, group: viewedGroup })}
                />
              )}
            </RN.View>
            <RN.View
              style={[
                s.row,
                {
                  justifyContent: "space-around",
                  padding: 16,
                },
              ]}
            >
              <InteractivePressable
                tone="dark"
                disabled={viewedIndex === 0}
                onPress={() =>
                  setScreen({
                    type: "photo",
                    day: viewedPhoto.day_key,
                    id: viewing[viewedIndex - 1].id,
                  })
                }
              >
                <RN.Text
                  style={{
                    color: viewedIndex === 0 ? "#555" : "#fff",
                    padding: 12,
                  }}
                >
                  {"‹ 上一张"}
                </RN.Text>
              </InteractivePressable>
              <InteractivePressable
                tone="dark"
                disabled={viewedIndex === viewing.length - 1}
                onPress={() =>
                  setScreen({
                    type: "photo",
                    day: viewedPhoto.day_key,
                    id: viewing[viewedIndex + 1].id,
                  })
                }
              >
                <RN.Text
                  style={{
                    color: viewedIndex === viewing.length - 1 ? "#555" : "#fff",
                    padding: 12,
                  }}
                >
                  {"下一张 ›"}
                </RN.Text>
              </InteractivePressable>
            </RN.View>
          </RN.View>
        ) : screen.type === "day" ? (
          <RN.ScrollView contentContainerStyle={[s.content, s.bottomSpace]}>
            {daySection(screen.day, true)}
          </RN.ScrollView>
        ) : section === "settings" ? (
          settings()
        ) : mode === "timeline" ? (
          <RN.FlatList
            data={days}
            keyExtractor={(day) => day}
            ListHeaderComponent={hero}
            ListEmptyComponent={empty(Domain.dayKey(new Date()))}
            contentContainerStyle={s.bottomSpace}
            renderItem={({ item }) => (
              <RN.View style={s.content}>{daySection(item)}</RN.View>
            )}
          />
        ) : (
          <RN.ScrollView contentContainerStyle={s.bottomSpace}>
            {hero}
            {calendar()}
          </RN.ScrollView>
        )}
        {/* 拍摄作为主要操作置上，设置置下；图标提供无障碍名称但不占用文字空间。 */}
        {screen.type === "home" && section === "home" && (
          <RN.View style={s.floatingActions}>
            <InteractivePressable
              variant="floating"
              accessibilityLabel="拍照记录"
              disabled={repository.readOnly}
              onPress={() => setCamera(true)}
              style={[s.floatingButton, { backgroundColor: colors.text }]}
            >
              <RN.Image
                source={require("./assets/icons/camera.png")}
                style={[s.floatingIcon, { tintColor: colors.background }]}
              />
            </InteractivePressable>
            <InteractivePressable
              variant="floating"
              accessibilityLabel="打开设置"
              onPress={() => {
                setSelection(null);
                setSection("settings");
              }}
              style={[
                s.floatingButton,
                s.secondaryFloating,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.separator,
                },
              ]}
            >
              <RN.Image
                source={require("./assets/icons/settings.png")}
                style={[s.floatingIcon, { tintColor: colors.text }]}
              />
            </InteractivePressable>
          </RN.View>
        )}
      </MotionView>
      <RN.Modal
        visible={camera}
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={() => captureClose.current?.()}
      >
        <SafeArea.SafeAreaView
          style={{
            flex: 1,
            backgroundColor: "#000",
          }}
        >
          <srcComponentsCaptureScreen.CaptureScreen
            onClose={() => setCamera(false)}
            registerClose={(handler) => {
              captureClose.current = handler;
            }}
            onSave={async (items, metadata) => {
              await repository.add(items, undefined, null, metadata);
              await refresh();
            }}
          />
        </SafeArea.SafeAreaView>
      </RN.Modal>
      <RN.Modal
        visible={!!deleting}
        transparent={true}
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={() => setDeleting(null)}
      >
        <RN.View style={s.scrim}>
          <MotionView
            preset="dialog"
            style={[
              s.dialog,
              {
                backgroundColor: colors.background,
              },
            ]}
          >
            <RN.Text style={[text, s.subtitle]}>
              {"删除 "}
              {deleting?.length}
              {" 张照片？"}
            </RN.Text>
            <RN.Text style={[muted, s.caption]}>
              {"将从记录中移除选中的照片，记录本身不可恢复。"}
            </RN.Text>
            <RN.View
              style={[
                s.row,
                {
                  paddingVertical: 20,
                  gap: 12,
                },
              ]}
            >
              <RN.Switch
                accessibilityLabel="同时删除源文件"
                value={deleteSource}
                onValueChange={setDeleteSource}
                disabled={!deleting?.some((photo) => photo.source_asset_id)}
                trackColor={{
                  true: colors.text,
                  false: colors.surface,
                }}
              />
              <RN.Text style={[text, s.grow]}>
                {"同时删除源文件（不可恢复）"}
              </RN.Text>
            </RN.View>
            {deleteSource && (
              <RN.Text
                style={{
                  color: "#ff3b30",
                }}
              >
                {"源文件删除后不可恢复。"}
              </RN.Text>
            )}
            {!deleting?.some((photo) => photo.source_asset_id) && (
              <RN.Text style={[muted, s.caption]}>
                {
                  "旧记录未保留源文件引用。可单张关联对应原图，或只删除应用记录。"
                }
              </RN.Text>
            )}
            {!!deleting?.some((photo) => photo.source_asset_id) &&
              deleting.some((photo) => !photo.source_asset_id) && (
                <RN.Text style={[muted, s.caption]}>
                  仅删除其中有源文件引用的原片，其余旧照片只移除应用记录。
                </RN.Text>
              )}
            {deleting?.length === 1 && !deleting[0].source_asset_id && (
              <InteractivePressable onPress={linkOriginal}>
                <RN.Text style={[text, s.caption]}>
                  关联原图（请选择同一张照片）
                </RN.Text>
              </InteractivePressable>
            )}
            {/* 两个操作等分可用宽度，弹窗 padding 保留两侧留白，gap 提供独立间隔。 */}
            <RN.View style={[s.row, s.dialogActions]}>
              <InteractivePressable
                onPress={() => setDeleting(null)}
                style={[s.dialogAction, { borderColor: colors.separator }]}
              >
                <RN.Text style={[text, s.dialogActionText]}>取消</RN.Text>
              </InteractivePressable>
              <InteractivePressable
                onPress={confirmDelete}
                style={[s.dialogAction, s.confirmDelete]}
              >
                <RN.Text style={[s.dialogActionText, { color: "#fff" }]}>
                  删除
                </RN.Text>
              </InteractivePressable>
            </RN.View>
          </MotionView>
        </RN.View>
      </RN.Modal>
      {mealEditor && (
        <MealEditor
          kind={mealEditor.kind}
          initial={mealEditor.group}
          onClose={() => setMealEditor(null)}
          onSave={(metadata) =>
            task(
              () => repository.updateMeal(mealEditor.group.id, metadata),
              true,
            )
          }
        />
      )}
      {busy && (
        <RN.View style={[RN.StyleSheet.absoluteFill, s.scrim]}>
          <RN.ActivityIndicator color={"#fff"} size={"large"} />
        </RN.View>
      )}
    </SafeArea.SafeAreaView>
  );
}
const s = RN.StyleSheet.create({
  root: {
    flex: 1,
  },
  grow: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerText: {
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  content: {
    paddingHorizontal: 20,
  },
  bottomSpace: {
    paddingBottom: 180,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  buttonText: { fontSize: 17, lineHeight: 24, fontWeight: "600" },
  navigationIcon: { width: 26, height: 26 },
  hero: {
    alignItems: "center",
    paddingTop: 36,
    paddingBottom: 24,
  },
  // 日历额外占用六行日期，收紧顶部留白，避免日期添加入口落在浮动按钮下方。
  calendarHero: { paddingTop: 16, paddingBottom: 16 },
  calendarSlogan: { fontSize: 28, lineHeight: 40, marginVertical: 16 },
  brand: {
    fontSize: 12,
    letterSpacing: 3,
  },
  slogan: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: "600",
    letterSpacing: 1,
    textAlign: "center",
    marginVertical: 32,
  },
  segment: {
    flexDirection: "row",
    borderBottomWidth: RN.StyleSheet.hairlineWidth,
    gap: 28,
  },
  segmentItem: {
    borderRadius: 0,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  day: {
    marginBottom: 28,
  },
  mealGroup: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: RN.StyleSheet.hairlineWidth,
  },
  mealTime: { fontSize: 14, fontWeight: "600" },
  subtitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  caption: {
    fontSize: 13,
    lineHeight: 22,
    marginTop: 8,
  },
  tiny: {
    fontSize: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  tile: {
    width: "31.7%",
    aspectRatio: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  check: {
    position: "absolute",
    left: 7,
    top: 2,
    fontSize: 26,
    color: "#fff",
    textShadowColor: "#000",
    textShadowRadius: 4,
  },
  overflow: {
    fontSize: 26,
    marginBottom: 4,
  },
  empty: {
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  calendar: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  weekday: {
    width: "14.285%",
    textAlign: "center",
    paddingVertical: 10,
  },
  dateCell: {
    width: "14.285%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  date: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  floatingActions: {
    position: "absolute",
    right: 20,
    bottom: 100,
    gap: 12,
  },
  floatingButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 5,
    },
  },
  secondaryFloating: { borderWidth: 1 },
  floatingIcon: { width: 26, height: 26 },
  dayHeader: { gap: 10, minHeight: 54 },
  dayLink: { justifyContent: "center", minHeight: 44 },
  addPhoto: {
    minWidth: 76,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: RN.StyleSheet.hairlineWidth,
  },
  addPhotoText: { fontSize: 13, fontWeight: "600" },
  settings: {
    padding: 24,
    paddingTop: 12,
    paddingBottom: 120,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: "600",
  },
  backHome: {
    alignSelf: "flex-start",
    justifyContent: "center",
    marginBottom: 12,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backText: { fontSize: 17, fontWeight: "600" },
  appearanceTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 28,
    marginBottom: 12,
  },
  appearanceOptions: { flexDirection: "row", gap: 10 },
  appearanceOption: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 22,
    paddingHorizontal: 0,
    borderRadius: 0,
    borderBottomWidth: RN.StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  scrim: {
    flex: 1,
    backgroundColor: "#0008",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  dialog: {
    width: "100%",
    maxWidth: 430,
    borderRadius: 24,
    padding: 24,
  },
  dialogActions: { gap: 12, marginTop: 20 },
  dialogAction: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogActionText: { fontSize: 15, fontWeight: "600" },
  confirmDelete: { backgroundColor: "#e53935", borderColor: "#e53935" },
});
export default App;
