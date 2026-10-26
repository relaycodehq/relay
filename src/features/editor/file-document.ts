import {
  Annotation,
  EditorState,
  Transaction,
  type ChangeSet,
  type ChangeSpec,
  Text,
  type Extension,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ChangeBaseline } from "../../../shared/editor-windows";
import type { LocalFile, Pull } from "../../../shared/types";
import { api } from "../../lib/api";
import { lineBreakOf, minimalChange } from "./text-changes";

/** Marks a change copied from another view of the same document, so it is not copied back. */
const mirrored = Annotation.define<boolean>();

/**
 * Where a file is read from and saved to: a project's folder (the checkout,
 * a worktree, or a folder outside any project), or a PR's linked checkout.
 * `plain` is a folder without Git, so nothing committed to compare with.
 */
export type DocumentSource =
  | { kind: "project"; where: string; plain?: boolean }
  | { kind: "pull"; pull: Pull };

export type DocumentStatus = {
  loading: boolean;
  error?: unknown;
  /** A PR's repository isn't linked to a local folder yet. */
  needsFolder: boolean;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  /** The file changed on disk under unsaved edits. */
  changedOnDisk: boolean;
};

export const keyOf = (source: DocumentSource, path: string) =>
  source.kind === "project"
    ? `project\0${source.where}\0${path}`
    : `pull\0${source.pull.owner}/${source.pull.name}\0${source.pull.number}\0${path}`;

/**
 * One open file: its CodeMirror state (text, undo history, carets), the
 * version on disk it was read at, and saving over that version. It outlives
 * the views that show it, so a tab keeps its edits and undo history while
 * another tab is in front.
 *
 * `check` looks at the disk again (on window focus and when the working tree
 * changes). A buffer without edits takes the new text as an undoable step; an
 * edited one is marked `changedOnDisk`.
 */
export class FileDocument {
  key: string;
  state: EditorState | undefined;
  /** The file as last read: the committed text, HEAD and branch with it. */
  file: LocalFile | undefined;

  status: DocumentStatus = {
    loading: true,
    needsFolder: false,
    dirty: false,
    saving: false,
    saved: false,
    changedOnDisk: false,
  };

  /** Where the view that last showed it was scrolled to. */
  scroll: { top: number; left: number } | undefined;
  /** Where to put the caret (1-based) once a view shows the document. */
  pendingReveal: { line: number; column?: number } | undefined;
  /** Moves the caret in the view that shows the document. Set while a view shows it. */
  revealInView: ((line: number, column?: number) => void) | undefined;
  /**
   * True or false to show the changes inline (or not) whatever the editor-wide
   * setting says, as a file opened from the changes list does. Undefined to
   * follow the editor-wide setting.
   */
  comparing: boolean | undefined;
  /** What the changes are shown against instead of the last commit, until dropped. */
  comparedWith: ChangeBaseline | undefined;
  private baseline = Text.empty;
  private version = "";
  private generation = 0;
  private checking = false;
  private listeners = new Set<() => void>();
  private stateListeners = new Set<(state: EditorState) => void>();
  private disposers = new Set<() => void>();
  /** The views showing it. The first one owns the document's state. */
  private views: EditorView[] = [];
  private config: Extension = [];
  private savers = new Set<() => void>();
  private live = true;
  /** Applies an edit through the first view, which owns the state while it is attached. */
  dispatchToView:
    | ((tr: { changes: ChangeSet | ChangeSpec; userEvent: string }) => void)
    | undefined;

  constructor(
    readonly source: DocumentSource,
    public path: string,
    /** Builds a fresh state's extensions for this file's text. */
    private extensions: (text: string) => Extension,
  ) {
    this.key = keyOf(source, path);
    void this.load();
  }

  /** Called when the status or the file changes, not on each keystroke. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Runs when the document is disposed. */
  onDispose(listener: () => void) {
    this.disposers.add(listener);
  }

  /** Runs after each save lands on disk. */
  onSave(listener: () => void) {
    this.savers.add(listener);
    return () => void this.savers.delete(listener);
  }

  /** Called with every new state, keystrokes included, for whatever reads the text live. */
  onState(listener: (state: EditorState) => void) {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  }

  private set(next: Partial<DocumentStatus>) {
    const before = this.status;
    const status = { ...before, ...next };
    if (Object.entries(status).every(([k, v]) => before[k as keyof DocumentStatus] === v))
      return;
    this.status = status;
    for (const listener of this.listeners) listener();
  }

  private notify() {
    this.status = { ...this.status };
    for (const listener of this.listeners) listener();
  }

