import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { ChevronDown, RefreshCw, Search, SquareTerminal } from "lucide-react";
import type { ChatSummary, Project } from "../../../shared/projects";
import type { TerminalSession } from "../../../shared/terminal-sessions";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/error-message";
import { forkThreadSettings } from "../agents/composer-settings";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { matchingSessions, sessionDetail, sessionKey } from "./rows";
import "../pulls/pull-picker.css";
import "./continue-session.css";

/**
 * Picks a Claude Code or Codex session run in a terminal in the project's
 * folder; the thread that carries it on opens at once.
 */
export function ContinueSessionPicker({
  project,
  settingsKey,
  workspace,
  branch,
  onContinued,
  onOpenThread,
}: {
  project: Project;
  /** The draft whose composer settings the new thread starts from. */
  settingsKey: string;
  workspace: "checkout" | "worktree";
  branch?: string;
  /** A thread was made for the session. */
  onContinued: (chat: ChatSummary) => Promise<void>;
  /** The session already had a thread. */
  onOpenThread: (chat: ChatSummary) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const highlighted = useRef<string | null>(null);
  const list = useQuery({
    queryKey: ["terminal-sessions", project.id],
    queryFn: () => api.terminalSessions(project.id),
    enabled: open,
    staleTime: 0,
  });
  const matches = matchingSessions(list.data ?? [], search);

  async function pick(session: TerminalSession) {
    if (busy) return;
    setBusy(sessionKey(session));
    setError(undefined);
    try {
      // A session some thread already continues opens that thread.
      const { chat, created } = await api.continueTerminalSession(
        project.id,
        { provider: session.provider, session: session.id },
        workspace,
        workspace === "worktree" ? branch : undefined,
      );
      if (created) forkThreadSettings(settingsKey, chat.id, session.provider);
      setOpen(false);
      await (created ? onContinued(chat) : onOpenThread(chat));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) {
          setSearch("");
          setError(undefined);
          highlighted.current = null;
        }
      }}
    >
      <Popover.Trigger
        type="button"
        className="thread-context-button"
        aria-label="Continue a terminal session"
      >
        <SquareTerminal size={14} aria-hidden />
        <span>Continue a session…</span>
        <ChevronDown size={12} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="project-pull-positioner"
          side="top"
          align="start"
          sideOffset={7}
          collisionPadding={12}
        >
          <Popover.Popup
            className="project-pull-popup continue-session-popup"
            aria-label="Continue a terminal session"
            initialFocus={input}
          >
            <Combobox.Root<string>
              inline
              open
              autoHighlight
              items={matches.map(sessionKey)}
              filter={null}
              inputValue={search}
              onInputValueChange={(value) => {
                highlighted.current = null;
                setSearch(value);
              }}
              onItemHighlighted={(value) => {
                highlighted.current = value ?? null;
              }}
              value={null}
              onValueChange={(value) => {
                const session = matches.find((s) => sessionKey(s) === value);
                if (session) void pick(session);
              }}
            >
              <div className="project-pull-search">
                <Search size={16} aria-hidden />
                <Combobox.Input
                  ref={input}
                  aria-label="Search terminal sessions"
                  placeholder="Search sessions…"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!!busy}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpen(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="project-pull-refresh"
                  aria-label="Look again"
                  title="Look again"
                  onClick={() => void list.refetch()}
                >
                  <RefreshCw size={14} aria-hidden />
                </button>
              </div>
              <p className="continue-session-note">
                Claude Code and Codex sessions started in a terminal in{" "}
                {project.name}
                {workspace === "worktree" ? ", continued in a new worktree" : ""}
                .
              </p>
              {error && (
                <p className="project-pull-status" role="alert">
                  {error}
                </p>
              )}
              <div className="project-pull-scroll">
                {list.isPending ? (
                  <p className="project-pull-status">Looking for sessions…</p>
                ) : list.error ? (
                  <div className="project-pull-status" role="alert">
                    Couldn’t look for sessions.{" "}
                    <button type="button" onClick={() => void list.refetch()}>
                      Retry
                    </button>
                  </div>
                ) : matches.length ? (
                  <Combobox.List aria-label="Terminal sessions">
                    {matches.map((session, index) => (
                      <Combobox.Item
                        key={sessionKey(session)}
                        value={sessionKey(session)}
                        index={index}
                        className="project-pull-row continue-session-row"
                        aria-busy={busy === sessionKey(session)}
                        disabled={!!busy}
                      >
                        <span className="project-pull-row-title">
                          {session.title}
                        </span>
                        <span className="project-pull-row-detail continue-session-detail">
                          <ProviderIcon provider={session.provider} />
                          {busy === sessionKey(session)
                            ? "Bringing it over…"
                            : sessionDetail(session)}
                        </span>
                      </Combobox.Item>
                    ))}
                  </Combobox.List>
                ) : (
                  <p className="project-pull-status">
                    {search
                      ? "No matching sessions."
                      : "No terminal sessions in this folder in the last 30 days."}
                  </p>
                )}
              </div>
            </Combobox.Root>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
