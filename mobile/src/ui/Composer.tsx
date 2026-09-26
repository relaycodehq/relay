import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUp, Square } from "lucide-react-native";
import { useKeyboardShown } from "./KeyboardAware";
import { type, useTheme } from "./theme";

/** Send, or while the agent works: queue behind it, or stop it. */
export function Composer({
  placeholder,
  running,
  disabled,
  onSend,
  onStop,
}: {
  placeholder: string;
  running: boolean;
  disabled?: boolean;
  onSend: (body: string) => Promise<void>;
  onStop?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // The keyboard covers the gesture bar, so its inset would only leave a gap.
  const keyboard = useKeyboardShown();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const empty = !text.trim();
  const send = async () => {
    if (empty || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSend(text.trim());
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const stop = running && empty && onStop;
  return (
    <View
      style={[
        styles.dock,
        {
          borderColor: t.border,
          backgroundColor: t.background,
          paddingBottom: 10 + (keyboard ? 0 : insets.bottom),
        },
      ]}
    >
      {(error || (running && !empty)) && (
        <Text style={[styles.note, { color: error ? t.danger : t.muted }]}>
          {error ?? "Queues until the agent finishes."}
        </Text>
      )}
      <View style={[styles.box, { borderColor: t.border, backgroundColor: t.raised }]}>
        <TextInput
          accessibilityLabel="Message"
          multiline
          editable={!disabled}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={t.faint}
          style={[styles.input, { color: t.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stop ? "Stop" : "Send"}
          disabled={disabled || busy || (!stop && empty)}
          onPress={stop ? onStop : () => void send()}
          hitSlop={8}
          style={[
            styles.action,
            {
              backgroundColor: stop || !empty ? t.accent : t.hover,
              opacity: disabled || busy ? 0.5 : 1,
            },
          ]}
        >
          {stop ? (
            <Square size={13} color={t.onAccent} fill={t.onAccent} />
          ) : (
            <ArrowUp size={18} color={empty ? t.faint : t.onAccent} strokeWidth={2.5} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  note: { fontSize: type.tiny, paddingHorizontal: 4 },
  box: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderWidth: 1,
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: type.body,
    lineHeight: 21,
    maxHeight: 132,
    paddingVertical: 6,
  },
  action: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
