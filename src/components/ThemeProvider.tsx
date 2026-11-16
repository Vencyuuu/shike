import * as React from "react";
import { Appearance } from "react-native";
import { File, Paths } from "expo-file-system";

type ThemeMode = "system" | "light" | "dark";
const ThemePreference = React.createContext<{
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}>({
  mode: "system",
  setMode: () => {},
});
const isThemeMode = (value: unknown): value is ThemeMode =>
  value === "system" || value === "light" || value === "dark";

/** 统一覆盖系统外观，让页面、弹窗、原生提示与状态栏使用相同主题。 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, updateMode] = React.useState<ThemeMode>("system");
  const writes = React.useRef(Promise.resolve());
  const revision = React.useRef(0);
  React.useEffect(() => {
    let active = true;
    const initialRevision = revision.current;
    const file = new File(Paths.document, "shike-appearance.json");
    (async () => {
      try {
        const stored = file.exists
          ? JSON.parse(await file.text()).mode
          : "system";
        if (
          active &&
          revision.current === initialRevision &&
          isThemeMode(stored)
        ) {
          // React Native 0.88 使用 auto 跟随系统，不能向原生接口传入 null。
          Appearance.setColorScheme(stored === "system" ? "auto" : stored);
          updateMode(stored);
        }
      } catch {
        /* 配置损坏或不可读时使用系统主题，不影响照片数据。 */
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  const setMode = React.useCallback((next: ThemeMode) => {
    if (!isThemeMode(next)) return;
    revision.current++;
    updateMode(next);
    Appearance.setColorScheme(next === "system" ? "auto" : next);
    // 连续点击按顺序写入，最后一次选择不会被较早的异步写入覆盖。
    writes.current = writes.current
      .catch(() => {})
      .then(async () => {
        await new File(Paths.document, "shike-appearance.json").write(
          JSON.stringify({ mode: next }),
        );
      })
      .catch(() => {
        /* 本次外观已生效，下次启动无法读取时回到跟随系统。 */
      });
  }, []);
  return (
    <ThemePreference.Provider value={{ mode, setMode }}>
      {children}
    </ThemePreference.Provider>
  );
}
export const useThemePreference = () => React.useContext(ThemePreference);
