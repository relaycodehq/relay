import {
  AtSign,
  ChevronDown,
  FolderGit2,
  GitBranch,
  Reply,
  Send,
  Settings2,
  X,
  Zap,
} from "lucide-react";
import { agentName, agents, helperProviders } from "../../../shared/agents";
import type { RoomMessage } from "../../../shared/rooms";
import { choiceLabel, effortLabels, modelName } from "../../../shared/settings";
import type { Pull } from "../../../shared/types";
import { sendKeyLabel, sendsMessage, type SendKey } from "../../lib/send-key";
import type { RoomAgent } from "./useRoomAgent";
import type { RoomCompose } from "./useRoomCompose";
import { RoomAvatar } from "./RoomTranscript";
import { IconButton } from "../../ui/ui";

/** The room's message box, with what it replies to and the code it's about. */
export function RoomComposer({
  pull,
  path,
  compose: {
    draft,
    setDraft,
    updateText,
    mention,
    attachFile,
    setAttachFile,
    busy,
    input,
  },
  agent: { claude, choice },
  parent,
  memberName,
  sendKey,
  onSend,
  onClearTarget,
  onLink,
  onSettings,
}: {
  pull: Pull;
  path?: string;
  compose: RoomCompose;
  agent: RoomAgent;
  /** The message the draft replies to, once it's loaded. */
  parent?: RoomMessage;
  memberName: string;
  sendKey: SendKey;
  onSend: () => void;
  onClearTarget: () => void;
  onLink: () => void;
  onSettings: () => void;
}) {
  const selected = draft.context;
  return (
    <form
      className="room-composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
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
            <small>· {(selected?.head ?? pull.head.sha).slice(0, 7)}</small>
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
        <RoomAvatar name={memberName} />
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
            if (sendsMessage(e, sendKey)) {
              e.preventDefault();
              onSend();
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
            {helperProviders.map((p) => (
              <option key={p} value={p}>
                My {agentName(p)}
              </option>
            ))}
          </select>
        </label>
        <small className="room-send-hint">
          {mention ? "Your agent · shared answer" : "Message your colleagues"}
        </small>
        <button
          type="submit"
          className="room-send"
          aria-label={busy ? "Sending…" : mention ? "Ask" : "Send"}
          title={`Send · ${sendKeyLabel(sendKey)}`}
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
          <button type="button" onClick={onSettings} title="Reasoning effort">
            {mention?.provider === "claude"
              ? claude.effort || "Default"
              : choice.reasoningEffort
                ? effortLabels[choice.reasoningEffort]
                : "Default"}
            <ChevronDown size={10} />
          </button>
          <button
            type="button"
            onClick={onSettings}
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
          <IconButton label="Room agent settings" onClick={onSettings}>
            <Settings2 size={13} />
          </IconButton>
          {(!mention || agents[mention.provider].fast) && (
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
  );
}
