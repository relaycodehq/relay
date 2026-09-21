import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUpRight,
  AtSign,
  Check,
  Copy,
  MessageSquare,
  ChevronDown,
  FolderGit2,
  GitBranch,
  Zap,
  Reply,
  Send,
  Settings2,
  Users,
  X,
} from "lucide-react";
import type { Pull } from "../../shared/types";
import type { QuestionTarget } from "../../shared/questions";
import {
  agentMention,
  parseRoomInvitation,
  type RoomMessage,
  type RoomState,
  type Presence,
  type SendRoom,
  type Member,
} from "../../shared/rooms";
import {
  choiceLabel,
  defaultAISettings,
  modelName,
  effortLabels,
} from "../../shared/settings";
import { api } from "../lib/api";
import { ErrorBox, IconButton, Modal, Loading } from "./ui";
import { RoomAvatar, RoomTranscript } from "./RoomTranscript";
import { PaneResizer } from "./PaneResizer";
import { ModelField } from "./ModelField";
import "./rooms.css";

type Props = {
  pull: Pull;
  firstPane: boolean;
  accountId: string;
  path?: string;
  target: QuestionTarget | null;
  viewed: number;
  onClose: () => void;
  onSelect: (path: string) => void;
  onClearTarget: () => void;
  onLink: () => void;
  onAppSettings: () => void;
};
type Draft = {
  text: string;
  parentId: string | null;
  context?: SendRoom["context"];
  pending?: SendRoom;
};
export function RoomPanel({
  pull,
  firstPane,
  accountId,
  path,
  target,
  viewed,
  onClose,
  onSelect,
  onClearTarget,
  onLink,
  onAppSettings,
}: Props) {
  const key = JSON.stringify([accountId, pull.owner, pull.name, pull.number]);
  const storageKey = `relay-room-draft:${key}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? {
          text: "",
          parentId: null,
        }
      );
    } catch {
      return { text: "", parentId: null };
    }
  });
  const [messages, setMessages] = useState<RoomMessage[]>([]),
    [presence, setPresence] = useState<Presence[]>([]),
    [error, setError] = useState<unknown>(),
    [networkError, setNetworkError] = useState(false),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [people, setPeople] = useState(false),
    [generatedInvite, setGeneratedInvite] = useState(""),
    [showPresence, setShowPresence] = useState(false),
    [more, setMore] = useState(false),
    [newMessages, setNewMessages] = useState(false);
  const [sharePresence, setSharePresence] = useState(
    () => localStorage.getItem("relay-share-room-presence") === "true",
  );
  const [claude, setClaude] = useState<{
    model: string;
    effort: "" | "low" | "medium" | "high" | "xhigh" | "max";
  }>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("relay-room-claude") ?? "null") ?? {
          model: "",
          effort: "",
        }
      );
    } catch {
      return { model: "", effort: "" };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("relay-room-claude", JSON.stringify(claude));
    } catch {}
  }, [claude]);
  const [choice, setChoice] = useState(defaultAISettings.questions),
    [attachFile, setAttachFile] = useState(true);
  const [draftSaveError, setDraftSaveError] = useState(false);
  const viewport = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    cursor = useRef(0),
    follow = useRef(true);
  const state = useQuery({
    queryKey: ["roomState", key],
    queryFn: () => api.roomState(pull),
    retry: false,
  });
  const connection = state.data?.connection,
    room = state.data?.room;
  const mention = agentMention(draft.text);
  const parent = messages.find((m) => m.id === draft.parentId);
  useEffect(() => {
    void api
      .aiSettings()
      .then((s) => setChoice(s.questions))
      .catch(() => {});
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setDraftSaveError(false);
    } catch {
      setDraftSaveError(true);
    }
  }, [draft, storageKey]);
  useEffect(() => {
    if (target) {
      setDraft((d) => ({
        ...d,
        text: d.text || "@codex ",
        context: { ...target, head: pull.head.sha, base: pull.merge_base },
        pending: undefined,
      }));
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [target]);
  useEffect(() => {
    if (!room) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const page = await api.roomPoll(pull, cursor.current);
        if (!active) return;
        setMessages((old) => {
          if (!page.messages.length) return old;
          const map = new Map(old.map((m) => [m.id, m]));
          for (const m of page.messages) map.set(m.id, m);
          return [...map.values()].sort((a, b) => a.order - b.order);
        });
        if (cursor.current === 0) setMore(page.more);
        cursor.current = page.cursor;
        setPresence((old) =>
          JSON.stringify(old.map(({ at, ...p }) => p)) ===
          JSON.stringify(page.presence.map(({ at, ...p }) => p))
            ? old
            : page.presence,
        );
        setNetworkError(false);
        if (page.messages.length) {
          if (follow.current)
            requestAnimationFrame(() => {
              viewport.current?.scrollTo({
                top: viewport.current.scrollHeight,
              });
            });
          else setNewMessages(true);
        }
        timer = setTimeout(
          poll,
          page.more && page.messages.length === 100 ? 50 : 1200,
        );
      } catch {
        if (active) {
          setNetworkError(true);
          timer = setTimeout(poll, 3500);
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [room?.id]);
  useEffect(() => {
    if (!room) return;
    const send = () => {
      void api
        .roomPresence(
          pull,
          sharePresence && !document.hidden
            ? {
                path: path ?? null,
                head: pull.head.sha,
                viewed,
                total: pull.changed_files,
              }
            : null,
        )
        .catch(() => {});
    };
    send();
    const timer = setInterval(send, 6000);
    document.addEventListener("visibilitychange", send);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", send);
      void api.roomPresence(pull, null).catch(() => {});
    };
  }, [room?.id, sharePresence, path, pull.head.sha, viewed]);
  const updateText = (text: string) =>
    setDraft((d) => ({ ...d, text, pending: undefined }));
  const send = async () => {
    if (!draft.text.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    const submission: SendRoom = draft.pending ?? {
      id: crypto.randomUUID(),
      body: draft.text.trim(),
      parentId: draft.parentId,
      context: {
        head: pull.head.sha,
        base: pull.merge_base,
        ...(draft.context ?? (attachFile && path ? { path } : {})),
      },
      choice,
      claude,
    };
    setDraft((d) => ({ ...d, pending: submission }));
    try {
      await api.roomSend(pull, submission);
      setDraft({ text: "", parentId: null });
      onClearTarget();
      follow.current = true;
      input.current?.focus();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const act = (task: () => Promise<unknown>) => {
    setError(undefined);
    void task().catch(setError);
  };
  const selected = draft.context;
  return (
    <aside
      className={`room-panel ${firstPane ? "is-first-pane" : ""}`}
      aria-label="PR room"
    >
      <PaneResizer
        pane="room"
        label="Resize conversation"
        initial={460}
        min={340}
        max={760}
      />
      <header className="titlebar room-titlebar">
        <span className="room-thread-title" title={pull.title}>
          {pull.title}
        </span>
        <div className="room-header-actions">
          {connection && (
            <>
              <button
                className="room-avatars-button"
                aria-label="Review presence"
                title="Who's reviewing"
                aria-expanded={showPresence}
                onClick={() => setShowPresence((v) => !v)}
              >
                <span className="room-avatar-stack">
                  <RoomAvatar name={connection.member.name} />
                  {presence
                    .filter((p) => p.userId !== connection.member.id)
                    .slice(0, 2)
                    .map((p) => (
                      <RoomAvatar key={p.userId} name={p.name} />
                    ))}
                </span>
              </button>
              <button
                className="room-share"
                aria-label="Room members and invitations"
                onClick={() => setPeople(true)}
              >
                <Users size={13} />
                Share
              </button>
            </>
          )}
          <IconButton label="Hide PR room" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </header>
      <div className="room-subheader">
        <span>
          <MessageSquare size={12} /> PR #{pull.number}{" "}
          <span className="room-subheader-divider">/</span> Conversation
        </span>
        {connection && (
          <button
            className="room-connection-status"
            onClick={() => setShowPresence((v) => !v)}
            aria-expanded={showPresence}
          >
            <span className={`dot ${networkError ? "" : "green"}`} />
            {networkError ? "Reconnecting…" : "Connected"}
          </button>
        )}
      </div>
      {state.isPending ? (
        <Loading text="Opening room…" />
      ) : state.error ? (
        <ErrorBox error={state.error} retry={() => void state.refetch()} />
      ) : !connection ? (
        <RoomConnect
          pull={pull}
          onSettings={onAppSettings}
          onConnected={() => void state.refetch()}
          onInvited={async (code) => {
            await state.refetch();
            setGeneratedInvite(code);
            setPeople(true);
          }}
        />
      ) : (
        <>
          {showPresence && (
            <div
              className="room-presence-popover"
              role="region"
              aria-label="Review presence"
            >
              <div className="room-presence">
                <span className={`dot ${networkError ? "" : "green"}`} />
                <span>
                  {networkError
                    ? "Reconnecting · your draft is kept"
                    : presence.filter((p) => p.userId !== connection.member.id)
                          .length
                      ? `${presence.filter((p) => p.userId !== connection.member.id).length} colleague online`
                      : "Room connected"}
                </span>
                <label title="Share your current file and viewed count while this panel is open">
                  <input
                    type="checkbox"
                    checked={sharePresence}
                    onChange={(e) => {
                      setSharePresence(e.target.checked);
                      localStorage.setItem(
                        "relay-share-room-presence",
                        String(e.target.checked),
                      );
                    }}
                  />
                  Share my place
                </label>
              </div>
              {presence
                .filter((p) => p.userId !== connection.member.id)
                .map((p) => (
                  <button
                    className="room-colleague"
                    key={p.userId}
                    disabled={!p.path || p.head !== pull.head.sha}
                    onClick={() => p.path && onSelect(p.path)}
                    title={p.path ?? "Reviewing this PR"}
                  >
                    <span className="room-avatar">
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.path?.split("/").at(-1) ?? "Reviewing"} · {p.viewed}/
                        {p.total} viewed
                        {p.head !== pull.head.sha
                          ? " · different revision"
                          : ""}
                      </small>
                    </span>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
            </div>
          )}
          <div
            className="room-messages"
            ref={viewport}
            role="log"
            aria-label="Shared conversation"
            aria-live="off"
            onScroll={() => {
              const el = viewport.current!;
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              if (follow.current) setNewMessages(false);
            }}
          >
            {more && (
              <button
                className="room-load"
                onClick={() =>
                  act(async () => {
                    const el = viewport.current!,
                      height = el.scrollHeight;
                    const page = await api.roomPoll(
                      pull,
                      0,
                      messages[0]?.order,
                    );
                    setMessages((old) =>
                      [...page.messages, ...old].filter(
                        (m, i, a) => a.findIndex((x) => x.id === m.id) === i,
                      ),
                    );
                    setMore(page.more);
                    requestAnimationFrame(() => {
                      el.scrollTop += el.scrollHeight - height;
                    });
                  })
                }
              >
                Load earlier messages
              </button>
            )}
            {!messages.length && (
              <div className="room-empty">
                <span className="room-empty-icon">
                  <Users size={26} />
                </span>
                <h3>A second pair of eyes.</h3>
                <p>
                  Talk through this PR with your colleague.
                  <br />
                  Mention <code>@codex</code> to ask your agent.
                </p>
                <button onClick={() => setPeople(true)}>
                  Invite a colleague <ArrowUpRight size={14} />
                </button>
                <small>
                  Messages here stay in this room.
                  <br />
                  Gitea review comments are separate.
                </small>
              </div>
            )}
            <RoomTranscript
              messages={messages}
              head={pull.head.sha}
              memberId={connection.member.id}
              onSelect={onSelect}
              onReply={(m) => {
                setDraft((d) => ({ ...d, parentId: m.id, pending: undefined }));
                input.current?.focus();
              }}
              onCancel={(id) => act(() => api.roomCancel(pull, id))}
              onRetry={(m) => {
                const request = messages.find((x) => x.id === m.requestId);
                if (request) {
                  const { excerpt: _, ...context } = request.context;
                  setDraft({
                    text: request.body,
                    parentId: request.parentId,
                    context: context.start ? context : undefined,
                  });
                  input.current?.focus();
                } else
                  setError(
                    new Error(
                      "Load the original question above, then ask again.",
                    ),
                  );
              }}
            />
          </div>
          {newMessages && (
            <button
              className="room-new"
              onClick={() => {
                follow.current = true;
                viewport.current?.scrollTo({
                  top: viewport.current.scrollHeight,
                  behavior: "smooth",
                });
                setNewMessages(false);
              }}
            >
              New activity <ArrowDown size={12} />
            </button>
          )}
          <form
            className="room-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {draft.parentId && (
              <div className="room-compose-context">
                <Reply size={12} />
                <span>
                  Replying to {parent?.author ?? "a message"}:{" "}
                  {parent?.body.slice(0, 65) ?? "earlier conversation"}
                </span>
                <IconButton
                  label="Cancel reply"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      parentId: null,
                      pending: undefined,
                    }))
                  }
                >
                  <X size={12} />
                </IconButton>
              </div>
            )}
            {(selected || (attachFile && path)) && (
              <div className="room-compose-context">
                <span>
                  {selected
                    ? `${selected.path?.split("/").at(-1)}:${selected.start}–${selected.end} · ${selected.side === "deletions" ? "before" : "after"}`
                    : path?.split("/").at(-1)}{" "}
                  <small>
                    · {(selected?.head ?? pull.head.sha).slice(0, 7)}
                  </small>
                </span>
                <IconButton
                  label="Remove code context"
                  onClick={() => {
                    setAttachFile(false);
                    setDraft((d) => ({
                      ...d,
                      context: undefined,
                      pending: undefined,
                    }));
                    onClearTarget();
                  }}
                >
                  <X size={12} />
                </IconButton>
              </div>
            )}
            <div className="room-compose-input">
              <RoomAvatar name={connection.member.name} />
              <textarea
                ref={input}
                aria-label="Message PR room"
                placeholder="Message the room. @codex or @claude to ask your agent…"
                rows={3}
                maxLength={16000}
                value={draft.text}
                disabled={busy}
                onChange={(e) => updateText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
            </div>
            <div className="room-compose-tools">
              <label
                className="room-recipient"
                title="Choose who to address. Agents use your own account."
              >
                <AtSign size={13} />
                <select
                  aria-label="Message recipient"
                  value={mention?.provider ?? "people"}
                  onChange={(e) => {
                    const question = mention?.question ?? draft.text;
                    updateText(
                      e.target.value === "people"
                        ? question
                        : `@${e.target.value} ${question}`,
                    );
                    input.current?.focus();
                  }}
                >
                  <option value="people">People</option>
                  <option value="codex">My Codex</option>
                  <option value="claude">My Claude</option>
                </select>
              </label>
              <small className="room-send-hint">
                {mention
                  ? "Your agent · shared answer"
                  : "Message your colleagues"}
              </small>
              <button
                type="submit"
                className="room-send"
                aria-label={busy ? "Sending…" : mention ? "Ask" : "Send"}
                title="Send · ⌘/Ctrl ↵"
                disabled={busy || !draft.text.trim()}
              >
                <Send size={14} />
              </button>
            </div>
            <div className="room-modelbar">
              <button
                type="button"
                className="room-checkout"
                onClick={onLink}
                title="Link this project's local checkout"
              >
                <FolderGit2 size={12} />
                <span>{pull.name}</span>
                <GitBranch size={11} />
                <span>{pull.head.ref || pull.head.sha.slice(0, 7)}</span>
              </button>
              <div className="room-model-controls">
                <button
                  type="button"
                  onClick={() => setSettings(true)}
                  title="Reasoning effort"
                >
                  {mention?.provider === "claude"
                    ? claude.effort || "Default"
                    : choice.reasoningEffort
                      ? effortLabels[choice.reasoningEffort]
                      : "Default"}
                  <ChevronDown size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => setSettings(true)}
                  title={
                    mention?.provider === "claude"
                      ? claude.model || "Claude default"
                      : choiceLabel(choice)
                  }
                >
                  {mention?.provider === "claude"
                    ? claude.model || "Claude"
                    : modelName(choice.model)}
                  <ChevronDown size={10} />
                </button>
                <IconButton
                  label="Room agent settings"
                  onClick={() => setSettings(true)}
                >
                  <Settings2 size={13} />
                </IconButton>
                {mention?.provider !== "claude" && (
                  <span
                    className={`room-speed ${choice.fast ? "fast" : ""}`}
                    title={choice.fast ? "Fast mode" : "Standard speed"}
                  >
                    <Zap size={11} />
                    {choice.fast ? "Fast" : "Standard"}
                  </span>
                )}
              </div>
            </div>
          </form>
          {!connection.persistent && (
            <p className="room-notice">
              Room login is available for this session only; secure credential
              storage is unavailable.
            </p>
          )}
          {draftSaveError && (
            <p className="room-notice">
              Draft could not be saved on this device. Keep the app open or copy
              your message.
            </p>
          )}
          {!!error && (
            <div className="room-error">
              <ErrorBox error={error} />
              <button onClick={() => setError(undefined)}>Dismiss</button>
              <button onClick={onLink}>Link local folder</button>
            </div>
          )}
          {settings && (
            <Modal title="Your room agent" onClose={() => setSettings(false)}>
              <p className="muted">
                Each @codex question uses your local Codex sign-in. Only its
                answer is shared. These settings apply to your next question.
              </p>
              <ModelField
                label="Room questions"
                allowDefault
                value={choice}
                onChange={setChoice}
              />
              <p className="muted">
                Install Codex CLI and run <code>codex login</code> in your
                terminal. Link this project’s folder so the agent can read
                relevant code.
              </p>
              <p className="muted">
                Mention @claude to use your own Claude Code sign-in. Claude has
                file-reading tools only. Codex Fast mode does not apply to
                Claude.
              </p>
              <label>
                Claude model
                <input
                  aria-label="Claude model"
                  placeholder="Claude default (or a model ID)"
                  value={claude.model}
                  onChange={(e) =>
                    setClaude((c) => ({ ...c, model: e.target.value }))
                  }
                />
              </label>
              <label>
                Claude reasoning effort
                <select
                  aria-label="Claude reasoning effort"
                  value={claude.effort}
                  onChange={(e) =>
                    setClaude((c) => ({
                      ...c,
                      effort: e.target.value as typeof c.effort,
                    }))
                  }
                >
                  {["", "low", "medium", "high", "xhigh", "max"].map((e) => (
                    <option value={e} key={e}>
                      {e || "Claude default"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-actions">
                <button onClick={onLink}>Link local folder</button>
                <button
                  className="primary"
                  onClick={() => {
                    void api
                      .aiSettings()
                      .then((s) =>
                        api.saveAISettings({ ...s, questions: choice }),
                      )
                      .then(() => setSettings(false))
                      .catch(setError);
                  }}
                >
                  Save settings
                </button>
              </div>
            </Modal>
          )}
          {people && (
            <RoomPeople
              pull={pull}
              state={state.data!}
              initialInvite={generatedInvite}
              onClose={() => {
                setPeople(false);
                setGeneratedInvite("");
              }}
              onDisconnect={() => {
                act(async () => {
                  await api.roomDisconnect(pull);
                  setPeople(false);
                  setMessages([]);
                  cursor.current = 0;
                  await state.refetch();
                });
              }}
            />
          )}
        </>
      )}
    </aside>
  );
}

function RoomConnect({
  pull,
  onConnected,
  onInvited,
  onSettings,
}: {
  pull: Pull;
  onConnected: () => void;
  onInvited: (code: string) => Promise<void>;
  onSettings: () => void;
}) {
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <div className="room-connect">
      <div className="room-empty-icon">
        <Users size={27} />
      </div>
      <h2>Review it together.</h2>
      <p>
        Create a link for this pull request.
        <br />
        Your colleague opens it in Review Relay.
      </p>
      <button
        className="primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(undefined);
          void api
            .roomInvite(pull)
            .then((i) => onInvited(i.code))
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <Users size={16} />
        {busy ? "Creating invitation…" : "Invite colleague"}
      </button>
      <p className="field-note">
        A private conversation beside the code. Everyone uses their own Gitea
        login and agent account.
      </p>
      <details>
        <summary>Have an invitation link?</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            void (async () => {
              const { server, secret, projectId } = parseRoomInvitation(invite);
              await api.roomConnect(pull, { server, secret, projectId });
              onConnected();
            })()
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Project invitation
            <textarea
              rows={3}
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              autoComplete="off"
              placeholder="Paste an invitation link"
            />
          </label>
          <button disabled={busy || !invite.trim()}>Join project room</button>
        </form>
      </details>
      {!!error && <ErrorBox error={error} />}
      <button className="subtle" onClick={onSettings}>
        Hosting settings
      </button>
    </div>
  );
}
function RoomPeople({
  initialInvite,
  pull,
  state,
  onClose,
  onDisconnect,
}: {
  pull: Pull;
  state: RoomState;
  initialInvite: string;
  onClose: () => void;
  onDisconnect: () => void;
}) {
  const [invite, setInvite] = useState(initialInvite),
    [copied, setCopied] = useState(false),
    [error, setError] = useState<unknown>();
  const members = useQuery({
    queryKey: ["roomMembers", state.connection?.projectId],
    queryFn: () => api.roomMembers(pull),
  });
  return (
    <Modal title="People in this project" onClose={onClose}>
      <p className="muted">
        Invitations share this project’s PR rooms and their conversation
        history. Each person links their own repository folder and agent
        account.
      </p>
      <div className="room-member-list">
        {members.data?.map((m) => (
          <div key={m.id}>
            <span className="room-avatar">
              {m.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{m.name}</strong>
              <small>
                {m.owner ? "Project owner" : "Participant"} · {m.id.slice(0, 8)}
              </small>
            </span>
            {state.connection?.member.owner && !m.owner && (
              <button
                onClick={() => {
                  void api
                    .roomRevoke(pull, m.id)
                    .then(() => members.refetch())
                    .catch(setError);
                }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="muted">
        Names are participant labels, not verified Gitea identities. Invite only
        trusted collaborators.
      </p>
      {state.connection?.member.owner && (
        <>
          <button
            onClick={() => {
              void api
                .roomInvite(pull)
                .then((i) => {
                  setInvite(i.code);
                  setCopied(false);
                })
                .catch(setError);
            }}
          >
            {invite ? "Generate another link" : "Invite colleague"}
          </button>
          {invite && (
            <label>
              Invitation link
              <input
                aria-label="Invitation link"
                readOnly
                value={invite}
                onFocus={(e) => e.currentTarget.select()}
              />
              <small>
                Expires after 24 hours. Share directly with your colleague.
              </small>
              <button
                onClick={() => {
                  void api
                    .writeClipboard(invite)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(
                        new Error(
                          "Select the invitation link and copy it with ⌘C / Ctrl+C.",
                        ),
                      ),
                    );
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
                {copied ? "Copied" : "Copy invitation"}
              </button>
            </label>
          )}
        </>
      )}
      {!!(error || members.error) && (
        <ErrorBox error={error || members.error} />
      )}
      <div className="modal-actions">
        <button onClick={onDisconnect}>Disconnect this device</button>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
