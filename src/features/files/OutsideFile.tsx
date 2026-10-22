import { useMemo, type ReactNode } from "react";
import { splitOutsidePath } from "../../../shared/project-file-links";
import type { ChecksController } from "../checks/useProjectChecks";
import { FileViewer } from "./FileViewer";

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
  // The project's checker would take this file for one of its own by name.
  const noChecks = useMemo<ChecksController>(
    () => ({ ...checks, enabled: false, state: undefined, buffer: noBuffer }),
    [checks],
  );
  return (
    <FileViewer
      active={active}
      where={folder}
      path={name}
      shownPath={path}
      lead={lead}
      editorKey={`${path}:${line ?? ""}`}
      editor={{
        project: { id: folder, head: "", plain: true },
        checks: noChecks,
        line,
        onOpenLink: (target) => {
          if (!target.directory)
            onOpen(`${folder.replace(/[/\\]$/, "")}/${target.path}`);
        },
        onClose,
      }}
    />
  );
}
