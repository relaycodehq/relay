import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../../shared/error-message";
import type { LspServerStatus } from "../../shared/language-servers";
import type { OpenDoc } from "./file-notices";
import type { ServerSpec } from "./registry";

/** Keeps open the files a search for usages needs, until no page has a file of the folder open. */
export const searchHold = {};
const LOAD_MS = 60_000;

/** What of a server's folder the holds work on. */
interface HeldServer {
  root: string;
  spec: ServerSpec;
  docs: Map<string, OpenDoc>;
  session: {
    status: LspServerStatus;
    close(uri: string): void;
    request(method: string, params: object, timeout: number): Promise<unknown>;
  };
  notices: { forget(key: string): void };
  /** Opening a file of each project, once until the holds are let go. */
  holding?: Promise<void>;
}

interface Holding {
  open(path: string, text: string): Promise<unknown>;
  /** How the server stands, told to every workspace using it. */
  report(status: LspServerStatus): void;
  log?(line: string): void;
}

/**
 * Opens a file of every project in the folder, for a server that searches
 * only the projects of files it has open, so usages are found in all of them.
 * Loading them takes seconds in a big folder; the server reads as indexing
 * until they have.
 */
export function holdEveryProject(
  server: HeldServer,
  { open, report, log }: Holding,
) {
  const listProjects = server.spec.oneFilePerProject;
  if (!listProjects) return Promise.resolve();
  const hold = async (path: string) => {
    const text = await readFile(join(server.root, path), "utf8").catch(
      () => undefined,
    );
    if (text === undefined) return;
    await open(path, text);
    // Searching while a project still loads finds nothing in it.
    const loaded = server.spec.projectLoaded?.(join(server.root, path));
    if (loaded)
      await server.session
        .request(loaded.method, loaded.params, LOAD_MS)
        .catch(() => {});
  };
  const loading = (done: number, total: number) =>
    report({
      ...server.session.status,
      state: "indexing",
      message: `Loading projects ${done + 1} of ${total}`,
      progress: Math.round((done / total) * 100),
    });
  server.holding ??= listProjects(server.root).then(
    async (paths) => {
      if (!paths.length) return;
      let done = 0;
      loading(done, paths.length);
      await Promise.all(
        paths.map(async (path) => {
          await hold(path);
          if (++done < paths.length) loading(done, paths.length);
        }),
      );
      report(server.session.status);
    },
    (e) =>
      log?.(`${server.spec.id}: couldn't list projects: ${errorMessage(e)}`),
  );
  return server.holding;
}

/** No page has a file of the folder open; only searches might. */
export function onlyHeldOpen(server: HeldServer) {
  return [...server.docs.values()].every((doc) =>
    [...doc.openIn.values()].every(
      (owners) => owners.size === 1 && owners.has(searchHold),
    ),
  );
}

/** Closes the files held for searches; the next search opens them again. */
export function letGo(server: HeldServer) {
  for (const [key, doc] of server.docs) {
    server.session.close(doc.uri);
    server.notices.forget(key);
  }
  server.docs.clear();
  server.holding = undefined;
}
