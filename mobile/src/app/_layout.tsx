import { useEffect, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Stack, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SystemUI from "expo-system-ui";
import { RemoteProvider, useRemote } from "../remote/RemoteProvider";
import { useOfflineCopies } from "../remote/offline-copies";
import { resendFailed } from "../remote/outbox";
import { appReport, checkForUpdate, confirmLaunch, useSelfUpdate } from "../remote/self-update";
import {
  FullWidthContext,
  HeaderHeightContext,
  ReportHeaderHeight,
  SidebarToggle,
  paneBreakpoint,
  sidebarWidth,
  useOpenItem,
  useOrientationPolicy,
  useSidebarHidden,
} from "../ui/panes";
import { ComputerSheet } from "../ui/ComputerSwitch";
import { ConnectionLine } from "../ui/ConnectionLine";
import { NeedsYou } from "../ui/NeedsYou";
import { Sidebar } from "../ui/Sidebar";
import { ThemeProvider } from "../ui/ThemeProvider";
import { StartupSplash } from "../ui/StartupSplash";
import { useTheme } from "../ui/theme";

export default function Layout() {
  return (
    <RemoteProvider>
      <ThemeProvider>
        <StartupSplash>
          <Screens />
        </StartupSplash>
      </ThemeProvider>
    </RemoteProvider>
  );
}

function Screens() {
  const t = useTheme();
  const remote = useRemote();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [fullWidth, setFullWidth] = useState(false);
  const [hidden, toggleSidebar] = useSidebarHidden();
  const [headerHeight, setHeaderHeight] = useState(0);
  const selected = useOpenItem(pathname);
  useOrientationPolicy();
  useOfflineCopies();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.background);
  }, [t.background]);
  useEffect(confirmLaunch, []);
  const { overview, call, status } = remote;
  const { desktop } = remote;
  useEffect(() => {
    if (status === "online") resendFailed(desktop);
  }, [status, desktop]);
  // The overview kept from last time arrives before the connection does.
  const offer = status === "online" ? overview?.phoneApp : undefined;
  useEffect(() => {
    void checkForUpdate(offer, (path, offset) => call("phoneAppFile", path, offset));
  }, [offer, call]);
  // So the desktop's Settings can tell what this phone runs. The report
  // leaves out download progress, so it goes out at start and finish only.
  const reported = JSON.stringify(appReport(useSelfUpdate()));
  useEffect(() => {
    // Older desktops don't take the report.
    if (status === "online") void call("reportApp", JSON.parse(reported)).catch(() => {});
  }, [status, reported, call]);
  // Beside the list: an unfolded foldable or a tablet, once paired.
  const panes =
    width >= paneBreakpoint &&
    remote.ready &&
    remote.paired &&
    pathname !== "/pair";
  const sidebar = panes && !hidden && !fullWidth;
  return (
    <FullWidthContext.Provider value={setFullWidth}>
      <HeaderHeightContext.Provider value={setHeaderHeight}>
        <View style={[styles.panes, { backgroundColor: t.background }]}>
          {sidebar && (
            <Sidebar
              width={sidebarWidth(width)}
              selected={selected}
              headerHeight={headerHeight}
              onHide={toggleSidebar}
            />
          )}
          <View style={styles.pane}>
            <Stack
              screenLayout={({ children, route }) => (
                <ReportHeaderHeight>
                  <View style={styles.pane}>
                    {/* Every screen says when the computer isn't there; the
                        list says it itself, in the sidebar when that shows. */}
                    {!sidebar &&
                      !ownLine.has(route.name) &&
                      !(route.name === "index" && !panes) && <ConnectionLine />}
                    {children}
                  </View>
                </ReportHeaderHeight>
              )}
              screenOptions={({ navigation, route }) => ({
                headerStyle: { backgroundColor: t.background },
                headerTintColor: t.text,
                headerTitleStyle: { fontSize: 16, fontWeight: "600" },
                headerShadowVisible: false,
                contentStyle: {
                  backgroundColor: t.background,
                  // Lists end above Android's navigation bar instead of under
                  // it; screens with a composer pad it themselves.
                  paddingBottom: ownsBottom.has(route.name) ? 0 : insets.bottom,
                },
                // Beside the list, the first screen has nothing to go back to.
                headerBackVisible: !(
                  panes && navigation.getState()?.routes[1]?.key === route.key
                ),
                headerLeft:
                  panes && hidden && !fullWidth
                    ? () => <SidebarToggle hidden onPress={toggleSidebar} />
                    : undefined,
              })}
            >
              <Stack.Screen name="index" options={{ title: "Relay" }} />
              <Stack.Screen
                name="pair"
                options={{ title: "Pair with Relay" }}
              />
              <Stack.Screen name="new" options={{ title: "New thread" }} />
              <Stack.Screen name="settings" options={{ title: "Settings" }} />
              <Stack.Screen name="chat/[id]/index" options={{ title: "" }} />
              <Stack.Screen
                name="chat/[id]/reply/[root]"
                options={{ title: "Replies" }}
              />
              <Stack.Screen name="project/[id]" options={{ title: "" }} />
              <Stack.Screen name="turn" options={{ title: "Changes" }} />
              <Stack.Screen name="diff" options={{ title: "Diff" }} />
            </Stack>
            <NeedsYou
              top={headerHeight}
              openId={selected}
              hidden={sidebar || pathname === "/"}
              pane={panes}
            />
          </View>
          {remote.paired && <ComputerSheet />}
        </View>
      </HeaderHeightContext.Provider>
    </FullWidthContext.Provider>
  );
}

/** Screens that show the connection their own way. */
const ownLine = new Set(["settings", "pair"]);

/** Screens whose composer already keeps clear of the navigation bar. */
const ownsBottom = new Set([
  "new",
  "chat/[id]/index",
  "chat/[id]/reply/[root]",
]);

const styles = StyleSheet.create({
  panes: { flex: 1, flexDirection: "row" },
  pane: { flex: 1 },
});
