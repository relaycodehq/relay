import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Check, Monitor, Plus, RefreshCw } from "lucide-react-native";
import { useRemote } from "../remote/RemoteProvider";
import {
  appReport,
  runningUpdate,
  runningVersion,
  restartOnBuiltIn,
  useSelfUpdate,
} from "../remote/self-update";
import { phoneAppStatus } from "../../../shared/phone-app";
import { describeUpdate } from "../remote/computer-update";
import { useComputerUpdateAction } from "../ui/ComputerUpdate";
import { ConnectionLine } from "../ui/ConnectionLine";
import { MenuRow } from "../ui/Sheet";
import { SectionTitle } from "../ui/Rows";
import { useThemePreference, type ThemePreference } from "../ui/ThemeProvider";
import { type, useTheme } from "../ui/theme";

export default function Settings() {
  const remote = useRemote();
  const t = useTheme();
  const { preference, setPreference } = useThemePreference();
  const known = !!remote.overview?.appearance;
  const app = appReport(useSelfUpdate());
  const offered = remote.overview?.phoneApp?.version;
  const update = useComputerUpdateAction();
  const source = remote.computers.length > 1 ? "your computers" : remote.name;
  const choices: { value: ThemePreference; label: string; hint: string }[] = [
    {
      value: "computer",
      label: `Match ${remote.name}`,
      hint: known
        ? "Its theme, light or dark as it is set there."
        : "Relay's theme until your computer shares its own.",
    },
    { value: "phone", label: "Follow this phone", hint: "The same theme, light or dark with the phone." },
    { value: "light", label: "Light", hint: "The theme's light colours." },
    { value: "dark", label: "Dark", hint: "The theme's dark colours." },
  ];
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <ConnectionLine always />
      <SectionTitle>Theme</SectionTitle>
      {choices.map((c) => (
        <MenuRow
          key={c.value}
          label={c.label}
          hint={c.hint}
          checked={preference === c.value}
          icon={
            preference === c.value ? (
              <Check size={16} color={t.accent} />
            ) : (
              <View style={styles.iconSpace} />
            )
          }
          onPress={() => setPreference(c.value)}
        />
      ))}
      <SectionTitle>App</SectionTitle>
      <View style={styles.computer}>
        <View style={styles.text}>
          <Text style={[styles.name, { color: t.text }]}>Relay {runningVersion}</Text>
          <Text style={[styles.hint, { color: t.muted }]}>
            {phoneAppStatus(app, offered)}.{" "}
            {runningUpdate
              ? `Came from ${source}; the app was installed as ${app.apk}.`
              : `As installed; new versions come from ${source}.`}
          </Text>
        </View>
      </View>
      {runningUpdate && (
        <MenuRow
          label="Go back to the built-in version"
          hint="If an update misbehaves: restarts on the version this app was installed with."
          onPress={() => void restartOnBuiltIn()}
        />
      )}
      <SectionTitle>Computers</SectionTitle>
      {remote.computers.map((c) => (
        <MenuRow
          key={c.id}
          label={c.name}
          hint={
            c.id === remote.active
              ? `In use${remote.overview?.version ? `, Relay ${remote.overview.version}` : ""}. Remove this phone in Relay's Settings → Phone there to cut it off.`
              : "Tap to switch to it."
          }
          checked={c.id === remote.active}
          icon={<Monitor size={18} color={c.id === remote.active ? t.accent : t.muted} />}
          onPress={() => {
            if (c.id === remote.active) return;
            if (router.canDismiss()) router.dismissAll();
            void remote.switchTo(c.id);
          }}
        />
      ))}
      {update.update ? (
        <Text style={[styles.note, { color: t.muted }]}>
          {describeUpdate(remote.name, update.update)}
        </Text>
      ) : update.can ? (
        <MenuRow
          label={`Update ${remote.name}`}
          hint={`${update.hint} It restarts into the new version; its agents keep going.`}
          icon={<RefreshCw size={18} color={t.text} />}
          onPress={update.start}
        />
      ) : update.devBuild ? (
        <Text style={[styles.note, { color: t.muted }]}>
          {`${update.hint} It's a development build, so it doesn't update itself.`}
        </Text>
      ) : update.needed && !update.askable ? (
        <Text style={[styles.note, { color: t.muted }]}>
          {remote.name} runs an older Relay. Update it there once; after that
          this phone can do it.
        </Text>
      ) : null}
      <MenuRow
        label="Pair another computer"
        hint="Scan the code in Relay's Settings → Phone there."
        icon={<Plus size={18} color={t.text} />}
        onPress={() => router.push("/pair")}
      />
      <MenuRow
        label={`Unpair from ${remote.name}`}
        hint="Forgets it here. Pairing again needs a new code from Relay there."
        destructive
        onPress={() =>
          Alert.alert(`Unpair from ${remote.name}?`, undefined, [
            { text: "Cancel", style: "cancel" },
            {
              text: "Unpair",
              style: "destructive",
              onPress: () =>
                void remote.forget().then(() => {
                  if (remote.computers.length > 1) {
                    if (router.canDismiss()) router.dismissAll();
                  } else router.replace("/pair");
                }),
            },
          ])
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 40 },
  iconSpace: { width: 16 },
  computer: { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  note: { fontSize: type.tiny, lineHeight: 17, paddingHorizontal: 20, paddingVertical: 10 },
  text: { flex: 1, gap: 3 },
  name: { fontSize: type.body, fontWeight: "600" },
  hint: { fontSize: type.tiny, lineHeight: 17 },
});
