import type {
  Account,
  ChangedFile,
  Discussion,
  Issue,
  Draft,
  MergeMethod,
  MergeReadiness,
  FilePair,
  Page,
  Pull,
  PullRef,
  Repo,
  Review,
  ReviewComment,
} from "../../shared/types";
import { GITHUB_SERVER } from "../../shared/source-control";
import { parseGithubPullUrl } from "../../shared/validation";
import type { GithubCredential } from "../github/credentials";
import {
  ApiError,
  type FetchRequest,
  type PullHost,
  type PullListing,
  type PullState,
  type RepositoryInfo,
  type SearchFilter,
} from "./host";
import { filePair } from "./file-pair";
import { mergedPulls } from "./merged";
import { HostRequests, responseMessage, type RequestOptions } from "./request";

const API = "https://api.github.com";
const MAX_FILE = 2 * 1024 * 1024;

interface GithubIssue extends Omit<
  Issue,
  "body" | "repository" | "pull_request"
> {
  body: string | null;
  draft?: boolean;
  repository_url: string;
  pull_request?: { merged_at: string | null };
}

const searchQualifiers: Record<SearchFilter, string> = {
  review_requested: "review-requested:@me",
  assigned: "assignee:@me",
  created: "author:@me",
  all: "involves:@me",
};

/**
 * GitHub's search for the Pull requests page. A bare search stays among PRs
 * you're part of, since all of GitHub is noise; one that names a repo, org or
 * user searches there instead.
 */
