import { watch, type FSWatcher } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  applyEdits,
  getNodeValue,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  type ParseError,
} from "jsonc-parser";
import {
  SETTINGS_FILE_NAME,
  type SettingsEdit,
  type SettingsFileError,
  type SettingsFileState,
} from "../../shared/settings-file";

/**
 * Where settings.json lives: with the rest of a person's dotfiles on macOS and
 * Linux ($XDG_CONFIG_HOME/relay, else ~/.config/relay), beside the app's data
 * on Windows.
 */
export function settingsDir(o: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  appData: string;
}) {
  if (o.platform === "win32") return join(o.appData, "Relay");
  const xdg = o.env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(o.home, ".config"), "relay");
}

/** Edits that settle within this long are read once. */
const SETTLE_MS = 40;
/** Times a save starts over because a script replaced the file meanwhile. */
const RETRIES = 3;
const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };

function parseSettings(
  text: string,
):
  | { values: Record<string, unknown>; error?: undefined }
  | { error: SettingsFileError } {
  if (!text.trim()) return { values: {} };
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  const at = (offset: number) => {
    const before = text.slice(0, offset).split("\n");
    return { line: before.length, column: before.at(-1)!.length + 1 };
  };
  if (errors.length)
    return {
      error: {
        message: describe(printParseErrorCode(errors[0].error)),
        ...at(errors[0].offset),
      },
    };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      error: {
        message: "The file should hold one { … } object",
        line: 1,
        column: 1,
      },
    };
  return { values: value as Record<string, unknown> };
}

