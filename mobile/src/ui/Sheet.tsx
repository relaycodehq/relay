import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type, useTheme } from "./theme";

const settle = { damping: 40, stiffness: 400 };

/**
 * A sheet from the bottom of the screen, for pickers, menus and small forms.
 * It drags like the platform's own: by its grip at any time, and by its
 * content once that's scrolled to the top, handing back to the scroll when
 * pushed up again. It closes past a third of its height or on a fling down.
 */
export function Sheet({
  open,
  title,
  onClose,
  onDismiss,
  children,
  scroll = true,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  /** iOS: the sheet has finished animating away. */
  onDismiss?: () => void;
  children: ReactNode;
  scroll?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  // Stays mounted while it slides away, after `open` has gone false.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const offscreen = Dimensions.get("window").height;
  const y = useSharedValue(offscreen);
  const height = useSharedValue(offscreen);
  const gripHeight = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const fromGrip = useSharedValue(false);
  // Where the finger was when the content last handed the drag to the sheet.
  const anchor = useSharedValue(0);
  const list = useAnimatedRef<Animated.ScrollView>();
  const hide = useCallback(() => setShown(false), []);
  // Dragged past closing, it asks; a parent that won't close yet (busy) gets
  // the sheet back where it was, not left where the finger let go.
  const [dragClosed, setDragClosed] = useState(0);
  const answered = useRef(0);
  const dragClose = useCallback(() => {
    onClose();
    setDragClosed((n) => n + 1);
  }, [onClose]);
  useEffect(() => {
    if (dragClosed === answered.current) return;
    answered.current = dragClosed;
    if (open) y.set(withSpring(0, settle));
  }, [dragClosed, open, y]);

  useEffect(() => {
    if (!open && shown)
      y.set(
        withTiming(height.get(), { duration: reduced ? 0 : 200, easing: Easing.in(Easing.cubic) }, (done) => {
          if (done) scheduleOnRN(hide);
        }),
      );
  }, [open, shown, y, height, reduced, hide]);

  const slideIn = () => {
    y.set(height.get());
    y.set(withTiming(0, { duration: reduced ? 0 : 280, easing: Easing.out(Easing.cubic) }));
  };

  const native = useMemo(() => Gesture.Native(), []);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-16, 16])
        .simultaneousWithExternalGesture(native)
        .onBegin((e) => {
          fromGrip.set(e.y <= gripHeight.get());
          anchor.set(0);
        })
        // `list` is Reanimated's ref for scrollTo on the UI thread, not read while rendering.
        // eslint-disable-next-line react-hooks/refs
        .onUpdate((e) => {
          const drag = e.translationY - anchor.get();
          if (fromGrip.get()) {
            // Past the top it only gives a little.
            y.set(drag > 0 ? drag : drag / 6);
            return;
          }
          // The content scrolls until it's at the top and pulled further down.
          if (y.get() <= 0 && (scrollY.get() > 0 || drag < 0)) {
            anchor.set(e.translationY);
            y.set(0);
            return;
          }
          y.set(Math.max(0, drag));
          scrollTo(list, 0, 0, false);
        })
        .onEnd((e) => {
          if (y.get() > height.get() / 3 || (y.get() > 0 && e.velocityY > 900)) scheduleOnRN(dragClose);
          else y.set(withSpring(0, settle));
        }),
    [native, fromGrip, gripHeight, anchor, y, scrollY, list, height, dragClose],
  );
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [0, height.get()], [1, 0], "clamp"),
  }));
  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onShow={slideIn}
      onRequestClose={onClose}
      onDismiss={onDismiss}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={styles.fill}>
        <KeyboardAvoidingView
          style={styles.end}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Animated.View style={[styles.backdrop, backdropStyle]}>
            <Pressable style={styles.fill} accessibilityLabel="Close" onPress={onClose} />
          </Animated.View>
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={(e) => height.set(e.nativeEvent.layout.height)}
              style={[
                styles.sheet,
                { backgroundColor: t.raised, paddingBottom: 12 + insets.bottom },
                sheetStyle,
              ]}
            >
              <View style={styles.handle} onLayout={(e) => gripHeight.set(e.nativeEvent.layout.height)}>
                <View style={[styles.grip, { backgroundColor: t.border }]} />
                {title && (
                  <Text style={[styles.title, { color: t.text }]}>{title}</Text>
                )}
              </View>
              {scroll ? (
                <GestureDetector gesture={native}>
                  <Animated.ScrollView
                    ref={list}
                    keyboardShouldPersistTaps="handled"
                    onScroll={onScroll}
                    scrollEventThrottle={16}
                    overScrollMode="never"
                    bounces={false}
                  >
                    {children}
                  </Animated.ScrollView>
                </GestureDetector>
              ) : (
                children
              )}
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

export interface MenuItem {
  label: string;
  hint?: string;
  icon?: ReactNode;
  destructive?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** A sheet of actions; picking one closes it. */
export function MenuSheet({
  open,
  title,
  items,
  onClose,
}: {
  open: boolean;
  title?: string;
  items: MenuItem[];
  onClose: () => void;
}) {
  // iOS won't present a picker or dialog while this sheet is still leaving,
  // so the picked action waits for it to be gone.
  const picked = useRef<() => void>(undefined);
  const run = () => {
    const action = picked.current;
    picked.current = undefined;
    action?.();
  };
  return (
    <Sheet open={open} title={title} onClose={onClose} onDismiss={run}>
      {items.map((item, i) => (
        <MenuRow
          // Labels repeat, e.g. side conversations opening with the same line.
          key={i}
          {...item}
          onPress={() => {
            picked.current = item.onPress;
            onClose();
            if (Platform.OS !== "ios") run();
          }}
        />
      ))}
    </Sheet>
  );
}

export function MenuRow({ label, hint, icon, destructive, checked, disabled, onPress }: MenuItem) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: checked }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: t.hover },
        checked && { backgroundColor: t.accentSoft },
        disabled && { opacity: 0.4 },
      ]}
    >
      {icon}
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: destructive ? t.danger : t.text }]}>
          {label}
        </Text>
        {!!hint && <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  end: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 2,
  },
  // The whole strip is the grab area, not just the 4pt line.
  handle: { paddingTop: 6 },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: type.small, fontWeight: "600", paddingHorizontal: 20, paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    minHeight: 50,
    paddingVertical: 8,
  },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: type.body },
  hint: { fontSize: type.tiny, lineHeight: 17 },
});
