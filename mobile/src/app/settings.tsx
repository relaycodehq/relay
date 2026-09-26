import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Check, Monitor } from "lucide-react-native";
import { useRemote } from "../remote/RemoteProvider";
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
      <SectionTitle>Computer</SectionTitle>
      <View style={styles.computer}>
        <Monitor size={18} color={t.muted} />
        <View style={styles.text}>
          <Text style={[styles.name, { color: t.text }]}>{remote.name}</Text>
          <Text style={[styles.hint, { color: t.muted }]}>
            Paired. Remove this phone in Relay's Settings → Phone to cut it off from there.
          </Text>
        </View>
      </View>
      <MenuRow
        label="Unpair this phone"
        hint="Forgets the computer here. Pairing again needs a new code from Relay."
        destructive
        onPress={() =>
          Alert.alert(`Unpair from ${remote.name}?`, undefined, [
            { text: "Cancel", style: "cancel" },
            {
              text: "Unpair",
              style: "destructive",
              onPress: () => void remote.forget().then(() => router.replace("/pair")),
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
  text: { flex: 1, gap: 3 },
  name: { fontSize: type.body, fontWeight: "600" },
  hint: { fontSize: type.tiny, lineHeight: 17 },
});
