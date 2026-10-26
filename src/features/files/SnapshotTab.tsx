import { lazy, Suspense, type ReactNode } from "react";
import { History } from "lucide-react";
import type { CodeReference } from "../../../shared/code-references";
import { Loading } from "../../ui/ui";
import { MediaChange } from "./MediaChange";
import { snapshotOf } from "./snapshots";

const SnapshotFile = lazy(() =>
  import("../editor/SnapshotFile").then((m) => ({ default: m.SnapshotFile })),
);

/** A tab showing a version of a file kept in memory; one the window let go says so. */
export function SnapshotTab({
  id,
  lead,
  onAsk,
}: {
  id: string;
  lead?: ReactNode;
  onAsk?: (ref: CodeReference) => void;
}) {
  const snapshot = snapshotOf(id);
  if (!snapshot)
    return (
      <div className="empty project-editor-empty">
        <History size={28} />
        <p>This version isn’t kept any more. Open it again from where you found it.</p>
      </div>
    );
  if ("media" in snapshot)
    return (
      <MediaChange
        lead={lead}
        path={snapshot.path}
        detail={snapshot.label}
        media={snapshot.media}
        sides={snapshot.sides}
      />
    );
  return (
    <div className="files-main">
      <Suspense fallback={<Loading text="Opening editor…" />}>
        <SnapshotFile lead={lead} {...snapshot} onAsk={onAsk} />
      </Suspense>
    </div>
  );
}
