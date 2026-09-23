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

const label = (paste: PastedText) => `Pasted text #${paste.n}`;
function lineCount(paste: PastedText) {
  const count = pastedLines(paste.text);
  return `${count.toLocaleString()} ${count === 1 ? "line" : "lines"}`;
}

/** The whole paste, to read, copy or turn back into ordinary text. */
export function PastedTextDialog({
  paste,
  onClose,
  onInline,
}: {
  paste: PastedText;
  onClose: () => void;
  /** Swaps the pill for the paste's text. */
  onInline?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={label(paste)} onClose={onClose} className="pasted-text-dialog">
      <p className="pasted-text-meta">
        {lineCount(paste)} · {paste.text.length.toLocaleString()} characters
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
              onClose();
              onInline();
            }}
          >
            Insert as text
          </button>
        )}
      </div>
    </Modal>
  );
}

/** A long paste shown beside screenshots, opening to the full text. */
export function PastedTextCard({
  paste,
  onOpen,
  onRemove,
}: {
  paste: PastedText;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="pasted-text">
      <button
        type="button"
        className="pasted-text-open"
        aria-label={`Show ${label(paste)}, ${lineCount(paste)}`}
        title="Show pasted text"
        onClick={onOpen}
      >
        <span className="pasted-text-preview" aria-hidden="true">
          {preview(paste.text)}
        </span>
        <span className="pasted-text-footer">
          <span className="pasted-text-pill">
            <ClipboardPaste size={11} aria-hidden="true" />
            {label(paste)}
          </span>
          <span className="pasted-text-lines">{lineCount(paste)}</span>
        </span>
      </button>
      <button
        type="button"
        className="composer-image-remove"
        aria-label={`Remove ${label(paste)}`}
        onClick={onRemove}
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** The pill a sent message shows where the paste went, like the composer's. */
export function PastedTextPill({ paste }: { paste: PastedText }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="paste-pill"
        aria-label={`Show ${label(paste)}, ${lineCount(paste)}`}
        title="Show pasted text"
        onClick={() => setOpen(true)}
      >
        <span className="paste-pill-icon" aria-hidden="true" />
        {label(paste)}
        <span className="paste-pill-lines">{lineCount(paste)}</span>
      </button>
      {open && (
        <PastedTextDialog paste={paste} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
