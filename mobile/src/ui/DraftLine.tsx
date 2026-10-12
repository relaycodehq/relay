import { StyleSheet, Text, View } from "react-native";
import { Laptop, Smartphone, SquarePen } from "lucide-react-native";
import type { ListedDraft } from "../remote/drafts";
import { mix, type, waitingColor, type Palette } from "./theme";

const started = {
  here: "",
  computer: " started on your computer",
  phone: " started on another phone",
};

/** A draft's text where a row shows its branch, marked with where it was started. */
export function DraftLine({ draft, t }: { draft: ListedDraft; t: Palette }) {
  const Icon = draft.from === "computer" ? Laptop : draft.from === "phone" ? Smartphone : SquarePen;
  const shots = draft.extras?.screenshots?.length ?? 0;
  const text =
    draft.text.replace(/\s+/g, " ").trim() ||
    (shots === 1 ? "Screenshot" : shots ? `${shots} screenshots` : "Draft");
  return (
    <View style={styles.line} accessibilityLabel={`Draft${started[draft.from]}: ${text}`}>
      <Icon size={11} color={waitingColor} />
      <Text numberOfLines={1} style={[styles.text, { color: mix(t.text, waitingColor, 0.8) }]}>
        {text}
      </Text>
    </View>
  );
}

/** How a row with a draft is tinted: it waits on you, the way the desktop's cards do. */
export const draftTint = (t: Palette) => mix(waitingColor, t.background, 0.1);

const styles = StyleSheet.create({
  line: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  text: { flexShrink: 1, fontSize: type.tiny },
});
