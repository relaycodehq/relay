// Activity cards triaged with one thumb: swipe right to settle, left to snooze,
// and a moment to take it back.
import { useCallback, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, type ScrollView } from "react-native-gesture-handler";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useSharedValue,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import * as Haptics from "expo-haptics";
import { AlarmClock, Check } from "lucide-react-native";
import { mix, type, type Palette } from "./theme";

/** How far a card goes before letting go commits it. */
const commitAt = 96;
/** Long enough to reach Undo, short enough not to linger. */
const undoMs = 5_000;
const snoozeColor = "#d99a2b";
/** A plain function for worklets to call back, rather than the Haptics module itself. */
const tick = () => void Haptics.selectionAsync().catch(() => {});

/** A swipe's job: resolves whether it went through, so a refused one slides back. */
export type SwipeAction = { label: string; run: () => Promise<boolean> };

export function SwipeTriage({
  settle,
  snooze,
  scrollGesture,
  blocked,
  radius,
  t,
  children,
}: {
  /** The list the row sits in, which keeps scrolling while the row decides. */
  scrollGesture: RefObject<ScrollView | null>;
  blocked: boolean;
  /** Left out where the thread cannot be settled. */
  settle?: SwipeAction;
  snooze?: SwipeAction;
  /** The card's corners, for what shows behind it. */
  radius: number;
  t: Palette;
  children: ReactNode;
}) {
  const row = useRef<SwipeableMethods>(null);
  const committing = useRef(false);
  const pastThreshold = useSharedValue(false);
  const back = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(back.current), []);
  const release = useCallback(
    (distance: number) => {
      const action =
        distance >= commitAt
          ? settle
          : distance <= -commitAt
            ? snooze
            : undefined;
      if (!action || blocked) return row.current?.close();
      if (committing.current) return;
      committing.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
      void action
        .run()
        .then((done) => {
          if (!done) return row.current?.close();
          clearTimeout(back.current);
          back.current = setTimeout(() => row.current?.close(), 2_500);
        })
        .catch(() => row.current?.close())
        .finally(() => {
          committing.current = false;
        });
    },
    [settle, snooze, blocked],
  );
  const canSettle = !!settle && !blocked;
  const canSnooze = !!snooze && !blocked;
  // Vertical intent wins before a row can swipe, while the native list still scrolls.
  const vertical = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .simultaneousWithExternalGesture(scrollGesture),
    [scrollGesture],
  );
  // Swipeable projects velocity beyond the finger. Commit from the actual release
  // event instead, so a short flick can never triage (or earn a threshold tick).
  const horizontal = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-8, 8])
        .onBegin(() => {
          pastThreshold.set(false);
        })
        .onUpdate((event) => {
          const past =
            (canSettle && event.translationX >= commitAt) ||
            (canSnooze && event.translationX <= -commitAt);
          if (past !== pastThreshold.get()) scheduleOnRN(tick);
          pastThreshold.set(past);
        })
        // Registered with the gesture handler; refs are read only after release on JS.
        // eslint-disable-next-line react-hooks/refs
        .onEnd((event, success) => {
          if (success) scheduleOnRN(release, event.translationX);
        }),
    [pastThreshold, canSettle, canSnooze, release],
  );
  const intent = Gesture.Simultaneous(vertical, horizontal);

  const settleBg = { backgroundColor: t.accentSoft, borderRadius: radius };
  const snoozeBg = {
    backgroundColor: mix(snoozeColor, t.background, 0.22),
    borderRadius: radius,
  };
  return (
    <GestureDetector gesture={intent}>
      <ReanimatedSwipeable
        ref={row}
        enabled={!blocked && !!(settle || snooze)}
        requireExternalGestureToFail={vertical}
        simultaneousWithExternalGesture={horizontal}
        dragOffsetFromLeftEdge={24}
        dragOffsetFromRightEdge={24}
        containerStyle={{ borderRadius: radius }}
        leftThreshold={commitAt}
        rightThreshold={commitAt}
        overshootLeft={false}
        overshootRight={false}
        renderLeftActions={
          settle &&
          ((_, drag) => (
            <Behind
              drag={drag}
              style={settleBg}
              icon={<Check size={18} color={t.accent} />}
              label={settle.label}
              color={t.accent}
            />
          ))
        }
        renderRightActions={
          snooze &&
          ((_, drag) => (
            <Behind
              drag={drag}
              end
              style={snoozeBg}
              icon={<AlarmClock size={18} color={snoozeColor} />}
              label={snooze.label}
              color={snoozeColor}
            />
          ))
        }
      >
        {children}
      </ReanimatedSwipeable>
    </GestureDetector>
  );
}

/** What a swipe uncovers: the whole row, its label by the edge it comes from. */
function Behind({
  drag,
  end,
  style,
  icon,
  label,
  color,
}: {
  drag: SharedValue<number>;
  /** Uncovered from the right edge. */
  end?: boolean;
  style: ViewStyle;
  icon: ReactNode;
  label: string;
  color: string;
}) {
  const shown = useAnimatedStyle(() => ({
    opacity: interpolate(
      Math.abs(drag.get()),
      [0, commitAt],
      [0.35, 1],
      "clamp",
    ),
  }));
  return (
    <View style={[styles.behind, style, end && styles.end]}>
      <Animated.View style={[styles.label, shown]}>
        {icon}
        <Text numberOfLines={1} style={[styles.labelText, { color }]}>
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

export interface Undo {
  /** What was done, e.g. "Settled". */
  done: string;
  title: string;
  run: () => void;
}

/** "Settled · title  Undo" over the list's foot for a few seconds. */
export function UndoBar({
  undo,
  bottom,
  t,
  onClose,
}: {
  undo?: Undo;
  bottom: number;
  t: Palette;
  onClose: () => void;
}) {
  // A new swipe restarts the clock; `onClose` must stay the same between redraws.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(onClose, undoMs);
    return () => clearTimeout(timer);
  }, [undo, onClose]);
  if (!undo) return null;
  return (
    <Animated.View
      key={undo.title + undo.done}
      entering={FadeIn.duration(150).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(150).reduceMotion(ReduceMotion.System)}
      pointerEvents="box-none"
      style={[styles.undoWrap, { bottom }]}
    >
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.undo,
          { backgroundColor: t.raised, borderColor: t.border },
        ]}
      >
        <Text numberOfLines={1} style={[styles.undoText, { color: t.text }]}>
          {undo.done}
          <Text style={{ color: t.muted }}> · {undo.title}</Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Undo: ${undo.done}`}
          hitSlop={10}
          onPress={() => {
            undo.run();
            onClose();
          }}
        >
          <Text style={[styles.undoAction, { color: t.accent }]}>Undo</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  behind: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    marginBottom: 2,
  },
  end: { justifyContent: "flex-end" },
  label: { flexDirection: "row", alignItems: "center", gap: 8 },
  labelText: { fontSize: type.small, fontWeight: "600" },
  undoWrap: { position: "absolute", left: 12, right: 12 },
  undo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  undoText: { flex: 1, fontSize: type.small, fontWeight: "500" },
  undoAction: { fontSize: type.small, fontWeight: "700" },
});
