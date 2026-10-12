import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { GitCompareArrows, X } from "lucide-react-native";
import { extrasSummary, type SharedDraft } from "../../../shared/drafts";
import { isThisPhone, resolveOther } from "../remote/drafts";
import { type, useTheme } from "./theme";

/**
 * Over the composer: what the computer adds to this draft when it goes (its
 * screenshots show as tiles in the box), and, edited here and there at once,
 * the other version a tap away.
 */
export function DraftNotes({
  computer,
  draftKey,
  shared,
}: {
  computer: string;
  draftKey: string;
  shared: SharedDraft | undefined;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const rest = shared?.extras && extrasSummary({ ...shared.extras, screenshots: undefined });
  const other = shared?.other;
  if (!rest && !other) return null;
  // Whose the kept version is, and who else wrote at once: this phone, the computer, another phone.
  const mine = !!other && isThisPhone(computer, other.by);
  const them = other && (mine ? shared!.by : other.by);
  const where = them === "desktop" ? "your computer" : "another phone";
  const use = mine ? "Use mine" : other?.by === "desktop" ? "Use the computer's" : "Use the other phone's";
  const act = (drop: boolean) => {
    setBusy(true);
    void resolveOther(computer, draftKey, drop)
      .catch((e) => Alert.alert("Couldn't switch the draft", e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <View style={styles.notes}>
      {!!rest && (
        <Text style={[styles.note, { color: t.muted }]}>Your computer adds {rest} when this goes.</Text>
      )}
      {other && (
        <View style={styles.other}>
          <GitCompareArrows size={14} color={t.muted} />
          <Text numberOfLines={1} style={[styles.otherText, { color: t.muted }]}>
            Edited here and on {where} at once
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            hitSlop={6}
            onPress={() => act(false)}
          >
            <Text style={[styles.use, { color: t.accent }]}>{use}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Keep this version"
            disabled={busy}
            hitSlop={8}
            onPress={() => act(true)}
          >
            <X size={14} color={t.muted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  notes: { gap: 4, paddingHorizontal: 6, paddingBottom: 6 },
  note: { fontSize: type.tiny },
  other: { flexDirection: "row", alignItems: "center", gap: 8 },
  otherText: { flex: 1, fontSize: type.tiny },
  use: { fontSize: type.tiny, fontWeight: "600" },
});
