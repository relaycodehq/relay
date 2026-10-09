import { useEffect, useMemo } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";
import { Settings2 } from "lucide-react-native";
import { Browser } from "../screens/Browser";
import { ComputerSwitch } from "./ComputerSwitch";
import { SidebarToggle, openInPane, sidebarBounds } from "./panes";
import { useTheme } from "./theme";

/** The desktop's sidebar on a wide screen: the lists, beside what's open. */
export function Sidebar({
  width,
  window,
  selected,
  headerHeight,
  onHide,
  onResize,
}: {
  width: number;
  /** The whole window's width, which bounds how far the edge drags. */
  window: number;
  /** The thread or project open beside it. */
  selected?: string;
  /** The stack's header beside it, status bar included; 0 until known. */
  headerHeight: number;
  onHide: () => void;
  onResize: (width: number) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const head = Math.max(headerHeight, insets.top + toolbar);
  const live = useSharedValue(width);
  const dragging = useSharedValue(false);
  const start = useSharedValue(0);
  useEffect(() => {
    live.set(width);
  }, [width, live]);
  const { min, max } = sidebarBounds(window);
  const drag = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .onBegin(() => {
          start.set(live.get());
          dragging.set(true);
        })
        .onUpdate((e) => {
          live.set(Math.min(max, Math.max(min, start.get() + e.translationX)));
        })
        .onEnd(() => {
          scheduleOnRN(onResize, Math.round(live.get()));
        })
        .onFinalize(() => {
          dragging.set(false);
        }),
    [live, dragging, start, min, max, onResize],
  );
  const sized = useAnimatedStyle(() => ({ width: live.get() + insets.left }));
  const grip = useAnimatedStyle(() => ({
    opacity: dragging.get() ? 1 : 0.35,
    transform: [{ scaleY: dragging.get() ? 1.4 : 1 }],
  }));
  return (
    <Animated.View
      style={[
        styles.sidebar,
        sized,
        {
          paddingLeft: insets.left,
          paddingBottom: insets.bottom,
          backgroundColor: t.sidebar,
          borderColor: t.border,
        },
      ]}
    >
      <View style={[styles.head, { height: head }]}>
        <SidebarToggle hidden={false} onPress={onHide} />
        <View style={styles.name}>
          <ComputerSwitch />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={10}
          onPress={() => openInPane("/settings", pathname)}
        >
          <Settings2 size={20} color={t.text} />
        </Pressable>
      </View>
      <Browser pane selected={selected} />
      {/* Below the header, so it doesn't take taps meant for Settings. */}
      <GestureHandlerRootView style={[styles.edge, { top: head }]}>
        <GestureDetector gesture={drag}>
          <View
            accessibilityLabel="Resize the list"
            accessibilityHint="Drag sideways"
            style={styles.edgeTouch}
          >
            <Animated.View style={[styles.grip, { backgroundColor: t.muted }, grip]} />
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Animated.View>
  );
}

/** The native header's bar under the status bar, which the sidebar's top matches. */
const toolbar = Platform.OS === "ios" ? 44 : 64;

const styles = StyleSheet.create({
  sidebar: { borderRightWidth: StyleSheet.hairlineWidth },
  // Inside the list's right edge: Android drops touches past a parent's bounds.
  edge: { position: "absolute", bottom: 0, right: 0, width: 16 },
  edgeTouch: { flex: 1, alignItems: "flex-end", justifyContent: "center" },
  grip: { width: 4, height: 40, borderRadius: 2, marginRight: 3 },
  head: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: toolbar / 2 - 12,
  },
  name: { flex: 1, flexDirection: "row", marginRight: 12 },
});
