import { watch, type FSWatcher } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
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
  /** The text last read or written; a watch event for it is our own write. */
  private text = "";
  private watcher?: FSWatcher;
  private settle?: NodeJS.Timeout;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    readonly dir: string,
    /** The file changed outside Relay, or stopped or started parsing. */
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

  async load() {
    await this.reload();
    this.watch();
  }

  close() {
    this.closed = true;
    clearTimeout(this.settle);
    this.watcher?.close();
  }

  /**
   * Puts each edit's value at its path, or removes the key, and replaces the
   * file in one rename. A file that doesn't parse is left for its owner to fix.
   */
  update(edits: SettingsEdit[]): Promise<SettingsFileState> {
    const task = this.queue.then(() => this.write(edits));
    this.queue = task.catch(() => {});
    return task;
  }

  private async write(edits: SettingsEdit[]) {
    const text = await readFile(this.path, "utf8").catch(missing(""));
    const parsed = parseSettings(text);
    if (parsed.error) {
      this.apply(text, parsed);
      throw new Error(
        `settings.json has an error on line ${parsed.error.line} (${parsed.error.message.toLowerCase()}); fix it there first.`,
      );
    }
    let next = text.trim() ? text : "{}\n";
    const edit = (path: string[], value: unknown) => {
      next = applyEdits(next, modify(next, path, value, { formattingOptions }));
    };
    for (const { path, value } of edits) {
      edit(path, value);
      if (value !== undefined) continue;
      // A section emptied by its last key goes with it.
      for (let depth = path.length - 1; depth > 0; depth--) {
        const parent = findNodeAtLocation(
          parseTree(next)!,
          path.slice(0, depth),
        );
        const left = parent && getNodeValue(parent);
        if (!left || typeof left !== "object" || Object.keys(left).length)
          break;
        edit(path.slice(0, depth), undefined);
      }
    }
    if (next.replace(/\s/g, "") === "{}") next = "{}\n";
    if (!next.endsWith("\n")) next += "\n";
    if (next !== text) await this.replace(next);
    this.apply(next, parseSettings(next));
    return this.state();
  }

  /** Makes an empty file if there is none, to open in an editor. */
  ensure(): Promise<string> {
    const task = this.queue.then(async () => {
      const there = await stat(this.path).then(() => true, missing(false));
      if (!there) {
        await this.replace("{}\n");
        this.apply("{}\n", parseSettings("{}\n"));
      }
      return this.path;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  /** Writes beside the file and renames over it, so no reader sees half a file. */
  private async replace(text: string) {
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `.${SETTINGS_FILE_NAME}.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, text);
      const mode = await stat(this.path).then(
        (s) => s.mode & 0o777,
        missing(undefined),
      );
      if (mode !== undefined) await chmod(tmp, mode);
      await rename(tmp, this.path);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    this.watch();
  }

  private async reload() {
    const text = await readFile(this.path, "utf8").catch(missing(""));
    if (text === this.text && !this.error) return false;
    const parsed = parseSettings(text);
    if (parsed.error && this.error?.message !== parsed.error.message)
      console.warn(
        `settings.json: ${parsed.error.message} at ${parsed.error.line}:${parsed.error.column}; keeping the last good settings`,
      );
    return this.apply(text, parsed);
  }

  /** Takes in what was read; says whether anything a window shows changed. */
  private apply(text: string, parsed: ReturnType<typeof parseSettings>) {
    this.text = text;
    const before = JSON.stringify(this.state());
    if (parsed.error) this.error = parsed.error;
    else {
      this.values = parsed.values;
      this.error = undefined;
    }
    return JSON.stringify(this.state()) !== before;
  }

  /** The folder, not the file: a script's rename swaps the file out from under a watch. */
  private watch() {
    if (this.closed || this.watcher) return;
    try {
      // Any name: a rename may come only under the name it had before, and a
      // read that finds the same text changes nothing.
      this.watcher = watch(this.dir, { persistent: false }, () => {
        clearTimeout(this.settle);
        this.settle = setTimeout(() => void this.settled(), SETTLE_MS);
      });
      // The folder went away; the next save from Settings watches again.
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch (e) {
      // No folder yet: the first save from Settings makes it and watches then.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("Could not watch settings.json:", e);
    }
  }

  private async settled() {
    if (this.closed) return;
    try {
      if (await this.reload()) this.changed(this.state());
    } catch (e) {
      console.warn("Could not read settings.json:", e);
    }
  }
}

function missing<T>(fallback: T) {
  return (e: unknown) => {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  };
}
