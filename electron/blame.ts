import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectRepository } from "./repository";
import { blameQuerySchema } from "../shared/validation";
import type { BlameQuery, LineBlame, Repo } from "../shared/types";

const exec = promisify(execFile);

/** Immutable, single-line lookups. A new hover cancels obsolete Git work. */
export class BlameService {
  private cache = new Map<string, LineBlame>();
  private active?: {
    key: string;
    controller: AbortController;
    promise: Promise<LineBlame>;
  };

  dispose() {
    this.active?.controller.abort();
    this.active = undefined;
    this.cache.clear();
  }

  read(
    folder: string,
    server: string,
    repo: Repo,
    input: BlameQuery,
  ): Promise<LineBlame> {
    const query = blameQuerySchema.parse(input);
    const key = JSON.stringify([
      folder,
      server,
      repo.owner,
      repo.name,
      query.revision,
      query.path,
      query.line,
    ]);
    if (this.active?.key === key) return this.active.promise;
    this.active?.controller.abort();
    this.active = undefined;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    const controller = new AbortController();
    const promise = this.lookup(folder, server, repo, query, controller.signal)
      .then((result) => {
        controller.signal.throwIfAborted();
        // Fetching more history can change blame in a shallow clone.
        if (!result.shallow) {
          this.cache.set(key, result);
          if (this.cache.size > 400)
            this.cache.delete(this.cache.keys().next().value!);
        }
        return result;
      })
      .finally(() => {
        if (this.active?.controller === controller) this.active = undefined;
      });
    this.active = { key, controller, promise };
    return promise;
  }

  private async lookup(
    folder: string,
    server: string,
    repo: Repo,
    query: BlameQuery,
    signal: AbortSignal,
  ): Promise<LineBlame> {
    const local = await inspectRepository(folder, server, repo, signal);
    if (!local.remoteMatches)
      throw new Error(
        "The linked folder no longer matches this repository. Link the correct folder to see blame.",
      );
    signal.throwIfAborted();
    const git = async (...args: string[]) =>
      (
        await exec("git", ["--literal-pathspecs", "-C", local.path, ...args], {
          signal,
          timeout: 10000,
          maxBuffer: 3 * 1024 * 1024,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_OPTIONAL_LOCKS: "0",
            GIT_NO_REPLACE_OBJECTS: "1",
            GIT_NO_LAZY_FETCH: "1",
          },
        })
      ).stdout;
    try {
      await git("cat-file", "-e", `${query.revision}^{commit}`);
    } catch {
      signal.throwIfAborted();
      throw new Error(
        "This revision is missing from the linked repository. Fetch the PR’s history in your Git client, then hover again.",
      );
    }
    let output: string, shallow: string;
    try {
      [output, shallow] = await Promise.all([
        git(
          "-c",
          "blame.ignoreRevsFile=",
          "blame",
          "--line-porcelain",
          "--no-textconv",
          "--root",
          "-L",
          `${query.line},${query.line}`,
          query.revision,
          "--",
          query.path,
        ),
        git("rev-parse", "--is-shallow-repository"),
      ]);
    } catch {
      signal.throwIfAborted();
      throw new Error(
        "Could not read blame for this line and revision. Check that the file and its history are available locally, then hover again.",
      );
    }
    const rows = output.split("\n");
    const header = /^([a-f0-9]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(rows[0]);
    const fields = new Map<string, string>();
    for (const row of rows.slice(1)) {
      if (row.startsWith("\t")) break;
      const space = row.indexOf(" ");
      if (space > 0) fields.set(row.slice(0, space), row.slice(space + 1));
    }
    const date = new Date(Number(fields.get("author-time")) * 1000);
    if (
      !header ||
      Number(header[2]) !== query.line ||
      !fields.has("author") ||
      !Number.isFinite(date.getTime())
    )
      throw new Error(
        "Git returned incomplete blame information for this line.",
      );
    return {
      commit: header[1],
      author: fields.get("author")!.slice(0, 300),
      email: (fields.get("author-mail") ?? "")
        .replace(/^<|>$/g, "")
        .slice(0, 300),
      authoredAt: date.toISOString(),
      summary: (fields.get("summary") ?? "").slice(0, 2000),
      shallow: shallow.trim() === "true",
    };
  }
}
