import { Pressable, StyleSheet, Text } from "react-native";
import { installApk, useApkInstall, type ApkInstall } from "../remote/apk-install";
import { useRemote } from "../remote/RemoteProvider";
import { restartIntoUpdate, useSelfUpdate } from "../remote/self-update";
import { type, useTheme } from "./theme";

/** The desktop's newer version of this app: arriving, ready to restart into, or needing a new APK. */
export function UpdateBanner() {
  const t = useTheme();
  const { name } = useRemote();
  const update = useSelfUpdate();
  const apk = useApkInstall();
  if (update.kind === "none") return null;
  if (update.kind === "downloading")
    return (
      <Text style={[styles.banner, { color: t.muted }]}>
        Getting Relay {update.version} from {name}… {Math.round(update.done * 100)}%
      </Text>
    );
  if (update.kind === "apk" && (apk.kind === "downloading" || apk.kind === "installing"))
    return (
      <Text style={[styles.banner, { color: t.muted }]}>
        {apk.kind === "downloading"
          ? `Downloading Relay ${update.version}… ${Math.round(apk.done * 100)}%`
          : `Installing Relay ${update.version}. It closes when it's done; open it again.`}
      </Text>
    );
  const ready = update.kind === "ready";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        void (ready ? restartIntoUpdate() : installApk(update.version, update.url))
      }
      style={({ pressed }) => [{ backgroundColor: pressed ? t.hover : t.accentSoft }]}
    >
      <Text style={[styles.banner, { color: t.text }]}>
        {ready
          ? `Relay ${update.version} is ready. Tap to restart into it.`
          : apkPrompt(update.version, name, apk)}
      </Text>
    </Pressable>
  );
}

function apkPrompt(version: string, desktop: string, apk: ApkInstall) {
  if (apk.kind === "allow")
    return `Allow Relay to install apps to update to ${version}, then come back. Tap to open the switch again.`;
  if (apk.kind === "failed")
    return `Couldn't update to Relay ${version}: ${apk.message.replace(/\.?$/, ".")} Tap to try again.`;
  return `Relay ${version} needs a new app; ${desktop} can't send this one. Tap to install it.`;
}

const styles = StyleSheet.create({
  banner: { fontSize: type.small, lineHeight: 19, paddingHorizontal: 16, paddingVertical: 10 },
});
