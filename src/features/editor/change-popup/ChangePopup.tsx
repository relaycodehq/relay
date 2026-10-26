import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ArrowDown, ArrowUp, Copy, Diff, SendHorizontal, Undo2, WandSparkles } from "lucide-react";
import { errorMessage } from "../../../../shared/error-message";
import { IconButton, Spinner } from "../../../ui/ui";
import type { CodeRun } from "../hover-card/highlight-runs";
import "./change-popup.css";

export type ChangePopupProps = {
  /** The lines the change took out, coloured; absent when it took none out or they show inline. */
  removed: CodeRun[] | undefined;
  hasPrevious: boolean;
  hasNext: boolean;
  inlineShown: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onRollback: () => void;
  onToggleInline: () => void;
  onCopy: (() => void) | undefined;
  /** Commits only this change; absent when the bars don't compare with the last commit. */
  commit: ((message: string) => Promise<void>) | undefined;
  /** Writes a message for this change. */
  suggest: (() => Promise<string>) | undefined;
  onClose: () => void;
};

/** PhpStorm's change popup: step through the changes, roll one back, or commit just it. */
function ChangePopup(props: ChangePopupProps) {
  const { removed, commit, suggest } = props;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"commit" | "suggest">();
  const [error, setError] = useState<unknown>();

  async function run(kind: "commit" | "suggest", work: () => Promise<void>) {
    setBusy(kind);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  }
  const send = () => {
    if (!commit || !message.trim() || busy) return;
    void run("commit", () => commit(message.trim()));
  };
  const write = () => {
    if (!suggest || busy) return;
    void run("suggest", async () => setMessage(await suggest()));
  };

  return (
    <div
      className="change-popup"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      <div className="change-popup-bar">
        <IconButton label="Previous change" disabled={!props.hasPrevious} onClick={props.onPrevious}>
          <ArrowUp size={14} />
        </IconButton>
        <IconButton label="Next change" disabled={!props.hasNext} onClick={props.onNext}>
          <ArrowDown size={14} />
        </IconButton>
        <IconButton label="Roll back this change" onClick={props.onRollback}>
          <Undo2 size={14} />
        </IconButton>
        <IconButton
          label={props.inlineShown ? "Hide the changes inline" : "Show the changes inline"}
          active={props.inlineShown}
          onClick={props.onToggleInline}
        >
          <Diff size={14} />
        </IconButton>
        {props.onCopy && (
          <IconButton label="Copy the lines it took out" onClick={props.onCopy}>
            <Copy size={14} />
          </IconButton>
        )}
        {commit && (
          <form
            className="change-popup-commit"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <input
              value={message}
              placeholder="Commit this change"
              aria-label="Commit message for this change"
              disabled={busy === "commit"}
              onChange={(event) => setMessage(event.target.value)}
            />
            {suggest && (
              <IconButton label="Write the message" disabled={!!busy} onClick={write}>
                {busy === "suggest" ? <Spinner size={13} /> : <WandSparkles size={14} />}
              </IconButton>
            )}
            <IconButton label="Commit this change" disabled={!message.trim() || !!busy} onClick={send}>
              {busy === "commit" ? <Spinner size={13} /> : <SendHorizontal size={14} />}
            </IconButton>
          </form>
        )}
      </div>
      {error !== undefined && <p className="change-popup-error">{errorMessage(error)}</p>}
      {removed && (
        <pre className="change-popup-removed">
          {removed.map((run, i) => (
            <span key={i} className={run.className}>
              {run.text}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

/**
 * The popup as a tooltip's content, rendered at once: CodeMirror places a
 * tooltip by the size it has when created.
 */
export function mountChangePopup(props: ChangePopupProps) {
  const dom = document.createElement("div");
  const root = createRoot(dom);
  flushSync(() => root.render(createElement(ChangePopup, props)));
  return { dom, destroy: () => root.unmount() };
}
