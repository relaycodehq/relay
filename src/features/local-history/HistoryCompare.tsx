import { useState } from "react";
import type { Extension } from "@codemirror/state";
import type { LocalHistoryEntry } from "../../../shared/local-history";
import { useCopy } from "../../lib/useCopy";
import { Loading } from "../../ui/ui";
import { HistoryDiff } from "./HistoryDiff";
import { timeText } from "./history-days";

/** The selected version against the current text, with Copy and Revert. */
export function HistoryCompare({
  path,
  entry,
  versionText,
  current,
  extensions,
  onRevert,
}: {
  path: string;
  entry?: LocalHistoryEntry;
  /** Undefined until the version's text has been read. */
  versionText?: string;
  current: string;
  extensions?: Extension;
  onRevert(): void;
}) {
  const [whole, setWhole] = useState(false);
  const [copied, copy] = useCopy();
  const matchesCurrent = versionText === current;
  const tooLarge = entry?.skipped === true;

  return (
    <section className="lh-compare">
      <div className="lh-bar">
        <label className="lh-whole">
          <input
            type="checkbox"
            checked={whole}
            onChange={(e) => setWhole(e.target.checked)}
          />
          Whole file
        </label>
        <button
          type="button"
          disabled={versionText === undefined}
          onClick={() => versionText !== undefined && copy(versionText)}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="primary"
          disabled={versionText === undefined || matchesCurrent}
          onClick={onRevert}
        >
          Revert
        </button>
      </div>
      <div className="lh-sides">
        <span>
          {entry
            ? `${timeText(entry.time)}${entry.label ? ` · ${entry.label}` : ""}`
            : ""}
        </span>
        <span>Current</span>
      </div>
      {tooLarge && (
        <p className="lh-empty">
          This version was over the size Relay keeps, so only its time and size
          were noted.
        </p>
      )}
      {!tooLarge && versionText === undefined && <Loading />}
      {!tooLarge && versionText !== undefined && (
        <>
          {matchesCurrent && (
            <p className="lh-same">Same as the current text.</p>
          )}
          <HistoryDiff
            path={path}
            version={versionText}
            current={current}
            whole={whole}
            extensions={extensions}
          />
        </>
      )}
    </section>
  );
}
