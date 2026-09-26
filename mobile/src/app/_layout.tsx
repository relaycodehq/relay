import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { RemoteProvider } from "../remote/RemoteProvider";
import { useTheme } from "../ui/theme";

export default function Layout() {
  const t = useTheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.background);
  }, [t.background]);
  return (
    <RemoteProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.background },
          headerTintColor: t.text,
          headerTitleStyle: { fontSize: 16, fontWeight: "600" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Relay" }} />
        <Stack.Screen name="pair" options={{ title: "Pair with Relay" }} />
        <Stack.Screen name="new" options={{ title: "New thread" }} />
        <Stack.Screen name="chat/[id]" options={{ title: "" }} />
        <Stack.Screen name="diff" options={{ title: "Diff" }} />
      </Stack>
    </RemoteProvider>
  );
}
