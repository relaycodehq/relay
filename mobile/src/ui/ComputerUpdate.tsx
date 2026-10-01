import { useEffect } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { phoneUpdatesBridge } from "../../../shared/remote";
import { useRemote } from "../remote/RemoteProvider";
import {
  canSelfUpdate,
  describeUpdate,
  dismissUpdate,
  isDismissed,
  probeComputer,
  updateComputer,
  useComputerUpdate,
} from "../remote/computer-update";
import { runningVersion } from "../remote/self-update";
import { type, useTheme } from "./theme";

/**
 * Whether the computer in use runs an older Relay than this phone, and what
 * can be done about it from here: from bridge 11 the phone asks the
 * computer's own updater; before that it has to be updated there by hand.
 */
export function useComputerUpdateAction() {
  const remote = useRemote();
  const { active, overview, status, call, name } = remote;
  const update = useComputerUpdate(active);
  const online = status === "online";
  const needed = online && (remote.outdated || remote.behind);
  const askable = (overview?.bridge ?? 1) >= phoneUpdatesBridge;
  useEffect(() => {
    if (needed && askable && active) void probeComputer(active, call);
  }, [needed, askable, active, call]);
  const running = overview?.version;
  const selfUpdates = active ? canSelfUpdate(active) : undefined;
  return {
    update,
    needed,
    /** Its bridge takes the phone's update call. */
    askable,
    /** Updatable from here; a development build isn't. */
    can: needed && askable && selfUpdates === true,
    devBuild: needed && askable && selfUpdates === false,
    dismissed: !!active && isDismissed(active, running),
    hint: running
      ? `${name} runs Relay ${running}, this phone ${runningVersion}.`
      : `${name} runs an older Relay than this phone.`,
    start: () => {
      if (active && running) void updateComputer(active, running, call);
    },
    dismiss: () => active && dismissUpdate(active, running),
  };
}

/** The computer in use is behind this phone: tap to update it, then how that goes. */
export function ComputerUpdateBanner() {
  const t = useTheme();
  const { name } = useRemote();
  const action = useComputerUpdateAction();
  const { update } = action;
  if (update) {
    const done = update.kind === "error" || update.kind === "latest";
    return (
      <Pressable
        accessibilityRole={done ? "button" : undefined}
        disabled={!done}
        onPress={action.dismiss}
      >
        <Text style={[styles.banner, { color: done ? t.text : t.muted }]}>
          {describeUpdate(name, update)}
          {done ? " Tap to hide." : ""}
        </Text>
      </Pressable>
    );
  }
  if (!action.needed || action.dismissed) return null;
  // An older bridge can't be asked; once it's updated by hand, it can.
  if (!action.askable)
    return (
      <Text style={[styles.banner, { color: t.text, backgroundColor: t.accentSoft }]}>
        Update Relay on {name} to use everything on this phone. After this
        once, the phone can update it for you.
      </Text>
    );
  if (!action.can) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={action.start}
      style={({ pressed }) => [{ backgroundColor: pressed ? t.hover : t.accentSoft }]}
    >
      <Text style={[styles.banner, { color: t.text }]}>
        {action.hint} Tap to update {name}; its agents keep going.
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { fontSize: type.small, lineHeight: 19, paddingHorizontal: 16, paddingVertical: 10 },
});
