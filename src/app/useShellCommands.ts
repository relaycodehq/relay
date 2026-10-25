import { useEffect, type RefObject } from "react";
import type { RelayCommand } from "../../shared/commands";
import {
  jumpDigitOf,
  type MainWindowCommand,
} from "../../shared/thread-windows";
import { api } from "../lib/api";
import type { NavigationLock } from "../lib/navigation-lock";
import { openSettings, type SettingsCategory } from "../lib/settings-page";
import { useStableCallback } from "../lib/useStableCallback";
import type { GitActionsHandle } from "../features/changes/GitActions";
import { memeSetupDraft } from "../features/memes/meme-setup";
import { askJump } from "../features/sidebar/useActivityKeys";
import type { ThreadTools } from "./ThreadWorkspace";
import type { useNewThreads } from "./useNewThreads";
import type { ShellNavigation } from "./useShellNavigation";

/**
 * Relay's own commands typed in the composer, and those a thread's own
 * window asks this one to run. Whether a command was Relay's to run.
 */
export function useShellCommands({
  nav,
  lock,
  gitActions,
  starts,
  opens,
  loaded,
  setError,
}: {
  nav: ShellNavigation;
  lock: NavigationLock;
  gitActions: RefObject<GitActionsHandle | null>;
  starts: ReturnType<typeof useNewThreads>;
  opens: ThreadTools["opens"];
  /** The projects are in, so a command can open one. */
  loaded: boolean;
  setError: (error: unknown) => void;
}) {
  const { project, navigate } = nav;
  function runCommand(command: RelayCommand) {
    if (lock.blocked()) return false;
    const startsFresh = command === "new" || command === "clear";
    if (command === "openpr") gitActions.current?.openPr();
    else if (startsFresh && project?.scratch) void starts.scratch();
    else if (startsFresh && project) navigate(project, undefined, true);
    else if (command === "files" || command === "changes")
      opens.openCode(command);
    else if (command === "meme") void starts.scratchDraft(memeSetupDraft);
    else return false;
    return true;
  }
  // Asked from a thread's own window, which has no Scratchpad or Activity.
  const runAsked = useStableCallback((command: MainWindowCommand | null) => {
    if (!command) return;
    if (command === "meme") runCommand(command);
    else if (typeof command === "object")
      openSettings(
        command.settings as SettingsCategory,
        command.projectId,
        command.entryId,
      );
    else askJump(jumpDigitOf(command) - 1);
  });
  useEffect(() => {
    if (!loaded) return;
    void api.takeMainWindowCommand().then(runAsked).catch(setError);
    return api.onMainWindowCommand(runAsked);
  }, [loaded]);
  return runCommand;
}
