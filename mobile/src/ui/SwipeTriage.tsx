// Activity cards triaged with one thumb: swipe right to settle, left to snooze,
// and a moment to take it back.
import { useEffect, useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedReaction,
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

/** A swipe's job: resolves whether it went through, so a refused one slides back. */
export type SwipeAction = { label: string; run: () => Promise<boolean> };

export function SwipeTriage({
  settle,
  snooze,
  radius,
  t,
  children,
}: {
  /** Left out where the thread can't be settled, so that way doesn't move. */
  settle?: SwipeAction;
  snooze?: SwipeAction;
  /** The card's corners, for what shows behind it. */
  radius: number;
  t: Palette;
  children: ReactNode;
}) {
  const row = useRef<SwipeableMethods>(null);
  // A card that went through leaves the list with the next thread list; one
  // that stays (something new happened meanwhile) slides back.
  const back = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(back.current), []);
  const commit = (action: SwipeAction) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void action.run().then((done) => {
      if (!done) return row.current?.close();
      back.current = setTimeout(() => row.current?.close(), 2_500);
    });
  };
  const settleBg = { backgroundColor: t.accentSoft, borderRadius: radius };
  const snoozeBg = {
    backgroundColor: mix(snoozeColor, t.background, 0.22),
    borderRadius: radius,
  };
  return (
    <ReanimatedSwipeable
      ref={row}
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
      onSwipeableWillOpen={(direction) => {
        // "right" is the card moving right, uncovering the left side's action.
        const action = direction === "right" ? settle : snooze;
        if (action) commit(action);
      }}
    >
      {children}
    </ReanimatedSwipeable>
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
  // A tick as the swipe passes the point where letting go commits it, either way.
  useAnimatedReaction(
    () => Math.abs(drag.get()) >= commitAt,
    (past, before) => {
      if (before !== null && past !== before)
        scheduleOnRN(Haptics.selectionAsync);
    },
  );
  const shown = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(drag.get()), [0, commitAt], [0.35, 1], "clamp"),
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
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      pointerEvents="box-none"
      style={[styles.undoWrap, { bottom }]}
    >
      <View
        accessibilityLiveRegion="polite"
        style={[styles.undo, { backgroundColor: t.raised, borderColor: t.border }]}
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
