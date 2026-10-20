import { useReducer } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CommandOption, RelayCommand } from "../../../shared/commands";
import type {
  ChatSummary,
  LinkedFolder,
  Project,
  WorktreeStart,
} from "../../../shared/projects";
import type { TerminalSession } from "../../../shared/terminal-sessions";
import { agentName } from "../../../shared/agents";
import { api } from "../../lib/api";
import { noteUsed } from "../../lib/used";
import { forkThreadSettings } from "../agents/composer-settings";
import { matchingSessions, sessionDetail, sessionKey } from "./rows";

/** Options that only say why there's nothing to pick yet. */
const LOOKING = ":looking";
const NONE = ":none";
/** A listing older than this is looked up again when the menu asks. */
const FRESH_MS = 15_000;
const OFF_BRANCH =
  "A session from a terminal or an agent's app goes on from the project folder, not another branch: pick New worktree or Current checkout first";

/**
 * `/resume`: carries on a Claude Code or Codex session run in a terminal, or
 * in the Claude or Codex app, in the project's folder, in a thread of its own that opens at once.
 */
export function useResumeCommand({
  project,
  settingsKey,
  workspace,
  branch,
  start,
  links,
  onContinued,
  onOpenThread,
  onError,
}: {
  project: Project;
  /** The thread whose composer settings the new thread starts from. */
  settingsKey: string;
  workspace: "checkout" | "worktree";
  branch?: string;
  /** A branch picked for the new worktree, which a session from the project folder can't go on. */
  start?: WorktreeStart;
  links?: LinkedFolder[];
  /** A thread was made for the session. */
  onContinued: (chat: ChatSummary) => Promise<void>;
  /** The session already had a thread. */
  onOpenThread: (chat: ChatSummary) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const key = ["terminal-sessions", project.id];
  // The session's files are the project folder's, so its worktree copies those.
  const offBranch = workspace === "worktree" && !!start;

  function sessions(): TerminalSession[] | undefined {
    const state = qc.getQueryState<TerminalSession[]>(key);
    if (
      state?.fetchStatus !== "fetching" &&
      (!state || Date.now() - state.dataUpdatedAt > FRESH_MS)
    )
      void qc
        .query({
          queryKey: key,
          queryFn: () => api.terminalSessions(project.id),
          staleTime: FRESH_MS,
        })
        .catch(onError)
        .then(bump);
    return state?.data;
  }

  async function resume(session: TerminalSession) {
    // A session some thread already continues opens that thread.
    const { chat, created } = await api.continueTerminalSession(
      project.id,
      { provider: session.provider, session: session.id },
      workspace,
      workspace === "worktree" ? branch : undefined,
      links,
    );
    // Imported terminal logs have no Relay send settings to acknowledge.
    if (created)
      forkThreadSettings(settingsKey, chat.id, session.provider, undefined);
    // The session is in Relay now, which the next listing should say.
    qc.removeQueries({ queryKey: key });
    await (created ? onContinued(chat) : onOpenThread(chat));
  }

  return {
    command(command: RelayCommand, args: string): boolean | string | undefined {
      if (command !== "resume") return undefined;
      if (project.scratch) return "Scratchpad has no sessions to resume.";
      if (offBranch) return `${OFF_BRANCH}.`;
      const typed = args.trim();
      if (typed === LOOKING) return "Still looking for sessions.";
      if (!typed || typed === NONE) return "Pick a session after /resume.";
      const list = qc.getQueryData<TerminalSession[]>(key) ?? [];
      const session =
        list.find((s) => sessionKey(s) === typed) ??
        matchingSessions(list, typed)[0];
      if (!session) return `No session matches “${typed}”.`;
      noteUsed("resume");
      void resume(session).catch(onError);
      return true;
    },
    options(command: RelayCommand, query: string): CommandOption[] | undefined {
      if (command !== "resume" || project.scratch) return undefined;
      const list = sessions();
      if (!list)
        return [{ value: LOOKING, label: "Looking for sessions…", source: "" }];
      const where = offBranch
        ? `${OFF_BRANCH} · `
        : workspace === "worktree"
          ? "Continues in a new worktree · "
          : "";
      const found = matchingSessions(list, query).map((s) => ({
        value: sessionKey(s),
        label: s.title,
        description: where + sessionDetail(s),
        source: s.app ? `${agentName(s.provider)} app` : "Terminal",
        terminal: true,
      }));
      return found.length || query
        ? found
        : [
            {
              value: NONE,
              label: "No sessions to resume",
              description: `No saved sessions found in ${project.name}`,
              source: "",
            },
          ];
    },
  };
}
