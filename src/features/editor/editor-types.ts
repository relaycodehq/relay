import type { ReactNode } from "react";
import type { CodeReference } from "../../../shared/code-references";
import type { ChangeBaseline } from "../../../shared/editor-windows";
import type { Pull } from "../../../shared/types";
import type { ChecksController } from "../checks/useProjectChecks";
import type { FileDocument } from "./documents";
import type { SymbolActions } from "./keymap";

/** Whose blame and symbols an editor shows: a project's folder at HEAD, or a PR. */
export type EditorTarget = Pull | { projectId: string; head: { sha: string } };

export type { ChangeBaseline };

/** Where a symbol lookup or link leads, 1-based: a file of the same folder, or outside it by absolute path. */
export type OpenTarget = {
  path: string;
  line?: number;
  column?: number;
  outside?: boolean;
};

/** The searches across the project that the host offers, bound to the editor's keys. */
export type HostSearches = Pick<
  SymbolActions,
  | "searchEverywhere"
  | "goToFile"
  | "goToSymbol"
  | "recentFiles"
  | "findInFiles"
  | "replaceInFiles"
>;

export type FileEditorProps = {
  doc: FileDocument;
  target: EditorTarget;
  checks: ChecksController;
  /** In the Files pane rather than a modal of its own. */
  inline?: boolean;
  /** What the bar shows instead of the path, like a file's full path outside the project. */
  shownPath?: string;
  /** Before the path in the inline bar. */
  lead?: ReactNode;
  /** Extra buttons in the inline bar, after the editing controls. */
  actions?: ReactNode;
  /** Changes when the file may have changed on disk, like the working tree's revision. */
  stamp?: string;
  /** Opens a file or folder a Markdown preview links to. */
  onOpenLink?: (target: { path: string; directory: boolean }) => void;
  /** Opens another file of the same folder, as a definition does. */
  onOpenFile?: (target: OpenTarget) => void;
  /** Back and Forward through the places jumps left from; they return true when there was one. */
  onBack?: () => boolean;
  onForward?: () => boolean;
  host?: HostSearches;
  /** Attaches the selected lines to the thread's composer. */
  onAsk?: (ref: CodeReference) => void;
  /** A new value asks to close, as a tab's × does; unsaved edits ask first. */
  closeRequest?: number;
  /** Called once any unsaved edits have been saved or let go. */
  onClose: () => void;
};