/** jsonc-parser's codes ("CommaExpected") in words. */
function describe(code: string) {
  const words = code.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The file's text with each edit's value put at its path, or the key removed. */
function withEdits(text: string, edits: SettingsEdit[]) {
  let next = text.trim() ? text : "{}\n";
  const node = (path: string[]) => findNodeAtLocation(parseTree(next)!, path);
  const edit = (path: string[], value: unknown) => {
    next = applyEdits(next, modify(next, path, value, { formattingOptions }));
  };
  for (const { path, value } of edits) {
    if (value === undefined) {
      // Not there, so nothing to remove; jsonc-parser throws on a missing section.
      if (!node(path)) continue;
    } else
      for (let depth = 1; depth < path.length; depth++) {
        const parent = node(path.slice(0, depth));
        if (!parent) break;
        if (parent.type !== "object")
          throw new Error(
            `"${path.slice(0, depth).join(".")}" in settings.json should be a { … } section; fix it there first.`,
          );
      }
    edit(path, value);
    if (value !== undefined) continue;
    // A section emptied by its last key goes with it.
    for (let depth = path.length - 1; depth > 0; depth--) {
      const parent = node(path.slice(0, depth));
      const left = parent && getNodeValue(parent);
      if (!left || typeof left !== "object" || Object.keys(left).length) break;
      edit(path.slice(0, depth), undefined);
    }
  }
  if (next.replace(/\s/g, "") === "{}") next = "{}\n";
  if (!next.endsWith("\n")) next += "\n";
  return next;
}

/**
 * settings.json, kept read and watched: a script or an editor may replace it
 * while Relay runs, and every window follows. A file that stops parsing keeps
 * the last good values until it's fixed. Settings writes go through `update`,
 * which edits only the keys it names, so comments and layout stay as written.
 */
export class SettingsFile {
  readonly path: string;
  private values: Record<string, unknown> = {};
  private error?: SettingsFileError;
  /** The text last read or written; a watch event that finds it is our own write. */
  private text = "";
  /** By folder, with its inode to tell one made again under the same name. */
  private watchers = new Map<string, { watcher: FSWatcher; ino: number }>();
  private settle?: NodeJS.Timeout;
  /** Reads and writes, one at a time, so an older read never lands after a newer write. */
  private queue: Promise<unknown> = Promise.resolve();
  private following = false;
  private closed = false;

  constructor(
    readonly dir: string,
    /**
     * What the file holds changed, by a save or outside Relay, or it stopped
     * or started parsing. Only from `follow` on.
     */
    private changed: (state: SettingsFileState) => void,
  ) {
    this.path = join(dir, SETTINGS_FILE_NAME);
  }

  state(): SettingsFileState {
    return {
      path: this.path,
      values: this.values,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  /** Reads the file as Relay starts. */
  load() {
    return this.run(() => this.reload());
  }

  /**
   * Watches for edits and reports changes from here on, catching up on any
   * since `load`: call it once what acts on them exists.
   */
  follow() {
    if (this.following || this.closed) return;
    this.following = true;
    void this.settled();
  }

  /** Waits for the saves on their way, before quitting. */
  async flush() {
    await this.queue;
  }

  close() {
    this.closed = true;
    clearTimeout(this.settle);
    for (const { watcher } of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }

  /**
   * Puts each edit's value at its path, or removes the key, and replaces the
   * file in one rename. A file that doesn't parse is left for its owner to fix.
   */
  update(edits: SettingsEdit[]): Promise<SettingsFileState> {
    return this.run(() => this.write(edits));
  }

  /** Makes an empty file if there is none, to open in an editor. */
  ensure(): Promise<string> {
    return this.run(async () => {
      const there = await stat(this.path).then(() => true, missing(false));
      if (!there) {
        await this.replace(this.path, "{}\n");
        this.take("{}\n", parseSettings("{}\n"));
      }
      return this.path;
    });
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const before = JSON.stringify(this.state());
      try {
        return await task();
      } finally {
        if (
          this.following &&
          !this.closed &&
          JSON.stringify(this.state()) !== before
        )
          this.changed(this.state());
      }
    });
    this.queue = result.catch(() => {});
    return result;
  }

  private async write(edits: SettingsEdit[]) {
    // A symlink, as dotfiles keep it, stays one: the file it points to is saved.
    const target = await realpath(this.path).catch(missing(this.path));
    for (let attempt = 0; ; attempt++) {
      const text = await readText(target);
      const parsed = parseSettings(text);
      if (parsed.error) {
        this.take(text, parsed);
        throw new Error(
          `settings.json has an error on line ${parsed.error.line} (${parsed.error.message.toLowerCase()}); fix it there first.`,
        );
      }
      const next = withEdits(text, edits);
      if (
        next !== text &&
        !(await this.replace(
          target,
          next,
          attempt < RETRIES ? text : undefined,
        ))
      )
        continue;
      this.take(next, parseSettings(next));
      return this.state();
    }
  }

  /**
   * Writes beside the file and renames over it, so no reader sees half a file.
   * Given what the file held when the edit began, gives up if it holds
   * something else now: a script saved meanwhile, and its edit would be lost.
   */
  private async replace(target: string, text: string, expected?: string) {
    const folder = dirname(target);
    await mkdir(folder, { recursive: true });
    const tmp = join(folder, `.${basename(target)}.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, text);
      const mode = await stat(target).then(
        (s) => s.mode & 0o777,
        missing(undefined),
      );
      if (mode !== undefined) await chmod(tmp, mode);
      if (expected !== undefined && (await readText(target)) !== expected) {
        await unlink(tmp);
        return false;
      }
      await rename(tmp, target);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    await this.rewatch();
    return true;
  }

  private async reload() {
    const text = await readText(this.path);
    if (text === this.text && !this.error) return;
    const parsed = parseSettings(text);
    if (parsed.error && this.error?.message !== parsed.error.message)
      console.warn(
        `settings.json: ${parsed.error.message} at ${parsed.error.line}:${parsed.error.column}; keeping the last good settings`,
      );
    this.take(text, parsed);
  }

  private take(text: string, parsed: ReturnType<typeof parseSettings>) {
    this.text = text;
    if (parsed.error) this.error = parsed.error;
    else {
      this.values = parsed.values;
      this.error = undefined;
    }
  }

  /**
   * Watches folders, not the file: a script's rename swaps the file out from
   * under a watch. That's the file's folder and, for a symlink, its target's;
   * while one is missing its nearest parent stands in, so a folder a script
   * makes later is found.
   */
  private async rewatch() {
    if (!this.following || this.closed) return;
    const resolved = (path: string) => realpath(path).catch(() => path);
    const folders = new Set([
      await resolved(this.dir),
      dirname(await resolved(this.path)),
    ]);
    const wanted = new Map<string, number>();
    for (const folder of folders) {
      const found = await nearestFolder(folder);
      if (found) wanted.set(found.path, found.ino);
    }
    for (const [folder, { watcher, ino }] of this.watchers)
      if (wanted.get(folder) !== ino) {
        watcher.close();
        this.watchers.delete(folder);
      }
    for (const [folder, ino] of wanted) {
      if (this.watchers.has(folder)) continue;
      try {
        // Any name: a rename may come only under the name it had before, and
        // a read that finds the same text changes nothing.
        const watcher = watch(folder, { persistent: false }, () => this.soon());
        watcher.on("error", () => {
          watcher.close();
          if (this.watchers.get(folder)?.watcher === watcher)
            this.watchers.delete(folder);
          this.soon();
        });
        this.watchers.set(folder, { watcher, ino });
      } catch (e) {
        console.warn("Could not watch settings.json:", e);
      }
    }
  }

  private soon() {
    clearTimeout(this.settle);
    this.settle = setTimeout(() => void this.settled(), SETTLE_MS);
  }

  private async settled() {
    if (this.closed) return;
    await this.run(async () => {
      await this.rewatch();
      await this.reload();
    }).catch((e) => console.warn("Could not read settings.json:", e));
  }
}

/** The file's text, "" when there's none, without the BOM some Windows editors put first. */
async function readText(path: string) {
  const text = await readFile(path, "utf8").catch(missing(""));
  return text.replace(/^\uFEFF/, "");
}

/** `folder`, or the nearest parent of it there is. */
async function nearestFolder(folder: string) {
  for (let here = folder; ; here = dirname(here)) {
    const found = await stat(here).catch(() => undefined);
    if (found?.isDirectory()) return { path: here, ino: found.ino };
    if (dirname(here) === here) return undefined;
  }
}

function missing<T>(fallback: T) {
  return (e: unknown) => {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  };
}
