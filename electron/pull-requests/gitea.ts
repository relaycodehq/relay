import type {
  Account,
  ChangedFile,
  Discussion,
  FilePair,
  Issue,
  Page,
  Pull,
  PullRef,
  Repo,
  Review,
  ReviewComment,
  Draft,
} from "../../shared/types";
import type { MergeMethod, MergeReadiness } from "../../shared/pull-readiness";
import { diffPaths } from "./diff-paths";
import { filePair } from "./file-pair";
import {
  ApiError,
  type FetchRequest,
  type PullHost,
  type PullState,
  type RepositoryInfo,
  type SearchFilter,
} from "./host";
import { mergedPulls } from "./merged";
import { giteaMerge, giteaMergeReadiness } from "./gitea-merge";
import { HostRequests, responseMessage, type RequestOptions } from "./request";
import { normalizeServer, parsePullUrl } from "../../shared/validation";
const MAX_FILE = 2 * 1024 * 1024;

/** Pull requests on the connected Gitea server, as its account. */
export class Gitea implements PullHost {
  private requests: HostRequests;

  // Main-process only: the token never crosses the renderer IPC boundary.
  constructor(
    public account: Account,
    private token: string,
    fetchRequest: FetchRequest,
  ) {
    this.requests = new HostRequests(fetchRequest);
  }

  /**
   * Another token when this one is refused. tea's OAuth logins hand out one
   * that expires within hours and refresh it only when asked again.
   */
  renewToken?: () => Promise<string>;
  private renewing?: Promise<string | null>;

  /** A token other than the refused `stale`, asked for once however many requests were refused. */
  private async renewed(stale: string): Promise<string | null> {
    if (this.token !== stale) return this.token;
    this.renewing ??= this.renewToken!()
      .then(
        (token) => (this.token = token.trim()),
        () => null,
      )
      .finally(() => (this.renewing = undefined));
    const fresh = await this.renewing;
    return fresh && fresh !== stale ? fresh : null;
  }

  dispose() {
    this.requests.dispose();
  }

