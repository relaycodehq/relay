import { StyleSheet, Text, View } from "react-native";
import { router, type ErrorBoundaryProps } from "expo-router";
import { Button } from "./Button";
import { type, useTheme } from "./theme";
import { UpdateBanner } from "./UpdateBanner";

/**
 * What a screen shows when it throws while rendering, in place of a blank
 * screen the app can't leave. The header stays, so back still works. The
 * usual cause is a computer on a newer Relay sending something this build
 * doesn't know, so the update offer goes here too.
 */
export function ScreenFailed({ error, retry }: ErrorBoundaryProps) {
  const t = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: t.background }]}>
      <UpdateBanner />
      <View style={styles.center}>
        <Text style={[styles.title, { color: t.text }]}>
          This screen hit a bug
        </Text>
        <Text style={[styles.note, { color: t.muted }]} selectable>
          {error.message}
        </Text>
        <Text style={[styles.note, { color: t.muted }]}>
          If your computer runs a newer Relay, updating this app usually fixes
          it.
        </Text>
        <View style={styles.actions}>
          <Button label="Try again" onPress={() => void retry()} />
          {router.canGoBack() && (
            <Button label="Go back" onPress={() => router.back()} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
  },
  title: { fontSize: type.body, fontWeight: "600", textAlign: "center" },
  note: { fontSize: type.small, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10 },
});
