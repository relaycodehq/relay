import { useMemo, type ReactNode } from "react";
import { splitOutsidePath } from "../../../shared/project-file-links";
import type { ChecksController } from "../checks/useProjectChecks";
import type { Reveal } from "../editor/TextFile";
import { FileViewer } from "./FileViewer";

const noBuffer = async () => {};

/** Where a file outside the project is read from: its own folder, as a plain one. */
export function outsideSource(path: string) {
  const { folder, name } = splitOutsidePath(path);
  return {
    source: { kind: "project" as const, where: folder, plain: true },
    name,
  };
}

/**
 * A file outside the project that an answer named, like a draft in /tmp.
 * Its own folder stands in for a plain project: editable, but no Git, and
 * none of the project's checks.
 */
export function OutsideFile({
  active,
  path,
  reveal,
  checks,
  lead,
  onOpen,
  onClose,
}: {
  active: boolean;
  /** Absolute, or from `~`. */
  path: string;
  reveal?: Reveal;
  checks: ChecksController;
  lead?: ReactNode;
  /** Opens another file outside the project, by its absolute path. */
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const { source, name } = outsideSource(path);
  // The project's checker would take this file for one of its own by name.
  const noChecks = useMemo<ChecksController>(
    () => ({ ...checks, enabled: false, state: undefined, buffer: noBuffer }),
    [checks],
  );
  return (
    <FileViewer
      active={active}
      where={source.where}
      path={name}
      shownPath={path}
      lead={lead}
      editor={{
        source,
        target: { projectId: source.where, head: { sha: "" } },
        checks: noChecks,
        reveal,
        onOpenLink: (target) => {
          if (!target.directory)
            onOpen(`${source.where.replace(/[/\\]$/, "")}/${target.path}`);
        },
        onClose,
      }}
    />
  );
}
