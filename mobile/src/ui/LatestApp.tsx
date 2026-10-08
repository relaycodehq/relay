import { Linking } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Download, RefreshCw } from "lucide-react-native";
import { installApk, installsApks, useApkInstall } from "../remote/apk-install";
import {
  checkLatestApp,
  checksLatestApp,
  installedApp,
  latestOffer,
  releaseBuild,
  useLatestApp,
} from "../remote/latest-app";
import { apkPrompt } from "./UpdateBanner";
import { MenuRow } from "./Sheet";
import { ago } from "./ThreadRow";
import { useTheme } from "./theme";

const expoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Settings' rows for the newest app on GitHub, whatever the paired computer runs. */
export function LatestAppRows() {
  const t = useTheme();
  const latest = useLatestApp();
  const apk = useApkInstall();
  if (!checksLatestApp) return null;
  const { newest } = latest;
  const offer = latestOffer(latest);
  const mine = offer && "version" in apk && apk.version === offer.version ? apk : undefined;
  // Expo Go is another app, and a development build is signed with another key.
  const here = installsApks && releaseBuild;
  const size = offer?.size ? ` (${Math.round(offer.size / 1e6)} MB)` : "";
  const install =
    offer &&
    (!here
      ? {
          label: `Download Relay ${offer.version}`,
          hint: expoGo
            ? "Expo Go can't install Relay; this opens the download in the browser."
            : !installsApks
              ? "This app can't install it itself; this opens the download in the browser."
              : "A development build: Android won't put the release app over it. This opens the download in the browser.",
        }
      : mine?.kind === "downloading" && !mine.quiet
        ? { label: `Downloading Relay ${offer.version}… ${Math.round(mine.done * 100)}%` }
        : mine?.kind === "installing"
          ? { label: `Installing Relay ${offer.version}…`, hint: "It closes when it's done; open it again." }
          : {
              label: `Update to Relay ${offer.version}`,
              hint:
                mine && mine.kind !== "downloading"
                  ? apkPrompt(offer.version, undefined, mine)
                  : `Downloads it from GitHub${size} and asks Android to install it. Pairings and settings stay.`,
            });
  const status = latest.checking
    ? "Looking on GitHub…"
    : latest.error
      ? `Couldn't look: ${latest.error.replace(/\.?$/, ".")}`
      : newest
        ? `${
            offer
              ? `The newest app is ${newest.version}`
              : `This app (${installedApp}) is the newest`
          }${newest.release !== newest.version ? `; Relay ${newest.release} kept it` : ""}. Looked ${ago(latest.checkedAt ?? 0)}.`
        : "Relay looks on GitHub every few hours.";
  return (
    <>
      {install && (
        <MenuRow
          label={install.label}
          hint={install.hint}
          icon={<Download size={18} color={t.text} />}
          onPress={() => void (here ? installApk(offer) : Linking.openURL(offer.url))}
        />
      )}
      <MenuRow
        label="Look for a new app"
        hint={status}
        disabled={latest.checking}
        icon={<RefreshCw size={18} color={t.text} />}
        onPress={() => void checkLatestApp(true)}
      />
    </>
  );
}
