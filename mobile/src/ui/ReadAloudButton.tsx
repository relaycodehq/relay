import { Pressable, StyleSheet, Text } from "react-native";
import { Square, Volume2 } from "lucide-react-native";
import { readAloudBridge } from "../../../shared/remote";
import {
  phoneHasSpeaker,
  startReadAloud,
  stopReadAloud,
  useReadAloud,
} from "../remote/read-aloud";
import { useRemote } from "../remote/RemoteProvider";
import { type, useTheme } from "./theme";

/**
 * Reads an answer aloud in the desktop's voice, or stops it. Hidden unless
 * the computer has a voice downloaded and this APK can play it.
 */
export function ReadAloudButton({
  messageId,
  text,
}: {
  messageId: string;
  text: string;
}) {
  const t = useTheme();
  const { overview, call } = useRemote();
  const reading = useReadAloud();
  if (
    !phoneHasSpeaker ||
    !overview?.readAloud ||
    (overview.bridge ?? 1) < readAloudBridge
  )
    return null;
  const going = reading.key === messageId;
  const error =
    reading.error?.key === messageId ? reading.error.message : undefined;
  const label = going
    ? reading.loading
      ? "Getting the voice ready, tap to stop"
      : "Stop reading"
    : "Read aloud";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
        onPress={() =>
          going ? stopReadAloud() : void startReadAloud(messageId, text, call)
        }
      >
        {going ? (
          <Square size={14} color={reading.loading ? t.faint : t.text} />
        ) : (
          <Volume2 size={16} color={t.muted} />
        )}
      </Pressable>
      {!!error && (
        <Text style={[styles.error, { color: t.danger }]} numberOfLines={2}>
          {error}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  error: { flexShrink: 1, fontSize: type.small },
});
