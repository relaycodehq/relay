import type { Extension } from "@codemirror/state";
import { api } from "../../lib/api";
import { ErrorBox, Loading, Modal } from "../../ui/ui";
import { HistoryCompare } from "./HistoryCompare";
import { HistoryList } from "./HistoryList";
import { useHistoryVersions } from "./useHistoryVersions";
import "./local-history.css";

/**
 * The versions Relay kept of a file, newest first by day, and the selected one
 * against the current text. Reverting hands the version's text to the host to
 * put in its buffer, so the change can be undone; before that the text being
 * replaced is kept as a version too.
 */
export function LocalHistory({
  where,
  path,
  current,
  extensions,
  onRevert,
  onClose,
}: {
  where: string;
  path: string;
  /** The buffer as it is now, saved or not. */
  current: string;
  /** The host's editor theme and highlighting for the comparison. */
  extensions?: Extension;
  onRevert(contents: string): void;
  onClose(): void;
}) {
  const { entries, error, selected, selectedText, selectedError, select } =
    useHistoryVersions(where, path, current);

  async function revert() {
    if (selectedText === undefined) return;
    // The buffer may hold edits never saved; once replaced they exist only here.
    await api
      .localHistoryRecord(where, path, current, "before-revert")
      .catch((e) =>
        console.warn("Local History could not keep the buffer:", e),
      );
    onRevert(selectedText);
    onClose();
  }

  function content() {
    if (error) return <ErrorBox error={error} />;
    if (!entries) return <Loading />;
    if (!entries.length)
      return (
        <p className="lh-empty">
          Nothing kept for this file yet. Relay keeps a version each time you
          save it, when it changes on disk, and when an agent edits it.
        </p>
      );
    return (
      <div className="lh-body">
        <HistoryList
          entries={entries}
          selectedId={selected?.id}
          onSelect={select}
        />
        {selectedError ? (
          <ErrorBox error={selectedError} />
        ) : (
          <HistoryCompare
            path={path}
            entry={selected}
            versionText={selectedText}
            current={current}
            extensions={extensions}
            onRevert={() => void revert()}
          />
        )}
      </div>
    );
  }

  return (
    <Modal title="Local History" onClose={onClose} className="local-history">
      <p className="lh-path">{path}</p>
      {content()}
    </Modal>
  );
}
