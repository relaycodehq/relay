import { StyleSheet, Text, View } from "react-native";
import { useRemote } from "../remote/RemoteProvider";
import { type, useTheme } from "./theme";

/** Which computer this is, and whether it's reachable; quiet when all is well. */
export function ConnectionLine({ always }: { always?: boolean }) {
  const t = useTheme();
  const { status, detail, name } = useRemote();
  if (status === "online" && !always) return null;
  const color =
    status === "online" ? t.additionText : status === "denied" ? t.danger : t.muted;
  const text =
    status === "online"
      ? `${name} · connected`
      : status === "connecting"
        ? `Connecting to ${name}…`
        : status === "denied"
          ? (detail ?? `${name} turned this phone away.`)
          : // The desktop listens only on Tailscale, so that's the usual gap.
            `${detail ?? `Can't reach ${name}.`} Is Tailscale on? Retrying…`;
  return (
    <View style={styles.line} accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text numberOfLines={2} style={[styles.text, { color: t.muted }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  // Two lines' room whatever it says, so "Connecting…" turning into a longer
  // "Can't reach…" and back doesn't move everything under it.
  text: { fontSize: type.tiny, lineHeight: 16, minHeight: 32, flex: 1, textAlignVertical: "center" },
});
