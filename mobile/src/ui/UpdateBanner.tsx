import { Pressable, StyleSheet, Text } from "react-native";
import { pickApk } from "../../../shared/phone-release";
import { newerVersion } from "../../../shared/phone-app";
import { installApk, useApkInstall, type ApkInstall } from "../remote/apk-install";
import { latestOffer, releaseBuild, useLatestApp } from "../remote/latest-app";
import { useRemote } from "../remote/RemoteProvider";
import { restartIntoUpdate, useSelfUpdate } from "../remote/self-update";
import { type, useTheme } from "./theme";

/**
 * A newer version of this app: the desktop's arriving or ready to restart
 * into, or a new APK, the desktop's or the release feed's, whichever is newer.
 */
export function UpdateBanner() {
  const t = useTheme();
  const { name } = useRemote();
  const update = useSelfUpdate();
  const apk = useApkInstall();
  const latest = useLatestApp();
  if (update.kind === "downloading")
    return (
      <Text style={[styles.banner, { color: t.muted }]}>
        Getting Relay {update.version} from {name}… {Math.round(update.done * 100)}%
      </Text>
    );
  const feedOffer = releaseBuild ? latestOffer(latest) : undefined;
  const ready = update.kind === "ready" && !newerVersion(feedOffer?.version ?? "0.0.0", update.version)
    ? update : undefined;
  const fromDesktop = update.kind === "apk" ? update : undefined;
  const offer = ready
    ? undefined
    : pickApk(fromDesktop, feedOffer);
  if (!ready && !offer) return null;
  const mine = offer && "version" in apk && apk.version === offer.version ? apk : undefined;
  if ((mine?.kind === "downloading" && !mine.quiet) || mine?.kind === "installing")
    return (
      <Text style={[styles.banner, { color: t.muted }]}>
        {mine.kind === "downloading"
          ? `Downloading Relay ${mine.version}… ${Math.round(mine.done * 100)}%`
          : `Installing Relay ${mine.version}. It closes when it's done; open it again.`}
      </Text>
    );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void (ready ? restartIntoUpdate() : offer && installApk(offer))}
      style={({ pressed }) => [{ backgroundColor: pressed ? t.hover : t.accentSoft }]}
    >
      <Text style={[styles.banner, { color: t.text }]}>
        {ready
          ? `Relay ${ready.version} is ready. Tap to restart into it.`
          : offer && apkPrompt(offer.version, offer === fromDesktop ? name : undefined, mine)}
      </Text>
    </Pressable>
  );
}

/** `desktop` names the computer whose version needs the APK; without it, the feed has a newer app. */
export function apkPrompt(version: string, desktop: string | undefined, apk: ApkInstall | undefined) {
  if (apk?.kind === "allow")
    return `Allow Relay to install apps to update to ${version}, then come back. Tap to open the switch again.`;
  if (apk?.kind === "failed")
    return `Couldn't update to Relay ${version}: ${apk.message.replace(/\.?$/, ".")} Tap to try again.`;
  if (apk?.kind === "downloaded") return `Relay ${version} is downloaded. Tap to install it.`;
  if (desktop) return `Relay ${version} needs a new app; ${desktop} can't send this one. Tap to install it.`;
  return `A new Relay app, ${version}, is out. Tap to install it.`;
}

const styles = StyleSheet.create({
  banner: { fontSize: type.small, lineHeight: 19, paddingHorizontal: 16, paddingVertical: 10 },
});
