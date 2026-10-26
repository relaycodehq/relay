import { lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CodeReference } from "../../../shared/code-references";
import type { ChangeArea } from "../../../shared/working-tree";
import { api } from "../../lib/api";
import { ErrorBox, Loading } from "../../ui/ui";
import { sideLabels } from "../changes/working-changes";
import { MediaChange, mediaOf } from "./MediaChange";

const DeletedFile = lazy(() =>
  import("../editor/DeletedFile").then((m) => ({ default: m.DeletedFile })),
);

/** A tab whose file is deleted here: the version before, and Restore. */
export function DeletedView({
  where,
  path,
  area,
  lead,
  restoring,
  error,
  onRestore,
  onAsk,
}: {
  where: string;
  path: string;
  area: ChangeArea;
  lead?: ReactNode;
  restoring: boolean;
  error?: unknown;
  onRestore: () => void;
  onAsk?: (ref: CodeReference) => void;
}) {
  const before = useQuery({
    queryKey: ["deleted-file", where, path, area],
    queryFn: () => api.projectWorkingDiff(where, path, area),
    gcTime: 0,
  });
  if (before.error) return <ErrorBox error={before.error} />;
  if (!before.data) return <Loading text="Reading the last version…" />;
  const restoreButton = (
    <button className="editor-save" disabled={restoring} onClick={onRestore}>
      Restore
    </button>
  );
  // A picture or video shows as one; other binary files have no text to show.
  const media = mediaOf(before.data);
  if (media)
    return (
      <div className="files-main">
        {!!error && <ErrorBox error={error} />}
        <MediaChange
          lead={lead}
          path={path}
          media={media}
          sides={sideLabels(area)}
        >
          {restoreButton}
        </MediaChange>
      </div>
    );
  if (before.data.binary)
    return (
      <div className="files-main">
        {!!error && <ErrorBox error={error} />}
        <div className="empty">
          <p>
            {path} was deleted. It's a binary file, so there's no text to show.
          </p>
          {restoreButton}
        </div>
      </div>
    );
  return (
    <div className="files-main">
      {!!error && <ErrorBox error={error} />}
      <Suspense fallback={<Loading text="Opening editor…" />}>
        <DeletedFile
          lead={lead}
          path={path}
          text={before.data.old?.contents ?? ""}
          label={sideLabels(area).deletions}
          restoring={restoring}
          onRestore={onRestore}
          onAsk={onAsk}
        />
      </Suspense>
    </div>
  );
}
