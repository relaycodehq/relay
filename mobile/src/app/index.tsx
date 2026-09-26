import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import { Settings2 } from "lucide-react-native";
import { useRemote } from "../remote/RemoteProvider";
import { Browser } from "../screens/Browser";
import { rowStyles } from "../ui/Rows";
import { useWide } from "../ui/panes";
import { useTheme } from "../ui/theme";

export default function Home() {
  const remote = useRemote();
  const t = useTheme();
  const wide = useWide();
  if (!remote.ready) return null;
  if (!remote.paired) return <Redirect href="/pair" />;
  // The list is in the sidebar; this is the pane before anything is open.
  if (wide)
    return (
      <View style={styles.empty}>
        {/* Empty, but it carries the button that brings a hidden list back. */}
        <Stack.Screen
          options={{ headerShown: true, title: "", headerRight: () => null }}
        />
        <Text style={[rowStyles.empty, { color: t.muted }]}>
          Open a thread from the list, or start a new one.
        </Text>
      </View>
    );
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: remote.name,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={10}
              onPress={() => router.push("/settings")}
            >
              <Settings2 size={20} color={t.text} />
            </Pressable>
          ),
        }}
      />
      <Browser />
    </>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
});
