import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Settings2 } from "lucide-react-native";
import { Browser } from "../screens/Browser";
import { ComputerSwitch } from "./ComputerSwitch";
import { SidebarToggle, openInPane } from "./panes";
import { useTheme } from "./theme";

/** The desktop's sidebar on a wide screen: the lists, beside what's open. */
export function Sidebar({
  width,
  selected,
  headerHeight,
  onHide,
}: {
  width: number;
  /** The thread or project open beside it. */
  selected?: string;
  /** The stack's header beside it, status bar included; 0 until known. */
  headerHeight: number;
  onHide: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.sidebar,
        {
          width: width + insets.left,
          paddingLeft: insets.left,
          paddingBottom: insets.bottom,
          backgroundColor: t.sidebar,
          borderColor: t.border,
        },
      ]}
    >
      <View
        style={[
          styles.head,
          { height: Math.max(headerHeight, insets.top + toolbar) },
        ]}
      >
        <SidebarToggle hidden={false} onPress={onHide} />
        <View style={styles.name}>
          <ComputerSwitch />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={10}
          onPress={() => openInPane("/settings")}
        >
          <Settings2 size={20} color={t.text} />
        </Pressable>
      </View>
      <Browser pane selected={selected} />
    </View>
  );
}

/** The native header's bar under the status bar, which the sidebar's top matches. */
const toolbar = Platform.OS === "ios" ? 44 : 64;

const styles = StyleSheet.create({
  sidebar: { borderRightWidth: StyleSheet.hairlineWidth },
  head: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: toolbar / 2 - 12,
  },
  name: { flex: 1, flexDirection: "row", marginRight: 12 },
});
