import type { CommandOption, RelayCommand } from "../../../shared/commands";
import type {
  ChatSummary,
  LinkedFolder,
  Project,
  WorktreeStart,
} from "../../../shared/projects";
import type { TerminalSession } from "../../../shared/terminal-sessions";
import { api } from "../../lib/api";
import { noteUsed } from "../../lib/used";
import { forkThreadSettings } from "../agents/composer-settings";
import {
  FAILED,
  listingOptions,
  LOOKING,
  matchingSessions,
  NONE,
  sessionKey,
} from "./rows";
import { useSessionListing } from "./useSessionListing";

const OFF_BRANCH =
  "A session from a terminal or an agent's app goes on from the project folder, not another branch: pick New worktree or Current checkout first";

/** Why a picked session can't go on where the composer would start the thread, when it can't. */
function refusalFor(
  project: Project,
  workspace: "checkout" | "worktree",
  start: WorktreeStart | undefined,
) {
  // A worktree here can't hold the files of a session on that computer.
  if (project.computer && workspace === "worktree")
    return `A session on ${project.computer.name} goes on in its checkout: pick Current checkout first`;
  // The session's files are the project folder's, so its worktree copies those.
  if (workspace === "worktree" && start) return OFF_BRANCH;
  return undefined;
}

/** What the menu says about where a picked session goes on. */
function whereItContinues(
  project: Project,
  workspace: "checkout" | "worktree",
  refusal: string | undefined,
) {
  if (refusal) return `${refusal} · `;
  if (project.computer) return `Runs on ${project.computer.name} · `;
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
  const listing = useSessionListing(project.id);
  const refusal = refusalFor(project, workspace, start);

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
      if (refusal) return `${refusal}.`;
      const typed = args.trim();
      if (typed === LOOKING) return "Still looking for sessions.";
      if (typed === FAILED) return "Couldn't look for sessions.";
      if (!typed || typed === NONE) return "Pick a session after /resume.";
      const list = listing.listed();
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
      const where = whereItContinues(project, workspace, refusal);
      return listingOptions(listing.current(), query, where, project.name);
    },
  };
}
