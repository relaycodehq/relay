import { StyleSheet, Text } from "react-native";
import { useRemote } from "../remote/RemoteProvider";
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

const styles = StyleSheet.create({
  banner: { fontSize: type.small, lineHeight: 19, paddingHorizontal: 16, paddingVertical: 10 },
});