  /** The text being edited. */
  text() {
    return this.state?.sliceDoc() ?? this.file?.contents ?? "";
  }

  /** Keeps the state a view's transaction produced, and whether it now differs from disk. */
  update(tr: Transaction) {
    this.state = tr.state;
    if (tr.docChanged) {
      const dirty = !tr.state.doc.eq(this.baseline);
      this.set({ dirty, ...(dirty ? { saved: false } : {}) });
    }
    for (const listener of this.stateListeners) listener(tr.state);
  }

  private read() {
    const { source, path } = this;
    if (source.kind === "project") return api.projectFile(source.where, path);
    return api.readLocalFile(source.pull, source.pull.head.sha, path);
  }

  /** Takes in a read of the file: it becomes the state the first time, and an edit after that. */
  private take(file: LocalFile) {
    const committedMoved =
      this.file && (this.file.original !== file.original || this.file.head !== file.head);
    this.file = file;
    this.version = file.version;
    if (!this.state) {
      this.config = [
        EditorState.lineSeparator.of(lineBreakOf(file.contents)),
        this.extensions(file.contents),
      ];
      this.state = EditorState.create({ doc: file.contents, extensions: this.config });
    } else if (this.state.sliceDoc() !== file.contents) {
      // Record text written by something else (an agent, another editor) in
      // local history before the buffer replaces it.
      if (this.source.kind === "project")
        void api
          .localHistoryRecord(this.source.where, this.path, file.contents, "external")
          .catch(() => {});
      const changes = minimalChange(this.state, file.contents);
      if (this.dispatchToView) this.dispatchToView({ changes, userEvent: "reload" });
      else {
        this.state = this.state.update({ changes, userEvent: "reload" }).state;
        for (const listener of this.stateListeners) listener(this.state);
      }
    }
    this.baseline = this.state.doc;
    this.set({ dirty: false, saved: false, changedOnDisk: false });
    if (committedMoved) this.notify();
  }

  /** Reads the file (again) and drops unsaved edits. */
  async load(link = false) {
    const generation = ++this.generation;
    const current = () => this.live && generation === this.generation;
    this.set({ loading: true, error: undefined });
    try {
      if (this.source.kind === "pull") {
        const folder = link
          ? await api.linkFolder(this.source.pull)
          : await api.folder(this.source.pull);
        if (!current()) return;
        if (!folder) return this.set({ needsFolder: true });
        this.set({ needsFolder: false });
      }
      const file = await this.read();
      if (!current()) return;
      this.take(file);
    } catch (error) {
      if (current()) this.set({ error });
    } finally {
      if (current()) this.set({ loading: false });
    }
  }

  /**
   * The version on disk the edits are made over, as read or last saved; a
   * save over any other is refused. Undefined until the file has been read.
   */
  get diskVersion() {
    return this.file ? this.version : undefined;
  }

  /**
   * Takes unsaved text carried over from another window as an edit, so the
   * document is dirty and the step can be undone. The file must be read first.
   * `editedOver` is the version on disk the text was edited over there: if the
   * file has changed since, saving is refused here as it would have been there.
   */
  adopt(text: string, editedOver?: string) {
    if (!this.state || this.state.sliceDoc() === text) return;
    const changes = minimalChange(this.state, text);
    if (this.dispatchToView) this.dispatchToView({ changes, userEvent: "input.adopt" });
    else this.update(this.state.update({ changes, userEvent: "input.adopt" }));
    if (editedOver === undefined || editedOver === this.version) return;
    this.version = editedOver;
    this.set({ changedOnDisk: true });
  }

  /**
   * Keeps unsaved text carried over from another window when the file can't
   * be read here (it was deleted, say), so the edits aren't lost with it.
   * With nothing read, there is no version on disk to save over.
   */
  keepUnread(text: string) {
    if (this.state) return;
    this.config = [EditorState.lineSeparator.of(lineBreakOf(text)), this.extensions(text)];
    this.state = EditorState.create({ doc: text, extensions: this.config });
    this.set({ dirty: true });
  }

  /** Looks at the disk. A change is taken without asking when there are no edits to lose. */
  async check() {
    if (!this.file || this.status.loading || this.status.saving || this.checking) return;
    this.checking = true;
    const generation = this.generation;
    try {
      const file = await this.read();
      if (!this.live || generation !== this.generation || this.status.saving) return;
      const textUnchanged = file.version === this.version;
      if (textUnchanged) {
        // HEAD may have moved under the same text, so the change bars and
        // blame need the new committed version.
        if (file.head !== this.file.head || file.original !== this.file.original) {
          this.takeCommittedVersion(file);
          this.notify();
        }
        this.set({ changedOnDisk: false });
      } else if (this.status.dirty) {
        this.takeCommittedVersion(file);
        this.set({ changedOnDisk: true });
        this.notify();
      } else this.take(file);
    } catch {
      // The file is gone or unreadable. Saving will report that, and the edits stay in the buffer.
    } finally {
      this.checking = false;
    }
  }

