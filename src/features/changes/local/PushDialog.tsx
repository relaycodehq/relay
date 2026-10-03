import type { WorkingTree } from "../../../../shared/working-tree";
import { ErrorBox, Modal } from "../../../ui/ui";

/** Confirms pushing the branch, listing the commits that go out. */
export function PushDialog({
  tree,
  busy,
  error,
  onPush,
  onClose,
}: {
  tree: WorkingTree;
  busy: boolean;
  error: unknown;
  onPush: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Push commits" onClose={onClose}>
      <p>
        Push <strong>{tree.branch}</strong> to{" "}
        <strong>{tree.pushTarget}</strong>.
      </p>
      <p className="muted">
        <code>{tree.pushUrl}</code>
      </p>
      <p className="muted">
        Only commits are published. Uncommitted changes aren’t pushed
        {tree.upstream
          ? ". Counts reflect the last Git fetch."
          : ". This sets the branch’s upstream."}
      </p>
      {tree.outgoing.length > 0 && (
        <ul className="outgoing-commits">
          {tree.outgoing.map((c) => (
            <li key={c.sha}>
              <code>{c.sha.slice(0, 7)}</code> {c.subject}
            </li>
          ))}
        </ul>
      )}
      {!!error && <ErrorBox error={error} />}
      <button className="primary" disabled={busy} onClick={onPush}>
        {busy ? "Pushing…" : `Push to ${tree.pushTarget}`}
      </button>
    </Modal>
  );
}
