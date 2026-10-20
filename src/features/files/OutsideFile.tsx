import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2 } from "lucide-react";
import { splitOutsidePath } from "../../../shared/project-file-links";
import { api } from "../../lib/api";
import type { ChecksController } from "../checks/useProjectChecks";
import { ErrorBox, Loading } from "../../ui/ui";
import {
  FileBar,
  ImageFile,
  OtherFile,
  RevealButtons,
  VideoFile,
} from "./FileViews";
const LocalFileEditor = lazy(() => import("./editor/LocalFileEditor"));

const noBuffer = async () => {};

/**
 * A file outside the project that an answer named, like a draft in /tmp.
 * Its own folder stands in for a plain project: editable, but no Git, and
 * none of the project's checks.
 */
export function OutsideFile({
  active,
  path,
  line,
  checks,
  lead,
  onOpen,
  onClose,
}: {
  active: boolean;
  /** Absolute, or from `~`. */
  path: string;
  line?: number;
  checks: ChecksController;
  lead?: ReactNode;
  /** Opens another file outside the project, by its absolute path. */
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const { folder, name } = splitOutsidePath(path);
  const info = useQuery({
    queryKey: ["project-file-info", folder, name],
    queryFn: () => api.projectFileInfo(folder, name),
    enabled: active,
    staleTime: 0,
    retry: false,
    refetchInterval: (q) => (q.state.data?.kind === "text" ? false : 3000),
  });
  // The project's checker would take this file for one of its own by name.
  const noChecks = useMemo<ChecksController>(
    () => ({ ...checks, enabled: false, state: undefined, buffer: noBuffer }),
    [checks],
  );
  const [actionError, setActionError] = useState<unknown>();
  if (info.error)
    return (
      <div className="files-main">
        <FileBar lead={lead} path={path} />
        <div className="empty project-editor-empty">
          <FileCode2 size={28} />
          <h2>Can’t open this file</h2>
          <ErrorBox error={info.error} />
        </div>
      </div>
    );
  if (!info.data) return <Loading text="Opening…" />;
  if (info.data.kind === "image")
    return (
      <ImageFile
        active={active}
        where={folder}
        info={info.data}
        lead={lead}
        shownPath={path}
      />
    );
  if (info.data.kind === "video")
    return (
      <VideoFile
        active={active}
        where={folder}
        info={info.data}
        lead={lead}
        shownPath={path}
      />
    );
  if (info.data.kind === "other")
    return (
      <OtherFile where={folder} info={info.data} lead={lead} shownPath={path} />
    );
  return (
    <div className="files-main">
      {!!actionError && <ErrorBox error={actionError} />}
      <Suspense fallback={<Loading text="Opening editor…" />}>
        <LocalFileEditor
          key={`${path}:${line ?? ""}`}
          project={{ id: folder, head: "", plain: true }}
          checks={noChecks}
          path={name}
          shownPath={path}
          line={line}
          onOpenLink={(target) => {
            if (!target.directory)
              onOpen(`${folder.replace(/[/\\]$/, "")}/${target.path}`);
          }}
          inline
          lead={lead}
          actions={
            <RevealButtons
              where={folder}
              path={name}
              external
              onError={setActionError}
            />
          }
          onClose={onClose}
        />
      </Suspense>
    </div>
  );
}
