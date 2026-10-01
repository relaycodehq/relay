import { useRef, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { ChevronDown, Monitor, Plus, RefreshCw } from "lucide-react-native";
import { useRemote, type PairedComputer } from "../remote/RemoteProvider";
import { useComputerUpdateAction } from "./ComputerUpdate";
import { MenuRow, Sheet } from "./Sheet";
import { useTheme } from "./theme";

// The sheet sits beside the stack, not in the header: a modal inside the
// native header's title is left behind when the header is rebuilt.
let sheetOpen = false;
const listeners = new Set<() => void>();
const setOpen = (next: boolean) => {
  sheetOpen = next;
  for (const listener of listeners) listener();
};
const useOpen = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => sheetOpen,
  );

/** The computer's name atop the lists; tapping it opens `ComputerSheet`. */
export function ComputerSwitch() {
  const t = useTheme();
  const { name } = useRemote();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. Switch computer`}
      hitSlop={8}
      onPress={() => setOpen(true)}
      style={styles.title}
    >
      <Text numberOfLines={1} style={[styles.name, { color: t.text }]}>
        {name}
      </Text>
      <ChevronDown size={15} color={t.muted} />
    </Pressable>
  );
}

/**
 * The paired computers to switch to, and pairing another. The phone talks
 * to one at a time. Rendered once, beside the stack.
 */
export function ComputerSheet() {
  const t = useTheme();
  const remote = useRemote();
  const action = useComputerUpdateAction();
  const open = useOpen();
  // iOS won't navigate while the sheet is still leaving; the pick waits for it.
  const picked = useRef<() => void>(undefined);
  const run = () => {
    const next = picked.current;
    picked.current = undefined;
    next?.();
  };
  const pick = (next: () => void) => {
    picked.current = next;
    setOpen(false);
    if (Platform.OS !== "ios") run();
  };
  const switchTo = (c: PairedComputer) =>
    pick(() => {
      if (c.id === remote.active) return;
      // Whatever is open belongs to the computer being left.
      if (router.canDismiss()) router.dismissAll();
      void remote.switchTo(c.id);
    });
  const status = (c: PairedComputer) => {
    if (c.id !== remote.active) return "Tap to switch to it";
    const version = remote.overview?.version;
    if (remote.status === "online")
      return version ? `Connected · Relay ${version}` : "Connected";
    if (remote.status === "connecting") return "Connecting…";
    if (remote.status === "denied") return "Turned this phone away";
    return "Can't reach it right now";
  };
  return (
    <Sheet
      open={open}
      title="Computers"
      onClose={() => setOpen(false)}
      onDismiss={run}
    >
      {remote.computers.map((c) => (
        <MenuRow
          key={c.id}
          label={c.name}
          hint={status(c)}
          checked={c.id === remote.active}
          icon={
            <Monitor
              size={17}
              color={c.id === remote.active ? t.accent : t.muted}
            />
          }
          onPress={() => switchTo(c)}
        />
      ))}
      {action.can && !action.update && (
        <MenuRow
          label={`Update ${remote.name}`}
          hint={`${action.hint} It restarts into the new version; its agents keep going.`}
          icon={<RefreshCw size={17} color={t.text} />}
          onPress={() => pick(action.start)}
        />
      )}
      <MenuRow
        label="Pair another computer"
        hint="Scan the code in Relay's Settings → Phone there."
        icon={<Plus size={17} color={t.text} />}
        onPress={() => pick(() => router.push("/pair"))}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  name: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
});
