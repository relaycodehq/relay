// Unfolded foldables and tablets: the thread list stays beside whatever is open.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Dimensions,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ScreenOrientation from "expo-screen-orientation";
import { PanelLeft } from "lucide-react-native";
import { useTheme } from "./theme";

/** Android's medium window class: a foldable opened up, or a tablet. */
export const paneBreakpoint = 600;

export function useWide() {
  return useWindowDimensions().width >= paneBreakpoint;
}

/**
 * Phones stay upright; an unfolded foldable or a tablet turns freely, as a
 * locked app gets boxed into the middle of a big screen. It goes by the
 * screen, not the window: unfolding with the lock still on boxes the window
 * to phone width, which would keep it locked.
 */
export function useOrientationPolicy() {
  const [screen, setScreen] = useState(() => Dimensions.get("screen"));
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", (d) => setScreen(d.screen));
    return () => sub.remove();
  }, []);
  const phone = Math.min(screen.width, screen.height) < paneBreakpoint;
  useEffect(() => {
    void (
      phone
        ? ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.PORTRAIT_UP,
          )
        : ScreenOrientation.unlockAsync()
    ).catch(() => {});
  }, [phone]);
}

export const sidebarWidth = (window: number) =>
  Math.round(Math.min(360, Math.max(280, window * 0.36)));

/** Opens something from the sidebar as the whole pane, instead of on top of what's there. */
export function openInPane(href: Href) {
  if (router.canDismiss()) router.dismissAll();
  router.push(href);
}

/** The thread or project a path shows, to mark it in the list. */
const openItem = (pathname: string) =>
  pathname.match(/^\/(?:chat|project)\/([^/]+)/)?.[1];

/** What's open in the pane; turn changes and diffs keep the thread they came from. */
export function useOpenItem(pathname: string) {
  const [held, setHeld] = useState<{ path: string; item?: string }>({
    path: "/",
  });
  if (held.path !== pathname)
    setHeld({
      path: pathname,
      item: openItem(pathname) ?? (pathname === "/" ? undefined : held.item),
    });
  return held.path === pathname ? held.item : openItem(pathname);
}

export const FullWidthContext = createContext<(on: boolean) => void>(() => {});

/** Hides the sidebar while this screen is showing and `on`, for code that needs the room. */
export function useFullWidth(on: boolean) {
  const set = useContext(FullWidthContext);
  useFocusEffect(
    useCallback(() => {
      set(on);
      return () => set(false);
    }, [on, set]),
  );
}

export const HeaderHeightContext = createContext<(height: number) => void>(
  () => {},
);

/** Passes the stack's header height on, so the sidebar's top lines up with it. */
export function ReportHeaderHeight({ children }: { children: ReactNode }) {
  const height = useHeaderHeight();
  const report = useContext(HeaderHeightContext);
  useEffect(() => {
    if (height > 0) report(height);
  }, [height, report]);
  return children;
}

const hiddenKey = "relay-sidebar-hidden";

/** Whether the list is tucked away, remembered like the desktop's sidebar. */
export function useSidebarHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    void AsyncStorage.getItem(hiddenKey).then((saved) =>
      setHidden(saved === "1"),
    );
  }, []);
  const toggle = useCallback(
    () =>
      setHidden((was) => {
        void AsyncStorage.setItem(hiddenKey, was ? "0" : "1");
        return !was;
      }),
    [],
  );
  return [hidden, toggle] as const;
}

export function SidebarToggle({
  hidden,
  onPress,
}: {
  hidden: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hidden ? "Show the list" : "Hide the list"}
      hitSlop={10}
      onPress={onPress}
      style={styles.toggle}
    >
      <PanelLeft size={20} color={t.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: { marginRight: 12 },
});
