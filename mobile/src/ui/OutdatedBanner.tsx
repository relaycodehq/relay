import { Linking, Pressable, StyleSheet, Text } from "react-native";
import { useRemote } from "../remote/RemoteProvider";
import { restartIntoUpdate, useSelfUpdate } from "../remote/self-update";
import { type, useTheme } from "./theme";

/** This app needs calls an older desktop doesn't have yet; restarting Relay brings them. */
export function OutdatedBanner() {
  const t = useTheme();
  const { outdated, name } = useRemote();
  if (!outdated) return null;
  return (
    <Text style={[styles.banner, { color: t.text, backgroundColor: t.accentSoft }]}>
      Restart Relay on {name} to use everything on this phone.
    </Text>
  );
}

/** The desktop's newer version of this app: arriving, ready to restart into, or needing a download. */
export function UpdateBanner() {
  const t = useTheme();
  const { name } = useRemote();
  const update = useSelfUpdate();
  if (update.kind === "none") return null;
  if (update.kind === "downloading")
    return (
      <Text style={[styles.banner, { color: t.muted }]}>
        Getting Relay {update.version} from {name}… {Math.round(update.done * 100)}%
      </Text>
    );
  const ready = update.kind === "ready";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void (ready ? restartIntoUpdate() : Linking.openURL(update.url))}
      style={({ pressed }) => [{ backgroundColor: pressed ? t.hover : t.accentSoft }]}
    >
      <Text style={[styles.banner, { color: t.text }]}>
        {ready
          ? `Relay ${update.version} is ready. Tap to restart into it.`
          : `Relay ${update.version} needs a new app. Tap to download it; ${name} can't send this one.`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { fontSize: type.small, lineHeight: 19, paddingHorizontal: 16, paddingVertical: 10 },
});
