import { useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../../shared/projects";
import {
  copiedNote,
  setupCanRerun,
  worktreeCommandNote,
} from "../../../shared/worktree-command";
import { ErrorBox } from "../../ui/ui";

/**
 * The line where the project's setup or teardown command ran in the thread's
 * worktree, with its output behind a toggle and, on the thread's latest setup
 * that didn't get through, a way to run it again.
 */
export function WorktreeCommandRow({
  message: m,
  onRerun,
}: {
  message: ChatMessage;
  /** Only on the thread's latest setup run. */
  onRerun?: () => Promise<void>;
}) {
  const run = m.worktreeCommand!;
  const [open, setOpen] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<unknown>();
  const output = useRef<HTMLPreElement>(null);
  const text = [run.copied?.length ? copiedNote(run.copied) : "", run.output]
    .filter(Boolean)
    .join("\n\n");
  // Kept at the end while it grows, like a terminal.
  useLayoutEffect(() => {
    const pre = output.current;
    if (pre && m.status === "streaming") pre.scrollTop = pre.scrollHeight;
  }, [text, m.status]);
  const rerun =
    onRerun && setupCanRerun(m)
      ? async () => {
          setRerunning(true);
          setError(undefined);
          try {
            await onRerun();
          } catch (e) {
            setError(e);
          } finally {
            setRerunning(false);
          }
        }
      : undefined;
  return (
    <div
      className="agent-handoff worktree-command"
      data-message-id={m.id}
      data-status={m.status}
      role="status"
    >
      <div
        className="context-compaction"
        data-status={m.status === "cancelled" ? "failed" : m.status}
      >
        <span title={run.command}>{worktreeCommandNote(run, m.status)}</span>
        {!!text && (
          <button
            type="button"
            className="text-button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide output" : "Show output"}
          </button>
        )}
        {rerun && (
          <button
            type="button"
            className="text-button"
            disabled={rerunning}
            onClick={() => void rerun()}
          >
            Run setup again
          </button>
        )}
      </div>
      {open && !!text && (
        <pre
          ref={output}
          className="worktree-command-output"
          aria-label={`${run.kind === "setup" ? "Setup" : "Teardown"} output`}
        >
          <span className="worktree-command-line">$ {run.command}</span>
          {"\n"}
          {text}
        </pre>
      )}
      {!!error && <ErrorBox error={error} />}
    </div>
  );
}
