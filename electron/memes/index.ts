// The meme folder in app data: memes.json, the list the person can edit, and
// one picture per meme beside it, which an agent downloads in a thread.
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  builtInMemes,
  memeName,
  readMemeList,
  withNewBuiltIns,
  type MemeEntry,
  type MemeListFile,
  type MemesState,
} from "../../shared/memes";
import { mediaUrl } from "../media";

const picture = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(jpg|png|gif|webp)$/;

export class Memes {
  readonly folder: string;
  readonly list: string;

  constructor(dir: string) {
    this.folder = join(dir, "memes");
    this.list = join(this.folder, "memes.json");
  }

  /** memes.json as saved, nothing when there's none yet, or why it can't be read. */
  private async readList(): Promise<{ file?: MemeListFile; problem?: string }> {
    let text: string;
    try {
      text = await readFile(this.list, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw e;
    }
    try {
      const file: unknown = JSON.parse(text);
      if (!file || typeof file !== "object" || Array.isArray(file))
        return { problem: 'memes.json must be an object with a "memes" list.' };
      return { file: file as MemeListFile };
    } catch (e) {
      return {
        problem: `memes.json isn't valid JSON: ${e instanceof Error ? e.message : e}`,
      };
    }
  }

  /** Each meme's picture in the folder, by id. */
  private async pictures() {
    const found = new Map<string, string>();
    const names = await readdir(this.folder).catch(() => [] as string[]);
    for (const name of names.sort()) {
      const id = picture.exec(name)?.[1];
      if (id && !found.has(id)) found.set(id, join(this.folder, name));
    }
    return found;
  }

  async state(): Promise<MemesState> {
    const read = await this.readList();
    const list = read.file
      ? readMemeList(read.file)
      : {
          memes: read.problem ? [] : (builtInMemes as MemeEntry[]),
          problems: [],
        };
    const pictures = await this.pictures();
    return {
      setUp: !!read.file || !!read.problem,
      folder: this.folder,
      list: this.list,
      memes: list.memes.map((m) => {
        const file = pictures.get(m.id);
        return {
          id: m.id,
          name: memeName(m),
          meaning: m.meaning,
          ...(m.find && { find: m.find }),
          ...(file && { url: mediaUrl(file) }),
        };
      }),
      problems: [...(read.problem ? [read.problem] : []), ...list.problems],
    };
  }

  /**
   * memes.json made from the built-ins, or given the ones added since it was;
   * a broken one is left for the person to fix.
   */
  async prepare() {
    const read = await this.readList();
    if (read.problem) return this.state();
    const fresh = withNewBuiltIns(read.file ?? { memes: [] });
    if (!read.file || fresh.added) {
      await mkdir(this.folder, { recursive: true });
      const part = `${this.list}.part`;
      await writeFile(part, `${JSON.stringify(fresh.file, null, 2)}\n`);
      await rename(part, this.list);
    }
    return this.state();
  }
}
