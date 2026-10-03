import { useState } from "react";
import { ChevronDown, FileCode2, FileDiff, X } from "lucide-react";
import {
  codeReferenceLines,
  type CodeReference,
} from "../../../shared/code-references";
import "./code-references.css";

/** Attached code lines, shown as a pill that expands to a preview. */
function CodeReferenceChip({
  reference: ref,
  onRemove,
  onOpen,
}: {
  reference: CodeReference;
  onRemove?: () => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const name = ref.path.split("/").pop() || ref.path;
  return (
    <div className={`code-ref ${open ? "open" : ""}`}>
      <div className="code-ref-chip">
        <button
          type="button"
          className="code-ref-toggle"
          aria-expanded={open}
          title={`${ref.path}:${codeReferenceLines(ref)} · ${ref.label}`}
          onClick={() => setOpen(!open)}
        >
          <FileCode2 size={13} />
          <span className="code-ref-name">{name}</span>
          <span className="code-ref-lines">:{codeReferenceLines(ref)}</span>
          <span className="code-ref-label">{ref.label}</span>
          <ChevronDown size={12} className="code-ref-caret" />
        </button>
        {/* Like a file link in the chat, this goes to its diff in Changes. */}
        {onOpen && (
          <button
            type="button"
            aria-label={`Show ${ref.path} in Changes`}
            title="Show in Changes"
            onClick={onOpen}
          >
            <FileDiff size={12} />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove ${name}:${codeReferenceLines(ref)}`}
            title="Remove"
            onClick={onRemove}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="code-ref-preview">
          <div className="code-ref-path">{ref.path}</div>
          <pre>
            {ref.code.split("\n").map((line, i) => (
              <div key={i}>
                <span>{ref.start + i}</span>
                <code>{line || " "}</code>
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

export function CodeReferenceList({
  references,
  onRemove,
  onOpen,
}: {
  references: CodeReference[];
  onRemove?: (index: number) => void;
  onOpen?: (ref: CodeReference) => void;
}) {
  return (
    <div className="code-refs" aria-label="Referenced code">
      {references.map((ref, i) => (
        <CodeReferenceChip
          key={`${ref.path}:${ref.start}:${ref.end}:${ref.label}:${i}`}
          reference={ref}
          onRemove={onRemove && (() => onRemove(i))}
          onOpen={onOpen && (() => onOpen(ref))}
        />
      ))}
    </div>
  );
}
