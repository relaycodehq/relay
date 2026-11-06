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
import { UNLISTED, unlistedRow, useSessionListing } from "./session-listing";

/** The option that says the project has no sessions to pick. */
const NONE = ":none";
const OFF_BRANCH =
  "A session from a terminal or an agent's app goes on from the project folder, not another branch: pick New worktree or Current checkout first";

/** Where a picked session goes on, said before its details. */
function continuesWhere(
  offBranch: boolean,
  workspace: "checkout" | "worktree",
) {
  if (offBranch) return `${OFF_BRANCH} · `;
  if (workspace === "worktree") return "Continues in a new worktree · ";
  return "";
}

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
  const listing = useSessionListing(project, onError);
  // The session's files are the project folder's, so its worktree copies those.
  const offBranch = workspace === "worktree" && !!start;

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
    listing.forget();
    await (created ? onContinued(chat) : onOpenThread(chat));
  }

  return {
    command(command: RelayCommand, args: string): boolean | string | undefined {
      if (command !== "resume") return undefined;
      if (project.scratch) return "Scratchpad has no sessions to resume.";
      if (offBranch) return `${OFF_BRANCH}.`;
      const typed = args.trim();
      const shown = listing.current();
      if (shown.status !== "listed") return unlistedRow(shown).reply;
      if (!typed || typed === NONE || typed === UNLISTED)
        return "Pick a session after /resume.";
      const list = shown.sessions;
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
      const shown = listing.current();
      if (shown.status !== "listed") return [unlistedRow(shown)];
      const where = continuesWhere(offBranch, workspace);
      const found = matchingSessions(shown.sessions, query).map((s) => ({
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
