import { useState } from "react";
import { Terminal } from "lucide-react";
import type { Pull, Side } from "../../../shared/types";
import { api } from "../../lib/api";
import { ErrorBox, Modal } from "../../ui/ui";

/** Hands a line comment to Codex CLI in the linked checkout. */
export function CodexSheet({
  pull,
  target,
  linked,
  onLink,
  onClose,
}: {
  pull: Pull;
  target: { path: string; line: number; side: Side; body: string };
  linked: boolean;
  onLink: () => Promise<void>;
  onClose: () => void;
}) {
  const [body, setBody] = useState(target.body),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  return (
    <Modal title="Fix with Codex" onClose={onClose}>
      <div className="codex-target">
        <Terminal size={19} />
        <div>
          <strong>{target.path}</strong>
          <small>
            Line {target.line} · {target.side === "deletions" ? "Base" : "Head"}{" "}
            · {pull.head.sha.slice(0, 8)}
          </small>
        </div>
      </div>
      <label>
        Instructions
        <textarea
          autoFocus
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className="field-note">
        Opens an interactive Codex CLI session in your linked folder, with
        workspace-write sandboxing and approval prompts. Uses your existing
        Codex login. No automatic commit or push.
      </p>
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        {!linked ? (
          <button className="primary" onClick={() => void onLink()}>
            Link a repository first
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy || !body.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.launchCodex(
                  pull,
                  pull.head.sha,
                  target.path,
                  target.line,
                  target.side,
                  body,
                );
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Terminal size={15} />
            {busy ? "Opening terminal…" : "Open Codex CLI"}
          </button>
        )}
      </div>
    </Modal>
  );
}
