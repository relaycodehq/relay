import type {
  Account,
  ChangedFile,
  FilePair,
  Page,
  Pull,
  PullRef,
  Review,
  Draft,
} from "../shared/types";
import { networkError } from "./network-errors";
import { normalizeServer, parsePullUrl } from "../shared/validation";
const MAX_JSON = 8 * 1024 * 1024,
  MAX_FILE = 2 * 1024 * 1024;
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type FetchRequest = (
  url: string,
  options: RequestInit,
) => Promise<Response>;
export class Gitea {
  constructor(
    public account: Account,
    private token: string,
    private fetchRequest: FetchRequest,
  ) {}
  // Main-process only: credentials never cross the renderer IPC boundary.
  withRepositoryCredential<T>(send: (token: string) => Promise<T>): Promise<T> {
    return send(this.token);
  }
  private controllers = new Set<AbortController>();
  dispose() {
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
  }
  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      raw?: boolean;
      limit?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<{ data: T; headers: Headers }> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const url = `${this.account.server}/api/v1${path}`;
      const response = await this.fetchRequest(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `token ${this.token}`,
          Accept: options.raw ? "application/octet-stream" : "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        redirect: "error",
        credentials: "omit",
        signal: options.signal
          ? AbortSignal.any([controller.signal, options.signal])
          : controller.signal,
      }).catch((error: unknown) => {
        throw networkError(error, this.account.server);
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(
          response.status,
          response.status === 401
            ? "Your token is invalid or expired. Reconnect in Settings."
            : response.status === 403
              ? "Gitea denied access. Check the token’s repository and issue permissions."
              : response.status === 404
                ? "Not found, or your token cannot access this repository."
                : response.status === 429
                  ? "Gitea is rate limiting requests. Wait a moment, then retry."
                  : `Gitea returned HTTP ${response.status}. Please retry.`,
        );
      }
      const limit = options.limit ?? MAX_JSON;
      if (Number(response.headers.get("content-length")) > limit) {
        await response.body?.cancel();
        throw new Error(
          "This file is too large for the inline viewer (2 MiB per side). Open it in Gitea or your local editor.",
        );
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) {
            await reader.cancel();
            throw new Error(
              "Response exceeded the safe display size. Open this file in Gitea or your local editor.",
            );
          }
          chunks.push(value);
        }
      const body = Buffer.concat(chunks).toString("utf8");
      return {
        data: (options.raw ? body : body ? JSON.parse(body) : null) as T,
        headers: response.headers,
      };
    } catch (e) {
      if (controller.signal.aborted)
        throw new Error("Request cancelled or timed out. Please retry.");
      throw e;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  async page<T>(
    path: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<Page<T>> {
    const r = await this.request<T[]>(
      `${path}${path.includes("?") ? "&" : "?"}limit=50&page=${page}`,
      { signal },
    );
    const link = r.headers.get("link");
    const total = r.headers.get("x-total-count");
    return {
      items: r.data,
      nextPage: link
        ? /rel="?next"?/.test(link)
          ? page + 1
          : null
        : total
          ? page * 50 < Number(total)
            ? page + 1
            : null
          : r.data.length === 50
            ? page + 1
            : null,
      ...(total ? { total: Number(total) } : {}),
    };
  }
  repo(r: { owner: string; name: string }) {
    return `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;
  }
  pr(r: PullRef) {
    return `${this.repo(r)}/pulls/${r.number}`;
  }
  async pull(r: PullRef, signal?: AbortSignal) {
    const p = (await this.request<Pull>(this.pr(r), { signal })).data;
    return { ...p, ...r };
  }
  async contents(
    r: PullRef,
    file: ChangedFile,
    head: string,
    base: string,
  ): Promise<FilePair> {
    const p = await this.pull(r);
    if (p.head.sha !== head || p.merge_base !== base)
      throw new Error(
        "This PR changed. Refresh before continuing your review.",
      );
    return this.contentsAt(p, file);
  }
  // The caller pins immutable blobs and checks the PR revision before/after a scan.
  async contentsAt(
    p: Pull,
    file: ChangedFile,
    signal?: AbortSignal,
  ): Promise<FilePair> {
    const r: PullRef = p,
      head = p.head.sha,
      base = p.merge_base;
    const raw = async (
      repo: { owner: string; name: string },
      path: string,
      sha: string,
    ) =>
      (
        await this.request<string>(
          `${this.repo(repo)}/raw/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`,
          { raw: true, limit: signal ? 128 * 1024 : MAX_FILE, signal },
        )
      ).data;
    const headRepo = p.head.repo
      ? { owner: p.head.repo.owner.login, name: p.head.repo.name }
      : r;
    const [old, next] = await Promise.all([
      file.status === "added"
        ? Promise.resolve(null)
        : raw(r, file.previous_filename || file.filename, base),
      file.status === "deleted"
        ? Promise.resolve(null)
        : raw(headRepo, file.filename, head),
    ]);
    const binary = [old, next].some(
      (v) =>
        v !== null &&
        (v.includes("\0") ||
          v.startsWith("version https://git-lfs.github.com/spec/v1")),
    );
    return {
      old:
        old === null
          ? null
          : {
              name: file.previous_filename || file.filename,
              contents: binary ? "" : old,
              cacheKey: `${base}:${file.previous_filename || file.filename}`,
            },
      next:
        next === null
          ? null
          : {
              name: file.filename,
              contents: binary ? "" : next,
              cacheKey: `${head}:${file.filename}`,
            },
      binary,
    };
  }
  async submit(
    r: PullRef,
    head: string,
    event: string,
    body: string,
    drafts: Draft[],
  ): Promise<Review> {
    const p = await this.pull(r);
    if (p.head.sha !== head)
      throw new Error(
        "A new commit arrived. Refresh and review it before submitting.",
      );
    if (p.state !== "open")
      throw new Error(
        "This pull request is closed. You can still add to the conversation.",
      );
    if (event !== "COMMENT" && p.user.id === this.account.user.id)
      throw new Error(
        "Gitea does not allow approving or requesting changes on your own PR. Choose Comment instead.",
      );
    // Gitea submits every pending server-side comment, not just this request's comments.
    // Avoid unintentionally publishing a review started in another client, or duplicating
    // comments left pending by a partially failed server mutation.
    for (let page = 1; page <= 1000; page++) {
      const reviews = await this.page<Review>(`${this.pr(r)}/reviews`, page);
      if (
        reviews.items.some(
          (v) => v.state === "PENDING" && v.user?.id === this.account.user.id,
        )
      )
        throw new Error(
          "You already have a pending review in Gitea. Finish or discard it there first; your local drafts are preserved.",
        );
      if (!reviews.nextPage) break;
      if (page === 1000)
        throw new Error(
          "Review history is too large to verify safely. Submit the review in Gitea.",
        );
    }
    if (drafts.some((d) => d.revision !== `${p.merge_base}:${head}`))
      throw new Error(
        "Some draft comments belong to an older revision. Re-anchor them before submitting.",
      );
    return (
      await this.request<Review>(`${this.pr(r)}/reviews`, {
        method: "POST",
        body: {
          body,
          commit_id: head,
          event,
          comments: drafts.map((d) => ({
            path: d.path,
            body: d.body,
            old_position: d.side === "deletions" ? d.line : 0,
            new_position: d.side === "additions" ? d.line : 0,
          })),
        },
      })
    ).data;
  }
  static async connect(
    server: string,
    token: string,
    fetchRequest: FetchRequest,
  ) {
    server = normalizeServer(server);
    const client = new Gitea(
      { server, id: server, user: { id: 0, login: "" }, persistent: false },
      token.trim(),
      fetchRequest,
    );
    const user = (await client.request<Account["user"]>("/user")).data;
    client.account = { ...client.account, user, id: `${server}#${user.id}` };
    return client;
  }
  parseUrl(url: string) {
    return parsePullUrl(url, this.account.server);
  }
}