  request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ data: T; headers: Headers }> {
    return this.requests.request<T>(
      `${this.account.server}/api/v1${path}`,
      {
        ...options,
        text: options.raw,
        tooLarge: options.raw
          ? "This file is too large for the inline viewer. Open it in Gitea or your local editor."
          : "Gitea returned more data than Relay can safely handle. Please retry.",
      },
      async (send) => {
        const headers = (token: string) => ({
          Authorization: `token ${token}`,
          Accept: options.raw ? "application/octet-stream" : "application/json",
        });
        const used = this.token;
        let response = await send(headers(used));
        if (response.status === 401 && this.renewToken) {
          const fresh = await this.renewed(used);
          if (fresh) {
            await response.body?.cancel();
            response = await send(headers(fresh));
          }
        }
        if (!response.ok) {
          const message = await responseMessage(response);
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
                    : [405, 409, 422].includes(response.status) && message
                      ? `Gitea refused this: ${message}`
                      : `Gitea returned HTTP ${response.status}. Please retry.`,
            message,
          );
        }
        return response;
      },
    );
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

  headRef(p: Pull) {
    return `refs/pull/${p.number}/head`;
  }

  async pull(r: PullRef, signal?: AbortSignal) {
    const p = (await this.request<Pull>(this.pr(r), { signal })).data;
    return { ...p, ...r };
  }

  /** Gitea's issue search, narrowed to pulls; `filter` picks your part in them. */
  search(filter: SearchFilter, q: string, state: PullState, page: number) {
    const query = new URLSearchParams({
      type: "pulls",
      state,
      q,
      ...(filter === "all" ? {} : { [filter]: "true" }),
    });
    return this.page<Issue>(`/repos/issues/search?${query}`, page);
  }

  mergedAmong(r: Repo, numbers: number[], signal: AbortSignal) {
    return mergedPulls(this, r, numbers, signal);
  }

  files(r: PullRef, page: number, signal?: AbortSignal) {
    return this.page<ChangedFile>(`${this.pr(r)}/files`, page, signal);
  }

  /**
   * Paths whose content differs between two commits, like Gitea's own
   * "changed since last view". Null when the server can't say: before 1.27 the
   * compare API has no raw diff, and a force-push may have dropped `from`.
   */
  async changedBetween(
    r: PullRef,
    from: string,
    to: string,
  ): Promise<string[] | null> {
    if (from === to) return [];
    try {
      const { data, headers } = await this.request<string>(
        `${this.repo(r)}/compare/${from}..${to}?output=diff`,
        { raw: true, limit: 64 * 1024 * 1024 },
      );
      return headers.get("content-type")?.startsWith("text/plain")
        ? diffPaths(data)
        : null;
    } catch {
      return null;
    }
  }

  reviews(r: PullRef, page: number, signal?: AbortSignal) {
    return this.page<Review>(`${this.pr(r)}/reviews`, page, signal);
  }

  async reviewComments(r: PullRef, review: number, signal?: AbortSignal) {
    return (
      await this.request<ReviewComment[]>(
        `${this.pr(r)}/reviews/${review}/comments`,
        { signal },
      )
    ).data;
  }

  /** The PR's conversation: comments outside any review. */
  discussion(r: PullRef, page: number) {
    return this.page<Discussion>(
      `${this.repo(r)}/issues/${r.number}/comments`,
      page,
    );
  }

  async comment(r: PullRef, body: string) {
    return (
      await this.request(`${this.repo(r)}/issues/${r.number}/comments`, {
        method: "POST",
        body: { body },
      })
    ).data;
  }

  async reply(r: PullRef, comment: number, body: string) {
    return (
      await this.request(`${this.pr(r)}/comments/${comment}/replies`, {
        method: "POST",
        body: { body },
      })
    ).data;
  }

  async resolveComment(r: PullRef, comment: number, resolved: boolean) {
    await this.request(
      `${this.repo(r)}/pulls/comments/${comment}/${resolved ? "resolve" : "unresolve"}`,
      { method: "POST" },
    );
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
  contentsAt(p: Pull, file: ChangedFile, signal?: AbortSignal) {
    const headRepo = p.head.repo
      ? { owner: p.head.repo.owner.login, name: p.head.repo.name }
      : p;
    return filePair(
      p,
      file,
      async (sha, path) =>
        (
          await this.request<string>(
            `${this.repo(sha === p.head.sha ? headRepo : p)}/raw/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`,
            { raw: true, limit: signal ? 128 * 1024 : MAX_FILE, signal },
          )
        ).data,
    );
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

  /**
   * The waits before asking again about a PR Gitea calls unmergeable: it
   * says so while it is still checking for conflicts, too.
   */
  mergeableRechecks = [750, 1500];

  mergeReadiness(r: PullRef): Promise<MergeReadiness> {
    return giteaMergeReadiness(this, r);
  }

  merge(r: PullRef, head: string, method: MergeMethod) {
    return giteaMerge(this, r, head, method);
  }

  /** A page of the repository's pulls, newest first. */
  pulls(
    r: Repo,
    state: PullState,
    page: number,
    signal?: AbortSignal,
    order: "updated" | "created" = "created",
  ) {
    return this.page<Pull>(
      `${this.repo(r)}/pulls?state=${state}${order === "updated" ? "&sort=recentupdate" : ""}`,
      page,
      signal,
    );
  }

  async repository(r: Repo) {
    return (await this.request<RepositoryInfo>(this.repo(r))).data;
  }

  async hasRepository(r: Repo) {
    const found = await this.request<{ full_name: string }>(this.repo(r)).catch(
      (e: unknown) => {
        // A deleted repository, or one this account can't see, isn't it.
        if (e instanceof ApiError && [403, 404].includes(e.status)) return null;
        throw e;
      },
    );
    return (
      !!found &&
      found.data.full_name.toLowerCase() ===
        `${r.owner}/${r.name}`.toLowerCase()
    );
  }

  async branches(r: Repo) {
    const values: { name: string }[] = [];
    for (let page = 1; page <= 100; page++) {
      const found = await this.page<{ name: string }>(
        `${this.repo(r)}/branches`,
        page,
      );
      values.push(...found.items);
      if (!found.nextPage) return values;
    }
    throw new Error(
      "This repository has too many branches to load safely. Open the PR in Gitea.",
    );
  }

  /** The branch's tip, or null when the server has no such branch. */
  async branchHead(r: Repo, branch: string) {
    try {
      return (
        await this.request<{ commit: { id: string } }>(
          `${this.repo(r)}/branches/${encodeURIComponent(branch)}`,
        )
      ).data.commit.id;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  /** Gitea marks drafts by a `WIP:` title prefix, which a server may not recognise. */
  async createPull(
    r: Repo,
    input: { head: string; base: string; title: string; body: string },
    draft: boolean,
  ) {
    const pull = (
      await this.request<Pull>(`${this.repo(r)}/pulls`, {
        method: "POST",
        body: {
          ...input,
          title:
            draft && !/^(WIP:|\[WIP\])/i.test(input.title)
              ? `WIP: ${input.title}`
              : input.title,
        },
      })
    ).data;
    return { pull, draftIgnored: draft && !pull.draft };
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

  parseUrl(url: string): PullRef {
    return {
      ...parsePullUrl(url, this.account.server),
      server: this.account.server,
    };
  }
}
