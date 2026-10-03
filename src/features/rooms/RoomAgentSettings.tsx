import type { RoomAgent } from "./useRoomAgent";
import { ModelField } from "../agents/ModelField";
import { Modal } from "../../ui/ui";

/** Which model and effort a room's @codex and @claude questions use. */
export function RoomAgentSettings({
  agent: { choice, setChoice, claude, setClaude, save },
  onClose,
  onLink,
  onError,
}: {
  agent: RoomAgent;
  onClose: () => void;
  onLink: () => void;
  onError: (e: unknown) => void;
}) {
  return (
    <Modal title="Your room agent" onClose={onClose}>
      <p className="muted">
        Each @codex question uses your local Codex sign-in. Only its answer is
        shared. These settings apply to your next question.
      </p>
      <ModelField
        label="Room questions"
        allowDefault
        value={choice}
        onChange={setChoice}
      />
      <p className="muted">
        Install Codex CLI and run <code>codex login</code> in your terminal.
        Link this project’s folder so the agent can read relevant code.
      </p>
      <p className="muted">
        Mention @claude to use your own Claude Code sign-in. Claude has
        file-reading tools only. Codex Fast mode does not apply to Claude.
      </p>
      <label>
        Claude model
        <input
          aria-label="Claude model"
          placeholder="Claude default (or a model ID)"
          value={claude.model}
          onChange={(e) => setClaude((c) => ({ ...c, model: e.target.value }))}
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
            void save()
              .then(() => onClose())
              .catch(onError);
          }}
        >
          Save settings
        </button>
      </div>
    </Modal>
  );
}
