import { useState } from "react";
import { Check, ClipboardPaste, Copy, X } from "lucide-react";
import type { PastedText } from "../../../shared/pasted-texts";
import { Modal } from "../../ui/ui";
import "./pasted-texts.css";
import { useCopy } from "../../lib/useCopy";
import { pastePill, PillButton } from "./prompt/Pill";

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
  const [copied, copy] = useCopy();
  const { label, detail: lines } = pastePill(paste);
  return (
    <Modal title={label} onClose={onClose} className="pasted-text-dialog">
      <p className="pasted-text-meta">
        {lines} · {paste.text.length.toLocaleString()} characters
      </p>
      <pre className="pasted-text-full">{paste.text}</pre>
      <div className="modal-actions">
        <button type="button" onClick={() => copy(paste.text)}>
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
  const { label, detail: lines } = pastePill(paste);
  return (
    <div className="pasted-text">
      <button
        type="button"
        className="pasted-text-open"
        aria-label={`Show ${label}, ${lines}`}
        title="Show pasted text"
        onClick={onOpen}
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
      <button
        type="button"
        className="composer-image-remove"
        aria-label={`Remove ${label}`}
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
  const look = pastePill(paste);
  return (
    <>
      <PillButton
        look={look}
        aria-label={`Show ${look.label}, ${look.detail}`}
        onClick={() => setOpen(true)}
      />
      {open && (
        <PastedTextDialog paste={paste} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
