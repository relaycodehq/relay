// The pages an answer showed, one folder per render beside the thread's
// screenshots: <chats>/renders/<chatId>/<renderId>/<page>.html.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RENDER_MAX_PAGES } from "../../shared/html-render";

const CHAT_ID = /^[\w-]{1,80}$/;
const RENDER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RenderFiles {
  constructor(private dir: string) {}

  private folder(chatId: string, renderId: string) {
    if (!CHAT_ID.test(chatId) || !RENDER_ID.test(renderId))
      throw new Error("Invalid render identity.");
    return join(this.dir, chatId, renderId);
  }

  async save(chatId: string, renderId: string, pages: string[]) {
    const folder = this.folder(chatId, renderId);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await Promise.all(
      pages.map((html, i) =>
        writeFile(join(folder, `${i}.html`), html, { flag: "wx", mode: 0o600 }),
      ),
    );
  }

  read(chatId: string, renderId: string, page: number) {
    if (!Number.isInteger(page) || page < 0 || page >= RENDER_MAX_PAGES)
      throw new Error("Invalid render page.");
    return readFile(
      join(this.folder(chatId, renderId), `${page}.html`),
      "utf8",
    );
  }

  /** A fork's copies of the renders its messages carry over. */
  async copy(from: string, to: string, renderIds: string[]) {
    for (const id of renderIds)
      await cp(this.folder(from, id), this.folder(to, id), {
        recursive: true,
      }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
}
