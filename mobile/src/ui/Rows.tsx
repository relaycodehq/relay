import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { Button } from "./Button";
import { type, useTheme } from "./theme";

/** A tappable list row: an icon, a title, a quieter line under it. */
export function Row({
  icon,
  title,
  subtitle,
  right,
  chevron = true,
  onPress,
  onLongPress,
  accessibilityLabel,
  selected,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  /** What's open beside the list, on a wide screen. */
  selected?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={selected ? { selected } : undefined}
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        selected && { backgroundColor: t.selected },
        pressed && { backgroundColor: t.hover },
      ]}
    >
      {icon && <View style={styles.icon}>{icon}</View>}
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
          {title}
        </Text>
        {!!subtitle && (
          <Text numberOfLines={2} style={[styles.subtitle, { color: t.muted }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
      {onPress && chevron && <ChevronRight size={16} color={t.faint} />}
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={[styles.section, { color: t.muted }]}>{children}</Text>;
}

/** Two or three choices side by side, like the desktop's toggle groups. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={[styles.segmented, { backgroundColor: t.sidebar }]}
      accessibilityRole="tablist"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: t.raised }]}
          >
            <Text
              style={[styles.segmentText, { color: on ? t.text : t.muted }]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Why a screen couldn't load, and a way to ask again; a slow link shouldn't be a dead end. */
export function LoadFailed({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => Promise<unknown>;
}) {
  const t = useTheme();
  const [trying, setTrying] = useState(false);
  return (
    <View style={styles.failed}>
      <Text style={[styles.failedText, { color: t.muted }]}>{error}</Text>
      <Button
        label={trying ? "Trying…" : "Try again"}
        disabled={trying}
        style={styles.retry}
        onPress={() => {
          setTrying(true);
          void onRetry().finally(() => setTrying(false));
        }}
      />
    </View>
  );
}

export const rowStyles = StyleSheet.create({
  empty: {
    fontSize: type.small,
    textAlign: "center",
    lineHeight: 20,
    padding: 32,
  },
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    minHeight: 56,
    paddingVertical: 8,
  },
  icon: { width: 22, alignItems: "center" },
  text: { flex: 1, gap: 3 },
  title: { fontSize: type.body },
  subtitle: { fontSize: type.tiny, lineHeight: 17 },
  section: {
    fontSize: type.tiny,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  segmented: { flexDirection: "row", borderRadius: 10, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 8,
  },
  segmentText: { fontSize: type.small, fontWeight: "600" },
  failed: { alignItems: "center", gap: 14 },
  failedText: { fontSize: type.small, textAlign: "center", lineHeight: 20 },
  retry: { flexGrow: 0 },
});