  /** Keeps the buffer's text and takes only the committed version, HEAD and branch from a fresh read. */
  private takeCommittedVersion(file: LocalFile) {
    if (!this.file) return;
    this.file = { ...this.file, head: file.head, original: file.original, branch: file.branch };
  }

  /** Writes the text over the version it was read at. Returns true once saved. */
  async save() {
    if (!this.file || !this.state || this.status.saving || this.status.loading) return false;
    if (!this.status.dirty) return true;
    this.set({ saving: true, error: undefined });
    // A read still on its way is of the file before this save.
    this.generation++;
    const doc = this.state.doc;
    const contents = this.state.sliceDoc();
    const { source, path } = this;
    try {
      const result =
        source.kind === "project"
          ? await api.saveProjectFile(
              source.where,
              path,
              this.file.head,
              this.version,
              contents,
            )
          : await api.saveLocalFile(
              source.pull,
              source.pull.head.sha,
              path,
              this.version,
              contents,
            );
      if (!this.live) return false;
      this.version = result.version;
      this.baseline = doc;
      this.file = { ...this.file, contents, version: result.version };
      this.set({
        dirty: !this.state.doc.eq(doc),
        changedOnDisk: false,
        saved: true,
      });
      for (const listener of this.savers) listener();
      return true;
    } catch (error) {
      if (this.live) this.set({ error });
      return false;
    } finally {
      if (this.live) this.set({ saving: false });
    }
  }

  /**
   * Shows the document in `view`. The first view takes the document's own
   * state, undo history included. Another view of the same file (a second
   * split) gets a state of its own over the same text, and every edit in one
   * view is copied to the others.
   */
  attach(view: EditorView) {
    if (!this.state || this.views.includes(view)) return;
    const primary = this.views[0];
    view.setState(
      primary
        ? EditorState.create({ doc: primary.state.doc, extensions: this.config })
        : this.state,
    );
    this.views.push(view);
    this.dispatchToView = (spec) => this.views[0].dispatch(spec);
  }

  /** `view` stops showing the document. When the first view leaves, the document keeps its state. */
  detach(view: EditorView) {
    const at = this.views.indexOf(view);
    if (at < 0) return;
    this.views.splice(at, 1);
    if (at === 0) this.state = this.views[0]?.state ?? view.state;
    if (!this.views.length) this.dispatchToView = undefined;
  }

  /** Keeps the first view's state and copies each edit to the other views. */
  viewUpdated(view: EditorView, trs: readonly Transaction[]) {
    const primary = view === this.views[0];
    for (const tr of trs) {
      if (primary) this.update(tr);
      if (!tr.docChanged || tr.annotation(mirrored)) continue;
      for (const other of this.views)
        if (other !== view)
          other.dispatch({
            changes: tr.changes,
            annotations: [mirrored.of(true), Transaction.addToHistory.of(false)],
          });
    }
  }

  /** An edit from elsewhere (a rename across files), made in the view showing the document, or in its state. */
  edit(spec: { changes: ChangeSpec; userEvent: string }) {
    if (!this.state) return;
    if (this.dispatchToView) return this.dispatchToView(spec);
    const tr = this.state.update(spec);
    this.update(tr);
  }

  /** The file was renamed or moved: from now on it is read and saved at the new path. */
  moveTo(path: string) {
    this.path = path;
    this.key = keyOf(this.source, path);
    this.notify();
  }

  /** Moves the caret to a 1-based line and column, now or once a view shows the document. */
  reveal(line: number, column?: number) {
    if (this.revealInView) this.revealInView(line, column);
    else this.pendingReveal = { line, column };
  }

  showChanges(on: boolean | undefined) {
    if (this.comparing === on) return;
    this.comparing = on;
    this.notify();
  }

  /** Shows the changes against `baseline`, or against the last commit again when undefined. */
  compareWith(baseline: ChangeBaseline | undefined) {
    if (this.comparedWith === baseline) return;
    this.comparedWith = baseline;
    this.notify();
  }

  clearError() {
    this.set({ error: undefined });
  }

  dispose() {
    if (!this.live) return;
    this.live = false;
    this.generation++;
    for (const listener of this.disposers) listener();
    this.disposers.clear();
    this.savers.clear();
    this.listeners.clear();
    this.stateListeners.clear();
  }
}
