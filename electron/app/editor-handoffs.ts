import type {
  EditorFileTarget,
  EditorHandoff,
  UnsavedBuffer,
} from "../../shared/editor-windows";

/** Which window a workspace's handoff is for: its popped-out editor, or the one the editor came from. */
export type HandoffSide = "editor" | "host";

/** Files asked for while a window is still loading; the newest are kept. */
const MAX_OPENS = 20;

const empty = (): EditorHandoff => ({ buffers: [], opens: [] });

/**
 * What waits in memory for an editor to take it as it moves between windows:
 * unsaved buffers, and files to open. Each workspace holds one handoff per
 * side, and a window takes its side's once.
 */
export class EditorHandoffs {
  private held = new Map<string, EditorHandoff>();

  private key(side: HandoffSide, where: string) {
    return `${side}\0${where}`;
  }

  /** Adds to what the side holds; a buffer for a file it already holds replaces it. */
  add(
    side: HandoffSide,
    where: string,
    part: { buffers?: UnsavedBuffer[]; opens?: EditorFileTarget[] },
  ) {
    if (!part.buffers?.length && !part.opens?.length) return;
    const key = this.key(side, where);
    const had = this.held.get(key) ?? empty();
    const buffers = new Map(
      had.buffers.map((b) => [`${b.outside}\0${b.path}`, b]),
    );
    for (const b of part.buffers ?? [])
      buffers.set(`${b.outside}\0${b.path}`, b);
    this.held.set(key, {
      buffers: [...buffers.values()],
      opens: [...had.opens, ...(part.opens ?? [])].slice(-MAX_OPENS),
    });
  }

  /** What the side holds, which it then no longer does. */
  take(side: HandoffSide, where: string): EditorHandoff {
    const key = this.key(side, where);
    const held = this.held.get(key);
    this.held.delete(key);
    return held ?? empty();
  }

  /** Lets go of what the side holds, as its window closes. */
  clear(side: HandoffSide, where: string) {
    this.held.delete(this.key(side, where));
  }

  /** The workspaces with something held for either side. */
  waiting() {
    return [...new Set([...this.held.keys()].map((k) => k.split("\0")[1]))];
  }
}
