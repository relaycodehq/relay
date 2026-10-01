import type { ProjectFileLink } from "../../shared/project-file-links";

/** A file for the Files pane to open. */
export type FileTarget = ProjectFileLink & {
  /** Lists the files matching this instead of opening one. */
  search?: string;
};
