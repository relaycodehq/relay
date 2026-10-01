import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { ClipboardPaste } from "lucide-react-native";
import {
  parsePairingUrl,
  tailscaleAndroid,
  tailscaleDownload,
  type PairingLink,
} from "../../../shared/remote";
import { useRemote } from "../remote/RemoteProvider";
import { Button } from "../ui/Button";
import { type, useTheme } from "../ui/theme";

/**
 * Pairs from the QR code in Relay's Settings → Phone, a pasted link, or a
 * relay-remote:// deep link. The desktop listens only on its Tailscale
 * address, so the phone needs Tailscale first; the steps say so up front.
 */
export default function Pair() {
  const remote = useRemote();
  const t = useTheme();
  const params = useLocalSearchParams<Record<string, string>>();
  // Opened from a relay-remote://pair?… link: the link arrives as route params.
  const linked = useMemo(
    () =>
      params.k
        ? parsePairingUrl(`relay-remote://pair?${new URLSearchParams(params)}`)
        : null,
    [params],
  );
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const scanned = useRef(false);

  const pair = async (link: PairingLink) => {
    setBusy(`Pairing with ${link.name}…`);
    setError(undefined);
    try {
      await remote.pair(link);
      // A deep link opens pairing on top of home; go back to it, not over it.
      if (router.canDismiss()) router.dismissAll();
      else router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      scanned.current = false;
      setBusy(undefined);
    }
  };
  const read = (text: string) => {
    const link = parsePairingUrl(text);
    if (link) void pair(link);
    else setError("That isn't a Relay pairing code.");
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={[styles.lead, { color: t.text }]}>
        {linked
          ? `Pair this phone with ${linked.name}?`
          : remote.computers.length
            ? "Pair another computer"
            : "Pair with your computer"}
      </Text>
      <Text style={[styles.hint, { color: t.muted }]}>
        Relay reaches your computer only over Tailscale, a private network between your own
        devices.
      </Text>
      <Step n={1} title="Tailscale on this phone">
        <Text style={[styles.hint, { color: t.muted }]}>
          Install it and sign in with the account your computer uses, then leave it on.
        </Text>
        <Button
          label="Get Tailscale"
          style={styles.grow0}
          onPress={() =>
            void Linking.openURL(Platform.OS === "android" ? tailscaleAndroid : tailscaleDownload)
          }
        />
      </Step>
      {!linked && (
        <Step n={2} title="Scan the pairing code">
          <Text style={[styles.hint, { color: t.muted }]}>
            On your computer, open Relay → Settings → Phone and choose Show pairing code.
          </Text>
        </Step>
      )}
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={t.muted} />
          <Text style={[styles.hint, { color: t.muted }]}>{busy}</Text>
        </View>
      ) : linked ? (
        <Button label="Pair" primary onPress={() => void pair(linked)} style={styles.grow0} />
      ) : permission?.granted ? (
        <View style={[styles.camera, { borderColor: t.border }]}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current) return;
              scanned.current = true;
              const link = parsePairingUrl(data);
              if (link) return void pair(link);
              setError("That isn't a Relay pairing code.");
              setTimeout(() => (scanned.current = false), 1500);
            }}
          />
        </View>
      ) : (
        <Button
          label="Use the camera"
          primary
          style={styles.grow0}
          onPress={() => void requestPermission()}
        />
      )}
      {!busy && !linked && (
        <Button
          label="Paste pairing link"
          style={styles.grow0}
          icon={<ClipboardPaste size={16} color={t.text} />}
          onPress={() => void Clipboard.getStringAsync().then(read)}
        />
      )}
      {error && (
        <Text style={[styles.hint, { color: t.danger }]}>
          {error}
          {error.startsWith("That isn't") ? "" : " Check that Tailscale is on and signed in on this phone."}
        </Text>
      )}
    </ScrollView>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.mark, { borderColor: t.border }]}>
        <Text style={[styles.markText, { color: t.muted }]}>{n}</Text>
      </View>
      <View style={styles.stepBody}>
        <Text style={[styles.stepTitle, { color: t.text }]}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, gap: 14 },
  step: { flexDirection: "row", gap: 12 },
  mark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { fontSize: type.tiny, fontWeight: "600" },
  stepBody: { flex: 1, gap: 8 },
  stepTitle: { fontSize: type.body, fontWeight: "600", lineHeight: 24 },
  lead: { fontSize: 20, fontWeight: "600" },
  hint: { fontSize: type.small, lineHeight: 20 },
  busy: { alignItems: "center", gap: 10, paddingVertical: 30 },
  camera: {
    aspectRatio: 1,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
  },
  grow0: { flexGrow: 0 },
});