export function searchQuery(filter: SearchFilter, q: string, state: PullState) {
  const scoped = filter === "all" && /\b(repo|org|user|owner):\S/.test(q);
  return [
    "is:pr",
    "archived:false",
    scoped ? "" : searchQualifiers[filter],
    state === "all" ? "" : `is:${state}`,
    q.trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

const asIssue = (i: GithubIssue): Issue & { draft?: boolean } => {
  const [owner = "", name = ""] = i.repository_url
    .replace(/^.*\/repos\//, "")
    .split("/");
  const { repository_url: _, pull_request, ...rest } = i;
  return {
    ...rest,
    body: i.body ?? "",
    repository: {
      owner,
      name,
      full_name: `${owner}/${name}`,
      server: GITHUB_SERVER,
    },
    pull_request: { merged: !!pull_request?.merged_at },
  };
};

interface GithubPull extends Omit<Pull, "merge_base" | "merged" | "body"> {
  body: string | null;
  merged?: boolean;
  merged_at: string | null;
}
interface GithubReviewComment extends Omit<
  ReviewComment,
  "position" | "original_position" | "resolver"
> {
  line: number | null;
  original_line: number | null;
  side: "LEFT" | "RIGHT" | null;
}
interface Thread {
  id: string;
  resolvedBy: { login: string; databaseId: number } | null;
  isResolved: boolean;
  comments: number[];
}

// GitHub names review verdicts differently; the rest of Relay speaks Gitea's.
const reviewStates: Record<string, string> = {
  CHANGES_REQUESTED: "REQUEST_CHANGES",
  COMMENTED: "COMMENT",
};
const reviewEvents: Record<string, string> = { APPROVED: "APPROVE" };
const fileStatuses: Record<string, string> = {
  removed: "deleted",
  changed: "modified",
};

const asPull = (p: GithubPull, mergeBase: string): Pull => ({
  ...p,
  body: p.body ?? "",
  merged: p.merged ?? !!p.merged_at,
  merge_base: mergeBase,
  comments: p.comments ?? 0,
  additions: p.additions ?? 0,
  deletions: p.deletions ?? 0,
  changed_files: p.changed_files ?? 0,
});
const asReview = (r: Review): Review => {
  const dismissed = r.state === "DISMISSED";
  return {
    ...r,
    body: r.body ?? "",
    state: dismissed ? "COMMENT" : (reviewStates[r.state] ?? r.state),
    ...(dismissed ? { dismissed } : {}),
  };
};

/**
 * GitHub's `mergeable_state` as Relay reads it. "behind" is a branch rule
 * wanting the head up to date first; "unstable" only means non-required
 * checks failed, which doesn't stop a merge.
 */
export function githubMergeStatus(
  mergeable: boolean | null,
  state: string,
): MergeReadiness["status"] {
  if (mergeable === false || state === "dirty") return "conflicts";
  if (state === "blocked" || state === "behind") return "blocked";
  if (mergeable === null || state === "unknown") return "unknown";
  return "clean";
}

/** `gh` has no GitHub login, as opposed to GitHub not answering. */
export class GithubSignedOut extends Error {
  constructor() {
    super(
      "Sign in to GitHub with `gh auth login` in a terminal, then try again.",
    );
  }
}

/**
 * Pull requests on github.com, signed in as whoever `gh` is. Answers in the
 * shapes the Gitea client gives, so the review UI doesn't care which it is.
 */
export class GitHub implements PullHost {
  private requests: HostRequests;
  /** Merge bases by `base...head`; the pair is immutable, so its answer is too. */
  private mergeBases = new Map<string, string>();
  /**
   * A PR's line comments and threads, briefly: GitHub only lists them per PR,
   * and the review pane asks once per review. Writes drop it.
   */
  private lineDiscussion = new Map<
    string,
    {
      at: number;
      value: Promise<[GithubReviewComment[], Thread[]]>;
    }
  >();
  constructor(
    public account: Account,
    private token: string,
    fetchRequest: FetchRequest,
    private rejected: () => void,
  ) {
    this.requests = new HostRequests(fetchRequest);
  }
  static async connect(
    fetchRequest: FetchRequest,
    { token, rejected }: GithubCredential,
  ) {
    if (!token) throw new GithubSignedOut();
    const client = new GitHub(
      {
        id: GITHUB_SERVER,
        server: GITHUB_SERVER,
        user: { id: 0, login: "" },
        persistent: true,
      },
      token,
      fetchRequest,
      rejected,
    );
    const user = (
      await client.request<{ id: number; login: string; name: string | null }>(
        "/user",
      )
    ).data;
    client.account.user = {
      id: user.id,
      login: user.login,
      ...(user.name ? { full_name: user.name } : {}),
    };
    return client;
  }
  dispose() {
    this.requests.dispose();
  }
  request<T>(
    path: string,
    options: RequestOptions & { accept?: string } = {},
  ): Promise<{ data: T; headers: Headers }> {
    return this.requests.request<T>(
      `${API}${path}`,
      {
        ...options,
        text: options.raw || !!options.accept,
        tooLarge: options.raw
          ? "This file is too large for the inline viewer. Open it on GitHub or in your local editor."
          : "GitHub returned more data than Relay can safely handle. Please retry.",
      },
      async (send) => {
        const response = await send({
          Authorization: `Bearer ${this.token}`,
          Accept:
            options.accept ??
            (options.raw
              ? "application/vnd.github.raw+json"
              : "application/vnd.github+json"),
          "X-GitHub-Api-Version": "2022-11-28",
        });
        if (!response.ok) {
          if (response.status === 401) this.rejected();
          const message = await responseMessage(response);
          throw new ApiError(
            response.status,
            response.status === 401
              ? "GitHub rejected the gh login. Run `gh auth login` again."
              : response.status === 403 || response.status === 429
                ? /rate limit/i.test(message ?? "")
                  ? "GitHub is rate limiting requests. Wait a moment, then retry."
                  : `GitHub denied this${message ? `: ${message}` : "."}`
                : response.status === 404
                  ? "Not found, or your gh login can't see this repository."
                  : [405, 409, 422].includes(response.status) && message
                    ? `GitHub refused this: ${message}`
                    : `GitHub returned HTTP ${response.status}. Please retry.`,
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
      `${path}${path.includes("?") ? "&" : "?"}per_page=50&page=${page}`,
      { signal },
    );
    return {
      items: r.data,
      nextPage: /rel="next"/.test(r.headers.get("link") ?? "")
        ? page + 1
        : null,
    };
  }
  private async all<T>(path: string, signal?: AbortSignal) {
    const values: T[] = [];
    for (let page = 1; page <= 100; page++) {
      const r = await this.page<T>(path, page, signal);
      values.push(...r.items);
      if (!r.nextPage) return values;
    }
    throw new Error(
      "This pull request has too much to load safely. Open it on GitHub.",
    );
  }
  private async graphql<T>(query: string, variables: Record<string, unknown>) {
    const { data } = await this.request<{
      data?: T;
      errors?: { message: string }[];
    }>("/graphql", { method: "POST", body: { query, variables } });
    if (data.errors?.length || !data.data)
      throw new Error(
        `GitHub refused this: ${data.errors?.[0]?.message ?? "no answer"}`,
      );
    return data.data;
  }
  repo(r: Repo) {
    return `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;
  }
  pr(r: PullRef) {
    return `${this.repo(r)}/pulls/${r.number}`;
  }
  /** Where `head` left `base`, which GitHub's pull doesn't say itself. */
  private async mergeBase(r: Repo, base: string, head: string) {
    const key = `${r.owner}/${r.name}:${base}...${head}`;
    const known = this.mergeBases.get(key);
    if (known) return known;
    const { data } = await this.request<{
      merge_base_commit: { sha: string };
    }>(`${this.repo(r)}/compare/${base}...${head}?per_page=1`);
    if (this.mergeBases.size >= 500)
      this.mergeBases.delete(this.mergeBases.keys().next().value!);
    this.mergeBases.set(key, data.merge_base_commit.sha);
    return data.merge_base_commit.sha;
  }
  headRef(p: Pull) {
    return `refs/pull/${p.number}/head`;
  }
  async pull(r: PullRef, signal?: AbortSignal): Promise<Pull> {
    const p = (await this.request<GithubPull>(this.pr(r), { signal })).data;
    return {
      ...asPull(p, await this.mergeBase(r, p.base.sha, p.head.sha)),
      ...r,
      server: GITHUB_SERVER,
    };
  }
  /** A page of the repository's pulls, newest first; list entries carry no merge base or counts. */
  async pulls(
    r: Repo,
    state: PullState,
    page: number,
    signal?: AbortSignal,
    order: "updated" | "created" = "created",
  ): Promise<Page<PullListing>> {
    const found = await this.page<GithubPull>(
      `${this.repo(r)}/pulls?state=${state}&sort=${order}&direction=desc`,
      page,
      signal,
    );
    return {
      ...found,
      items: found.items.map((p): PullListing => ({
        ...asPull(p, ""),
        additions: p.additions,
        deletions: p.deletions,
        changed_files: p.changed_files,
        server: GITHUB_SERVER,
      })),
    };
  }
  mergedAmong(r: Repo, numbers: number[], signal: AbortSignal) {
    return mergedPulls(this, r, numbers, signal);
  }
  async search(
    filter: SearchFilter,
    q: string,
    state: PullState,
    page: number,
  ): Promise<Page<Issue>> {
    const query = new URLSearchParams({
      q: searchQuery(filter, q, state),
      sort: "updated",
      order: "desc",
      per_page: "50",
      page: String(page),
    });
    const { data } = await this.request<{
      total_count: number;
      items: GithubIssue[];
    }>(`/search/issues?${query}`);
    return {
      items: data.items.map(asIssue),
      // Search answers stop at 1000 results however many there are.
      nextPage: page * 50 < Math.min(data.total_count, 1000) ? page + 1 : null,
      total: data.total_count,
    };
  }
  async files(
    r: PullRef,
    page: number,
    signal?: AbortSignal,
  ): Promise<Page<ChangedFile>> {
    const found = await this.page<ChangedFile>(
      `${this.pr(r)}/files`,
      page,
      signal,
    );
    return {
      ...found,
      items: found.items.map((f) => ({
        ...f,
        status: fileStatuses[f.status] ?? f.status,
      })),
    };
  }
  /**
   * Paths that differ between two commits. GitHub only compares from the merge
   * base, which is the same thing when `from` is an ancestor of `to`; null
   * otherwise, as after a force-push, or when the list was cut short.
   */
  async changedBetween(
    r: PullRef,
    from: string,
    to: string,
  ): Promise<string[] | null> {
    if (from === to) return [];
    try {
      const { data } = await this.request<{
        status: string;
        files?: { filename: string; previous_filename?: string }[];
      }>(`${this.repo(r)}/compare/${from}...${to}`);
      if (data.status === "identical") return [];
      if (data.status !== "ahead" || !data.files || data.files.length >= 300)
        return null;
      return [
        ...new Set(
          data.files.flatMap((f) =>
            f.previous_filename
              ? [f.previous_filename, f.filename]
              : [f.filename],
          ),
        ),
      ];
    } catch {
      return null;
    }
  }
  async reviews(r: PullRef, page: number, signal?: AbortSignal) {
    const found = await this.page<Review>(
      `${this.pr(r)}/reviews`,
      page,
      signal,
    );
    return { ...found, items: found.items.map(asReview) };
  }
  /** The review's comments, the line each sits on, and whether its thread is resolved. */
  async reviewComments(
    r: PullRef,
    review: number,
    signal?: AbortSignal,
  ): Promise<ReviewComment[]> {
    const [comments, threads] = await this.discussionOf(r, signal);
    return comments
      .filter((c) => c.pull_request_review_id === review)
      .map(({ line, original_line, side, ...c }) => {
        const resolved = threads.find((t) => t.comments.includes(c.id));
        const at = line ?? original_line ?? 0;
        return {
          ...c,
          position: side === "LEFT" ? 0 : at,
          original_position: side === "LEFT" ? at : 0,
          resolver:
            resolved?.isResolved && resolved.resolvedBy
              ? {
                  id: resolved.resolvedBy.databaseId,
                  login: resolved.resolvedBy.login,
                }
              : resolved?.isResolved
                ? { id: 0, login: "" }
                : null,
        };
      });
  }
  private discussionOf(r: PullRef, signal?: AbortSignal) {
    const key = this.pr(r);
    const known = this.lineDiscussion.get(key);
    if (known && Date.now() - known.at < 15_000) return known.value;
    const value = Promise.all([
      this.all<GithubReviewComment>(`${key}/comments`, signal),
      this.threads(r),
    ]);
    this.lineDiscussion.set(key, { at: Date.now(), value });
    value.catch(() => this.lineDiscussion.delete(key));
    if (this.lineDiscussion.size > 20)
      this.lineDiscussion.delete(this.lineDiscussion.keys().next().value!);
    return value;
  }
  /** Review threads, which only GraphQL knows; resolving is a thread's, not a comment's. */
  private async threads(r: PullRef): Promise<Thread[]> {
    const threads: Thread[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      type Answer = {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: {
                id: string;
                isResolved: boolean;
                resolvedBy: { login: string; databaseId: number } | null;
                comments: { nodes: { databaseId: number }[] };
              }[];
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
            };
          } | null;
        } | null;
      };
      const data: Answer = await this.graphql<Answer>(
        `query($owner: String!, $name: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $after) {
                nodes {
                  id isResolved
                  resolvedBy { login databaseId }
                  comments(first: 100) { nodes { databaseId } }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`,
        { owner: r.owner, name: r.name, number: r.number, after },
      );
      const found = data.repository?.pullRequest?.reviewThreads;
      if (!found) break;
      threads.push(
        ...found.nodes.map((t) => ({
          id: t.id,
          isResolved: t.isResolved,
          resolvedBy: t.resolvedBy,
          comments: t.comments.nodes.map((c) => c.databaseId),
        })),
      );
      if (!found.pageInfo.hasNextPage) break;
      after = found.pageInfo.endCursor;
    }
    return threads;
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
    this.lineDiscussion.delete(this.pr(r));
    const { data } = await this.request(
      `${this.pr(r)}/comments/${comment}/replies`,
      { method: "POST", body: { body } },
    );
    this.lineDiscussion.delete(this.pr(r));
    return data;
  }
  async resolveComment(r: PullRef, comment: number, resolved: boolean) {
    this.lineDiscussion.delete(this.pr(r));
    const thread = (await this.threads(r)).find((t) =>
      t.comments.includes(comment),
    );
    if (!thread) throw new Error("GitHub has no thread for this comment.");
    await this.graphql(
      `mutation($id: ID!) { ${resolved ? "resolveReviewThread" : "unresolveReviewThread"}(input: { threadId: $id }) { thread { id } } }`,
      { id: thread.id },
    );
    this.lineDiscussion.delete(this.pr(r));
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
  contentsAt(p: Pull, file: ChangedFile, signal?: AbortSignal) {
    // A fork's head commits are reachable from the base repository too.
    return filePair(p, file, async (sha, path) => {
      try {
        return (
          await this.request<string>(
            `${this.repo(p)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`,
            { raw: true, limit: signal ? 128 * 1024 : MAX_FILE, signal },
          )
        ).data;
      } catch (e) {
        // A submodule or symlink has no raw contents; show it as binary-like.
        if (e instanceof ApiError && e.status === 404) return "\0";
        throw e;
      }
    });
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
        "GitHub does not allow approving or requesting changes on your own PR. Choose Comment instead.",
      );
    const reviews = await this.all<Review>(`${this.pr(r)}/reviews`);
    if (
      reviews.some(
        (v) => v.state === "PENDING" && v.user?.id === this.account.user.id,
      )
    )
      throw new Error(
        "You already have a pending review on GitHub. Finish or discard it there first; your local drafts are preserved.",
      );
    if (drafts.some((d) => d.revision !== `${p.merge_base}:${head}`))
      throw new Error(
        "Some draft comments belong to an older revision. Re-anchor them before submitting.",
      );
    this.lineDiscussion.delete(this.pr(r));
    return asReview(
      (
        await this.request<Review>(`${this.pr(r)}/reviews`, {
          method: "POST",
          body: {
            body,
            commit_id: head,
            event: reviewEvents[event] ?? event,
            comments: drafts.map((d) => ({
              path: d.path,
              body: d.body,
              line: d.line,
              side: d.side === "deletions" ? "LEFT" : "RIGHT",
            })),
          },
        })
      ).data,
    );
  }
  async mergeReadiness(r: PullRef): Promise<MergeReadiness> {
    const p = (
      await this.request<
        GithubPull & { mergeable: boolean | null; mergeable_state: string }
      >(this.pr(r))
    ).data;
    const [compared, repository] = await Promise.all([
      this.request<{ behind_by: number }>(
        `${this.repo(r)}/compare/${encodeURIComponent(p.base.ref)}...${p.head.sha}?per_page=1`,
      ).catch(() => null),
      this.request<Partial<Record<`allow_${string}`, boolean>>>(this.repo(r)),
    ]);
    // The allow_ flags only come to those who may change them; missing, all are offered.
    const allowed = repository.data;
    return {
      status: githubMergeStatus(p.mergeable, p.mergeable_state),
      behind: compared?.data.behind_by ?? null,
      methods: (["squash", "merge", "rebase"] as const).filter(
        (m) =>
          allowed[`allow_${m === "merge" ? "merge_commit" : `${m}_merge`}`] !==
          false,
      ),
    };
  }
  async merge(r: PullRef, head: string, method: MergeMethod) {
    await this.request(`${this.pr(r)}/merge`, {
      method: "PUT",
      body: { sha: head, merge_method: method },
    });
  }
  async repository(r: Repo) {
    return (await this.request<RepositoryInfo>(this.repo(r))).data;
  }
  async hasRepository(r: Repo) {
    const found = await this.request<{ full_name: string }>(this.repo(r)).catch(
      (e: unknown) => {
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
    return this.all<{ name: string }>(`${this.repo(r)}/branches`);
  }
  /** The branch's tip, or null when the server has no such branch. */
  async branchHead(r: Repo, branch: string) {
    try {
      return (
        await this.request<{ commit: { sha: string } }>(
          `${this.repo(r)}/branches/${encodeURIComponent(branch)}`,
        )
      ).data.commit.sha;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }
  async createPull(
    r: Repo,
    input: { head: string; base: string; title: string; body: string },
    draft: boolean,
  ) {
    const p = (
      await this.request<GithubPull>(`${this.repo(r)}/pulls`, {
        method: "POST",
        body: { ...input, draft },
      })
    ).data;
    return { pull: asPull(p, ""), draftIgnored: false };
  }
  parseUrl(url: string) {
    return parseGithubPullUrl(url);
  }
}
