import { useState } from "react";
import { Check, ClipboardPaste, Copy, X } from "lucide-react";
import { pastedLines, type PastedText } from "../../shared/pasted-texts";
import { Modal } from "./ui";
import "./pasted-texts.css";

/** The opening lines, dedented so pasted code does not preview as indent. */
function preview(text: string) {
  const lines = text.split("\n", 7).map((line) => line.replace(/\t/g, "  "));
  const indent = Math.min(
    ...lines
      .filter((line) => line.trim())
      .map((line) => line.length - line.trimStart().length),
  );
  return lines.map((line) => line.slice(indent, indent + 90)).join("\n");
}

/** A long paste shown beside screenshots, opening to the full text. */
export function PastedTextCard({
  paste,
  onRemove,
  onInline,
}: {
  paste: PastedText;
  onRemove?: () => void;
  /** Moves the paste back into the message as ordinary text. */
  onInline?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const label = `Pasted text #${paste.n}`;
  const count = pastedLines(paste.text);
  const lines = `${count.toLocaleString()} ${count === 1 ? "line" : "lines"}`;
  return (
    <div className="pasted-text">
      <button
        type="button"
        className="pasted-text-open"
        aria-label={`Show ${label}, ${lines}`}
        title="Show pasted text"
        onClick={() => {
          setCopied(false);
          setOpen(true);
        }}
      >
        <span className="pasted-text-preview" aria-hidden="true">
          {preview(paste.text)}
        </span>
        <span className="pasted-text-footer">
          <span className="pasted-text-pill">
            <ClipboardPaste size={11} aria-hidden="true" />
            {label}
          </span>
          <span className="pasted-text-lines">{lines}</span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          className="composer-image-remove"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <X size={13} />
        </button>
      )}
      {open && (
        <Modal
          title={label}
          onClose={() => setOpen(false)}
          className="pasted-text-dialog"
        >
          <p className="pasted-text-meta">
            {lines} · {paste.text.length.toLocaleString()} characters
          </p>
          <pre className="pasted-text-full">{paste.text}</pre>
          <div className="modal-actions">
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(paste.text)
                  .then(() => setCopied(true))
              }
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
            {onInline && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setOpen(false);
                  onInline();
                }}
              >
                Insert as text
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
