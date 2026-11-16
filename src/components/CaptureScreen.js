import {
  InteractivePressable,
  DarkInteractionSurface,
} from "./InteractivePressable";
// 从先前构建缓存恢复的等价模块，已移除 Metro 外壳并恢复 JSX。
import * as React from "react";
import * as RN from "react-native";
import * as expoCamera from "expo-camera";
import * as expoFileSystem from "expo-file-system";
import { MeasuredPhotoGrid } from "./MeasuredPhotoGrid";
import { LocalPhoto } from "./LocalPhoto";
import { PhotoViewer } from "./PhotoViewer";
import { SafeAreaView } from "react-native-safe-area-context";
import { MotionView, useReducedMotion } from "./MotionView";
import { MealActions, MealEditor } from "./MealEditor";
function CaptureScreen({ onClose, onSave, registerClose }) {
  const reducedMotion = useReducedMotion();
  const camera = React.useRef(null);
  const [permission, requestPermission] = expoCamera.useCameraPermissions();
  const [photos, setPhotos] = React.useState([]);
  const [review, setReview] = React.useState(false);
  const [metadata, setMetadata] = React.useState({});
  const [editor, setEditor] = React.useState(null);
  const [previewId, setPreviewId] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [active, setActive] = React.useState(
    RN.AppState.currentState === "active",
  );
  const lock = React.useRef(false);
  React.useEffect(() => {
    const listener = RN.AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => listener.remove();
  }, []);
  function close() {
    if (busy) return;
    const discard = () => {
      for (let photo of photos) {
        try {
          new expoFileSystem.File(photo.uri).delete();
        } catch {
          /* 系统缓存会再次兜底清理。 */
        }
      }
      onClose();
    };
    if (!photos.length) discard();
    else
      RN.Alert.alert("放弃本次拍摄的照片？", "未入档的照片将被移除。", [
        {
          text: "继续记录",
          style: "cancel",
        },
        {
          text: "放弃",
          style: "destructive",
          onPress: discard,
        },
      ]);
  }

  // Android 返回键与页面取消共用相同的放弃确认逻辑。
  React.useEffect(() => {
    registerClose(close);
  });
  async function shoot() {
    if (lock.current || !ready || photos.length >= 12) return;
    lock.current = true;
    setBusy(true);
    const capturedAt = new Date();
    try {
      const result = await camera.current?.takePictureAsync({
        quality: 0.85,
      });
      if (result)
        setPhotos((current) => [
          ...current,
          {
            uri: result.uri,
            isCapture: true,
            capturedAt,
            selected: true,
          },
        ]);
    } catch {
      RN.Alert.alert("拍摄失败", "请检查相机权限与存储空间后重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(details) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await onSave(photos, details);
      for (let photo of photos) {
        try {
          new expoFileSystem.File(photo.uri).delete();
        } catch {
          /* 不影响已经保存的记录。 */
        }
      }
      onClose();
    } catch (error) {
      // 完成按钮直接入档；失败时在当前筛选页提示，并保留临时照片供重试。
      RN.Alert.alert("未能保存", String(error.message || error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <DarkInteractionSurface>
      <MotionView style={s.root} transitionKey={review ? "review" : "camera"}>
        <RN.View style={s.toolbar}>
          <InteractivePressable
            style={s.toolbarAction}
            onPress={close}
            disabled={busy}
          >
            <RN.Text style={s.text}>{"取消"}</RN.Text>
          </InteractivePressable>
          <RN.Text style={s.title}>
            {review ? "留下喜欢的食刻" : "记录这一餐"}
          </RN.Text>
          <InteractivePressable
            style={s.toolbarAction}
            disabled={busy || !photos.some((photo) => photo.selected)}
            onPress={() => {
              // 餐次信息完全选填，只保存用户已主动确认的内容，不再二次询问。
              if (review) void save(metadata);
              else setReview(true);
            }}
          >
            <RN.Text style={[s.text, s.primaryText]}>
              {review
                ? `完成 (${photos.filter((p) => p.selected).length})`
                : `筛选 (${photos.length})`}
            </RN.Text>
          </InteractivePressable>
        </RN.View>
        {review ? (
          <RN.ScrollView contentContainerStyle={s.reviewContent}>
            <MeasuredPhotoGrid style={s.grid} horizontalPadding={20}>
              {(tileSize) => (
                <>
                  {photos.map((photo, index) => (
                    <InteractivePressable
                      variant="image"
                      style={[
                        s.tile,
                        { width: tileSize, height: tileSize },
                        {
                          opacity: photo.selected ? 1 : 0.3,
                        },
                      ]}
                      accessibilityLabel={`照片 ${index + 1}`}
                      accessibilityState={{
                        selected: photo.selected,
                      }}
                      onPress={() =>
                        setPhotos((current) =>
                          current.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  selected: !item.selected,
                                }
                              : item,
                          ),
                        )
                      }
                      key={photo.uri}
                    >
                      <LocalPhoto
                        uri={photo.uri}
                        style={RN.StyleSheet.absoluteFill}
                      />
                      <RN.View
                        style={[s.check, photo.selected && s.checkSelected]}
                      >
                        <RN.Text style={s.checkText}>
                          {photo.selected ? "✓" : ""}
                        </RN.Text>
                      </RN.View>
                      <InteractivePressable
                        style={s.previewButton}
                        accessibilityLabel={`预览照片 ${index + 1}`}
                        onPress={(event) => {
                          event.stopPropagation();
                          setPreviewId(photo.uri);
                        }}
                      >
                        <RN.Text style={s.previewText}>预览</RN.Text>
                      </InteractivePressable>
                    </InteractivePressable>
                  ))}
                </>
              )}
            </MeasuredPhotoGrid>
            {/* 操作区独立控制留白与按钮层级，避免共享点击样式挤压文本和边距。 */}
            <RN.View style={s.reviewActions}>
              <MealActions dark metadata={metadata} onEdit={setEditor} />
              <InteractivePressable
                style={s.selectAction}
                accessibilityLabel={
                  photos.every((photo) => photo.selected) ? "全部取消" : "全选"
                }
                onPress={() =>
                  setPhotos((current) => {
                    const selected = !current.every((photo) => photo.selected);
                    return current.map((photo) => ({
                      ...photo,
                      selected,
                    }));
                  })
                }
              >
                <RN.Text style={[s.text, s.primaryText]}>
                  {photos.every((photo) => photo.selected)
                    ? "全部取消"
                    : "全选"}
                </RN.Text>
              </InteractivePressable>
              <InteractivePressable
                style={s.continueAction}
                onPress={() => setReview(false)}
              >
                <RN.Text style={[s.text, s.continueText]}>{"继续拍摄"}</RN.Text>
              </InteractivePressable>
            </RN.View>
          </RN.ScrollView>
        ) : permission?.granted ? (
          <>
            <RN.View style={s.preview}>
              {active && (
                <expoCamera.CameraView
                  ref={camera}
                  style={RN.StyleSheet.absoluteFill}
                  facing={"back"}
                  onCameraReady={() => setReady(true)}
                  onMountError={() => {
                    setReady(false);
                    RN.Alert.alert("相机不可用", "请检查权限后重新打开。");
                  }}
                />
              )}
            </RN.View>
            <RN.Text style={s.counter}>
              {photos.length >= 12
                ? "本次最多 12 张，请先筛选入档"
                : `${photos.length} / 12`}
            </RN.Text>
            <InteractivePressable
              accessibilityLabel={"拍摄照片"}
              disabled={busy || !ready || photos.length >= 12}
              onPress={shoot}
              style={[
                s.shutter,
                {
                  opacity: busy ? 0.4 : 1,
                },
              ]}
            >
              <RN.View style={s.shutterInner} />
            </InteractivePressable>
          </>
        ) : (
          <RN.View style={s.permission}>
            <RN.Text style={s.title}>{"用一张照片，记住这一餐"}</RN.Text>
            <RN.Text style={s.counter}>
              {"相机权限只用于拍摄饮食照片，不录制声音。"}
            </RN.Text>
            <InteractivePressable
              style={s.action}
              onPress={() =>
                permission?.canAskAgain === false
                  ? RN.Linking.openSettings()
                  : requestPermission()
              }
            >
              <RN.Text style={s.text}>
                {permission?.canAskAgain === false
                  ? "前往系统设置"
                  : "允许使用相机"}
              </RN.Text>
            </InteractivePressable>
          </RN.View>
        )}
        <RN.Modal
          visible={previewId !== null}
          animationType={reducedMotion ? "none" : "fade"}
          onRequestClose={() => setPreviewId(null)}
        >
          <SafeAreaView style={s.root}>
            <RN.View style={s.toolbar}>
              <InteractivePressable
                style={s.toolbarAction}
                accessibilityLabel="关闭预览"
                onPress={() => setPreviewId(null)}
              >
                <RN.Text style={s.text}>关闭预览</RN.Text>
              </InteractivePressable>
              <RN.Text style={s.title}>拍摄预览</RN.Text>
              <InteractivePressable
                style={s.toolbarAction}
                onPress={() =>
                  setPhotos((current) =>
                    current.map((photo) =>
                      photo.uri === previewId
                        ? { ...photo, selected: !photo.selected }
                        : photo,
                    ),
                  )
                }
              >
                <RN.Text style={s.text}>
                  {photos.find((photo) => photo.uri === previewId)?.selected
                    ? "取消选中"
                    : "选中照片"}
                </RN.Text>
              </InteractivePressable>
            </RN.View>
            {previewId && (
              <PhotoViewer
                photos={photos.map((photo) => ({
                  id: photo.uri,
                  original_path: photo.uri,
                }))}
                selectedId={previewId}
                uri={(value) => value}
                onSelect={(photo) => setPreviewId(photo.id)}
              />
            )}
          </SafeAreaView>
        </RN.Modal>
        {editor && (
          <MealEditor
            kind={editor}
            initial={metadata}
            onClose={() => setEditor(null)}
            onSave={setMetadata}
          />
        )}
      </MotionView>
    </DarkInteractionSurface>
  );
}
const s = RN.StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    paddingBottom: 24,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  toolbarAction: {
    minWidth: 64,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  text: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
    includeFontPadding: false,
    lineHeight: 22,
  },
  primaryText: { color: "#70b8ff", fontWeight: "600" },
  title: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "center",
    includeFontPadding: false,
  },
  preview: {
    flex: 1,
    overflow: "hidden",
    marginBottom: 20,
  },
  counter: {
    color: "#aaa",
    textAlign: "center",
    padding: 14,
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#555",
    alignSelf: "center",
    padding: 5,
  },
  shutterInner: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 40,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 20,
  },
  reviewContent: { paddingBottom: 24 },
  tile: {
    width: "31%",
    aspectRatio: 1,
    overflow: "hidden",
    borderRadius: 12,
  },
  check: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderColor: "#fff",
    borderWidth: 2,
    backgroundColor: "#0005",
    alignItems: "center",
    justifyContent: "center",
  },
  checkSelected: { backgroundColor: "#0095f6" },
  checkText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    includeFontPadding: false,
  },
  previewButton: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#0009",
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  previewText: { color: "#fff", fontSize: 12 },
  action: {
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderWidth: 1,
    borderColor: "#555",
    borderRadius: 8,
    marginTop: 16,
  },
  reviewActions: { marginHorizontal: 20, marginTop: 4, gap: 16 },
  selectAction: {
    alignSelf: "flex-end",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  continueAction: {
    height: 48,
    backgroundColor: "#fff",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  continueText: { color: "#111", fontWeight: "600" },
  permission: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
});
export { CaptureScreen };
