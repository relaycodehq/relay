import { useEffect, useRef } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Mic } from "lucide-react-native";
import {
  onDictationLevel,
  startDictation,
  stopDictation,
  useDictation,
  type DictationTarget,
} from "../remote/dictation";
import { useRemote } from "../remote/RemoteProvider";
import { useReducedMotion } from "./motion";
import { mix, useTheme } from "./theme";

/** How long the capsule takes to shrink back into the mic. */
export const dictationShrinkMs = 220;
/** Held longer than this, the mic is push-to-talk and letting go finishes. */
const holdThreshold = 350;
const bars = 14;
const idleWidth = 34;
const liveWidth = 120;

/**
 * The composer's mic, as on the desktop: tap to start and stop, or hold to
 * talk and let go to finish. While listening it widens into the live
 * waveform with a small square that says tapping finishes.
 */
export function DictationButton({
  owner,
  target,
  disabled,
}: {
  owner: object;
  target: () => DictationTarget;
  disabled?: boolean;
}) {
  const t = useTheme();
  const { call } = useRemote();
  const session = useDictation();
  const reduced = useReducedMotion();
  const mine = session.owner === owner && session.phase !== "idle";
  const press = useRef<{ at: number; started: boolean }>(undefined);
  const width = useSharedValue(idleWidth);
  const live = useSharedValue(0);
  const levels = useSharedValue<number[]>(Array(bars).fill(0));

  useEffect(() => {
    // Widens with a little overshoot, as on the desktop; shrinking can't dip
    // below the mic, or the Send button beside it would jump.
    width.set(
      reduced
        ? mine ? liveWidth : idleWidth
        : mine
          ? withSpring(liveWidth, { damping: 16, stiffness: 220 })
          : withTiming(idleWidth, { duration: dictationShrinkMs }),
    );
    live.set(withTiming(mine ? 1 : 0, { duration: reduced ? 0 : 200 }));
  }, [mine, reduced, width, live]);

  const listening = mine && session.phase === "listening";
  useEffect(() => {
    if (!listening) return levels.set(Array(bars).fill(0));
    return onDictationLevel((level) => levels.set([...levels.get().slice(1), level]));
  }, [listening, levels]);

  const capsule = useAnimatedStyle(() => ({ width: width.get() }));
  const icon = useAnimatedStyle(() => ({
    opacity: 1 - live.get(),
    transform: [{ scale: 1 - 0.6 * live.get() }],
  }));
  const finish = useAnimatedStyle(() => ({
    opacity: live.get(),
    transform: [{ scale: live.get() }],
  }));
  // The waveform and tint fade as the capsule shrinks back into the mic.
  const wave = useAnimatedStyle(() => ({ opacity: live.get() }));

  const start = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void startDictation(target(), owner, call);
  };
  const stop = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void stopDictation();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mine ? "Finish dictation" : "Dictate"}
      accessibilityHint={mine ? undefined : "Tap to start and stop, or hold to talk"}
      accessibilityState={{ selected: mine }}
      disabled={disabled && !mine}
      hitSlop={6}
      onPressIn={() => {
        const idle = session.phase === "idle";
        press.current = { at: Date.now(), started: idle };
        if (idle) start();
      }}
      onPressOut={() => {
        const held = press.current;
        press.current = undefined;
        if (!held) return;
        // A tap on the live capsule finishes; so does letting go after holding.
        if (!held.started || Date.now() - held.at >= holdThreshold) stop();
      }}
    >
      <Animated.View
        style={[styles.mic, capsule, disabled && !mine && { opacity: 0.4 }]}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: mix(t.accent, t.raised, 0.16) }, wave]}
        />
        <Animated.View style={[styles.icon, icon]}>
          <Mic size={17} color={t.muted} />
        </Animated.View>
        <Animated.View style={[styles.wave, wave]} pointerEvents="none">
          {Array.from({ length: bars }, (_, i) => (
            <Bar
              key={i}
              index={i}
              levels={levels}
              color={mine && !session.loading ? t.accent : t.muted}
              reduced={reduced}
            />
          ))}
        </Animated.View>
        <Animated.View style={[styles.finish, { backgroundColor: t.accent }, finish]} />
      </Animated.View>
    </Pressable>
  );
}

function Bar({
  index,
  levels,
  color,
  reduced,
}: {
  index: number;
  levels: SharedValue<number[]>;
  color: string;
  reduced: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const height = 0.12 + 0.88 * (levels.get()[index] ?? 0);
    // Older bars fade toward the left edge.
    const fade = 0.35 + (0.65 * index) / (bars - 1);
    return {
      opacity: fade,
      transform: [
        { scaleY: reduced ? height : withSpring(height, { damping: 12, stiffness: 260 }) },
      ],
    };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  mic: {
    height: 34,
    borderRadius: 17,
    marginLeft: 4,
    overflow: "hidden",
    justifyContent: "center",
  },
  icon: {
    position: "absolute",
    left: 0,
    width: idleWidth,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  wave: {
    position: "absolute",
    left: 12,
    width: bars * 5.5 - 2.5,
    height: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 2.5,
  },
  bar: { width: 3, height: 20, borderRadius: 1.5 },
  finish: {
    position: "absolute",
    right: 12,
    width: 9,
    height: 9,
    borderRadius: 2.5,
  },
});
