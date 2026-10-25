import type {
  Account,
  ChangedFile,
  Draft,
  FilePair,
  Issue,
  Page,
  Pull,
  PullRef,
  Repo,
  Review,
} from "../../../shared/types";
import type {
  MergeMethod,
  MergeReadiness,
} from "../../../shared/pull-readiness";
import { parseAzurePullUrl } from "../../../shared/validation";
import type { AzureCliToken } from "../../azure-devops/cli-token";
import { filePair } from "../file-pair";
import { HostRequests, responseMessage, type RequestOptions } from "../request";
import { branchRefs } from "./branches";
import { azureMerge, azureMergeReadiness } from "./merge";
import {
  ApiError,
  type FetchRequest,
  type PullHost,
  type PullListing,
  type PullState,
  type RepositoryInfo,
  type SearchFilter,
} from "../host";
import {
  asChangedFile,
  asIssue,
  asListedPull,
  asPull,
  asUser,
  azurePath,
  commentOf,
  discussionOf,
  isLineThread,
  lineCounts,
  reviewsOf,
  sha,
  threadComments,
  userId,
  voteFor,
  waitsOn,
  type AzChange,
  type AzIteration,
  type AzLineBlock,
  type AzPull,
  type AzThread,
  VERSION,
} from "./shapes";

/** File diffs are only served as a preview; without the flag Azure refuses them. */
const FILE_DIFFS_VERSION = "api-version=7.1-preview.1";
const MAX_FILE = 2 * 1024 * 1024;
const PAGE = 50;

/** `value`, or a cancellation as soon as `signal` aborts, leaving `value` running. */
function untilAborted<T>(value: Promise<T>, signal?: AbortSignal) {
  if (!signal) return value;
  const cancelled = () =>
    new Error("Request cancelled or timed out. Please retry.");
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener("abort", abort, { once: true });
    value
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** How many PRs a text search reads through, as Azure can't search them itself. */
const SCANNED = 1000;
/**
 * The threads a PR had before a submission that hasn't gone through yet, by
 * PR and head: a retry skips only what was posted since, not an older
 * comment that happens to say the same.
 */
const unfinished = new Map<string, Set<number>>();

/** Who the token is for, as Azure DevOps' connection data describes it. */
interface ConnectionData {
  authenticatedUser?: {
    id: string;
    providerDisplayName?: string;
    properties?: { Account?: { $value?: string } };
  };
}

/**
 * Pull requests in one Azure DevOps organization, signed in through `az`.
 * A repository's `owner` is its project. Answers in the shapes the Gitea
 * client gives, so the review doesn't care which host it is.
 */
export class AzureDevOps implements PullHost {
  private requests: HostRequests;
  /** A PR's threads, briefly: the review asks for each one's comments in turn. */
  private threadCache = new Map<
    string,
    { at: number; value: Promise<AzThread[]> }
  >();
  /** The newest PRs a text search reads, briefly: each keystroke filters the same read. */
  private scanned = new Map<
    PullState,
    { at: number; value: Promise<AzPull[]> }
  >();

  constructor(
    public account: Account,
    /** The signed-in identity, for votes and "is it mine". */
    private me: string,
    private token: () => Promise<AzureCliToken>,
    fetchRequest: FetchRequest,
    /** Tells the sign-in this client was refused, so the next one starts over. */
    private refused: () => void,
  ) {
    this.requests = new HostRequests(fetchRequest);
  }

  static async connect(
    server: string,
    token: () => Promise<AzureCliToken>,
    fetchRequest: FetchRequest,
    refused: () => void,
  ) {
    const client = new AzureDevOps(
      { id: server, server, user: { id: 0, login: "" }, persistent: true },
      "",
      token,
      fetchRequest,
      refused,
    );
    const who = (
      await client.request<ConnectionData>(`${server}/_apis/connectionData`)
    ).data.authenticatedUser;
    if (!who?.id) throw new Error("Azure DevOps didn't say who you are.");
    client.me = who.id;
    client.account.user = asUser({
      id: who.id,
      displayName: who.providerDisplayName,
      uniqueName: who.properties?.Account?.$value,
    });
    return client;
  }

  dispose() {
    this.requests.dispose();
  }

  request<T>(
    url: string,
    options: RequestOptions = {},
  ): Promise<{ data: T; headers: Headers }> {
    return this.requests.request<T>(
      url,
      {
        ...options,
        text: options.raw,
        tooLarge: options.raw
          ? "This file is too large for the inline viewer. Open it in Azure DevOps or your local editor."
          : "Azure DevOps returned more data than Relay can safely handle. Please retry.",
      },
      async (send) => {
        const credential = await this.token();
        const response = await send({
          Authorization: credential.header,
          Accept: options.raw ? "application/octet-stream" : "application/json",
        });
        const json = response.headers
          .get("content-type")
          ?.includes("application/json");
        // A refused sign-in can come as a 203 sign-in page instead of a 401.
        if (
          response.status === 401 ||
          response.status === 203 ||
          (response.ok && !options.raw && !json)
        ) {
          await response.body?.cancel();
          if (credential.rejected()) this.refused();
          throw new ApiError(
            401,
            "Azure DevOps rejected the Azure CLI sign-in. Run `az login` in a terminal, then try again.",
          );
        }
        if (!response.ok) {
          const message = await responseMessage(response);
          throw new ApiError(
            response.status,
            response.status === 404
              ? "Not found, or your Azure DevOps sign-in can't see this repository."
              : response.status === 429
                ? "Azure DevOps is rate limiting requests. Wait a moment, then retry."
                : response.status === 403
                  ? `Azure DevOps denied this${message ? `: ${message}` : "."}`
                  : message
                    ? `Azure DevOps refused this: ${message}`
                    : `Azure DevOps returned HTTP ${response.status}. Please retry.`,
          );
        }
        return response;
      },
    );
  }

  repoPath(r: Repo) {
    return `${this.account.server}/${encodeURIComponent(r.owner)}/_apis/git/repositories/${encodeURIComponent(r.name)}`;
  }

  prPath(r: PullRef) {
    return `${this.repoPath(r)}/pullrequests/${r.number}`;
  }

  parseUrl(url: string) {
    const ref = parseAzurePullUrl(url);
    if (ref.server?.toLowerCase() !== this.account.server.toLowerCase())
      throw new Error("This PR belongs to another Azure DevOps organization.");
    return ref;
  }

  /** PRs across the organization, or under `path`, newest first. */
  private async listed(
    criteria: Record<string, string>,
    state: PullState,
    page: number,
    {
      size = PAGE,
      path = "",
      signal,
    }: { size?: number; path?: string; signal?: AbortSignal } = {},
  ) {
    const read = (status: string, top: number, skip: number) =>
      this.listedAs(criteria, status, top, skip, path, signal);
    if (state !== "closed") {
      const found = await read(
        state === "open" ? "active" : "all",
        size,
        (page - 1) * size,
      );
      return {
        items: found,
        nextPage: found.length === size ? page + 1 : null,
      };
    }
    // Azure filters by one status at a time, and closed is both of the
    // others: each is read up to this page, so active PRs leave no gaps.
    const top = page * size;
    const [completed, abandoned] = await Promise.all([
      read("completed", top, 0),
      read("abandoned", top, 0),
    ]);
    const merged = [...completed, ...abandoned].sort(
      (a, b) =>
        b.creationDate.localeCompare(a.creationDate) ||
        b.pullRequestId - a.pullRequestId,
    );
    return {
      items: merged.slice(top - size, top),
      nextPage:
        merged.length > top ||
        completed.length === top ||
        abandoned.length === top
          ? page + 1
          : null,
    };
  }

  private async listedAs(
    criteria: Record<string, string>,
    status: string,
    top: number,
    skip: number,
    path: string,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(criteria).map(([k, v]) => [`searchCriteria.${k}`, v]),
      ),
      "searchCriteria.status": status,
      $top: String(top),
      $skip: String(skip),
    });
    const { data } = await this.request<{ value: AzPull[] }>(
      `${path || `${this.account.server}/_apis/git/pullrequests`}?${query}&${VERSION}`,
      { signal },
    );
    return data.value;
  }

  async search(
    filter: SearchFilter,
    q: string,
    state: PullState,
    page: number,
  ): Promise<Page<Issue>> {
    const issues = (items: AzPull[], nextPage: number | null) => ({
      items: items.map((p) => asIssue(this.account.server, p)),
      nextPage,
    });
    // Azure has no text search; the typed words narrow what it lists.
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (p: AzPull) => {
      const text = [
        p.title,
        `#${p.pullRequestId}`,
        p.repository.project.name,
        p.repository.name,
        p.createdBy.displayName,
        p.createdBy.uniqueName,
        p.sourceRefName,
      ]
        .join(" ")
        .toLowerCase();
      return words.every((w) => text.includes(w));
    };
    // Azure DevOps has no assignees, only reviewers.
    if (filter === "assigned") return { items: [], nextPage: null };
    if (filter === "review_requested") {
      const found = await this.listed({ reviewerId: this.me }, state, page);
      return issues(
        found.items.filter(
          (p) => (p.status !== "active" || waitsOn(p, this.me)) && matches(p),
        ),
        found.nextPage,
      );
    }
    if (filter === "created") {
      const found = await this.listed({ creatorId: this.me }, state, page);
      return issues(found.items.filter(matches), found.nextPage);
    }
    if (!q.trim()) {
      const [reviewing, created] = await Promise.all([
        this.listed({ reviewerId: this.me }, state, page),
        this.listed({ creatorId: this.me }, state, page),
      ]);
      const seen = new Set<number>();
      return issues(
        [...reviewing.items, ...created.items].filter(
          (p) => !seen.has(p.pullRequestId) && !!seen.add(p.pullRequestId),
        ),
        reviewing.nextPage ?? created.nextPage,
      );
    }
    // No text search for PRs in Azure: read through the newest ones instead.
    if (page > 1) return { items: [], nextPage: null };
    return issues((await this.scan(state)).filter(matches), null);
  }

  private scan(state: PullState) {
    const known = this.scanned.get(state);
    if (known && Date.now() - known.at < 30_000) return known.value;
    const value = (async () => {
      // Every status at once, filtered after: the scan isn't paged, so
      // active PRs leave no gaps in it.
      const status = state === "open" ? "active" : "all";
      const read = (page: number) =>
        this.listedAs({}, status, 100, (page - 1) * 100, "");
      const found = await read(1);
      // Past the first page, read ahead in doubling batches: a few requests
      // for an organization just over a page, few rounds for a big one.
      let next = 2;
      let batch = 1;
      let full = found.length === 100;
      while (full && next <= SCANNED / 100) {
        const pages = Array.from(
          { length: Math.min(batch, SCANNED / 100 - next + 1) },
          (_, i) => next + i,
        );
        const answers = await Promise.all(pages.map(read));
        for (const items of answers) found.push(...items);
        full = answers.every((items) => items.length === 100);
        next += pages.length;
        batch *= 2;
      }
      return found.filter((p) => state !== "closed" || p.status !== "active");
    })();
    this.scanned.set(state, { at: Date.now(), value });
    value.catch(() => {
      if (this.scanned.get(state)?.value === value) this.scanned.delete(state);
    });
    return value;
  }

  private async latestIteration(r: PullRef, signal?: AbortSignal) {
    const { data } = await this.request<{ value: AzIteration[] }>(
      `${this.prPath(r)}/iterations?includeCommits=false&${VERSION}`,
      { signal },
    );
    return { iterations: data.value, latest: data.value.at(-1) };
  }

  async azurePull(r: PullRef, signal?: AbortSignal) {
    return (
      await this.request<AzPull>(`${this.prPath(r)}?${VERSION}`, { signal })
    ).data;
  }

  async pull(r: PullRef, signal?: AbortSignal): Promise<Pull> {
    const [pr, { latest }] = await Promise.all([
      this.azurePull(r, signal),
      this.latestIteration(r, signal),
    ]);
    const pull = asPull(this.account.server, pr, latest);
    return latest
      ? { ...pull, changed_files: await this.changedCount(r, latest) }
      : pull;
  }

  private changedCounts = new Map<string, Promise<number>>();

  /**
   * How many files `files` lists for the iteration, which the review and
   * triage check against. An iteration never changes, so it's kept.
   */
  private changedCount(r: PullRef, at: AzIteration) {
    const key = `${this.prPath(r)}@${at.id}`;
    let known = this.changedCounts.get(key);
    if (!known) {
      known = (async () => {
        let count = 0;
        for (let skip = 0; ;) {
          const { data } = await this.request<{
            changeEntries: AzChange[];
            nextSkip?: number;
          }>(
            `${this.prPath(r)}/iterations/${at.id}/changes?$compareTo=0&$top=1000&$skip=${skip}&${VERSION}`,
          );
          count += data.changeEntries.filter((c) => asChangedFile(c)).length;
          if (!data.nextSkip) return count;
          skip = data.nextSkip;
        }
      })();
      this.changedCounts.set(key, known);
      known.catch(() => this.changedCounts.delete(key));
    }
    return known;
  }

  /**
   * Azure has no `refs/pull/N/head`, and no merge ref while a PR has
   * conflicts, but it serves any commit asked for. The head commit stays
   * right when the source branch lives in a fork, was deleted, or an
   * upstream branch shares its name.
   */
  headRef(p: Pull) {
    return p.head.sha || `refs/heads/${p.head.ref}`;
  }

  async pulls(
    r: Repo,
    state: PullState,
    page: number,
    signal?: AbortSignal,
  ): Promise<Page<PullListing>> {
    const found = await this.listed({}, state, page, {
      path: `${this.repoPath(r)}/pullrequests`,
      signal,
    });
    return {
      items: found.items.map((p) => asListedPull(this.account.server, p)),
      nextPage: found.nextPage,
    };
  }

  /** Asks after each PR: Azure lists closed ones by when they were opened. */
  async mergedAmong(r: Repo, numbers: number[], signal: AbortSignal) {
    const merged: number[] = [];
    for (const number of numbers) {
      const pr = await this.azurePull({ ...r, number }, signal);
      if (pr.status === "completed") merged.push(number);
    }
    return merged;
  }

  async files(
    r: PullRef,
    page: number,
    signal?: AbortSignal,
  ): Promise<Page<ChangedFile>> {
    const { latest } = await this.latestIteration(r, signal);
    if (!latest) return { items: [], nextPage: null };
    const size = 100;
    const { data } = await this.request<{
      changeEntries: AzChange[];
      nextSkip?: number;
    }>(
      `${this.prPath(r)}/iterations/${latest.id}/changes?$compareTo=0&$top=${size}&$skip=${(page - 1) * size}&${VERSION}`,
      { signal },
    );
    const files = data.changeEntries.flatMap((c) => asChangedFile(c) ?? []);
    await this.countLines(r, latest, files, signal);
    return { items: files, nextPage: data.nextSkip ? page + 1 : null };
  }

  /** Fills in each file's added and removed lines, which the change list doesn't carry. */
  private async countLines(
    r: Repo,
    at: AzIteration,
    files: ChangedFile[],
    signal?: AbortSignal,
  ) {
    for (let i = 0; i < files.length; i += 50) {
      const batch = files.slice(i, i + 50);
      try {
        const { data } = await this.request<{
          value: { path: string; lineDiffBlocks?: AzLineBlock[] }[];
        }>(`${this.repoPath(r)}/filediffs?${FILE_DIFFS_VERSION}`, {
          method: "POST",
          signal,
          body: {
            baseVersionCommit: sha(at.commonRefCommit),
            targetVersionCommit: sha(at.sourceRefCommit),
            fileDiffParams: batch.map((f) => ({
              path: azurePath(f.filename),
              originalPath: azurePath(f.previous_filename ?? f.filename),
            })),
          },
        });
        for (const diff of data.value) {
          const file = batch.find((f) => azurePath(f.filename) === diff.path);
          if (file) Object.assign(file, lineCounts(diff.lineDiffBlocks ?? []));
        }
      } catch (e) {
        // The counts are a nicety; the list stands without them.
        if (signal?.aborted || (e instanceof ApiError && e.status === 401))
          throw e;
      }
    }
  }

  /**
   * Paths that differ between two commits. Azure compares from the commits
   * themselves, so `from` must be behind `to`; null after a force-push.
   */
  async changedBetween(
    r: PullRef,
    from: string,
    to: string,
  ): Promise<string[] | null> {
    if (from === to) return [];
    try {
      const { data } = await this.request<{
        behindCount?: number;
        allChangesIncluded?: boolean;
        changes?: AzChange[];
      }>(
        `${this.repoPath(r)}/diffs/commits?baseVersion=${from}&baseVersionType=commit&targetVersion=${to}&targetVersionType=commit&diffCommonCommit=false&$top=2000&${VERSION}`,
      );
      if (data.behindCount || data.allChangesIncluded === false) return null;
      return [
        ...new Set(
          (data.changes ?? []).flatMap((c) => {
            const file = asChangedFile(c);
            return !file
              ? []
              : c.originalPath
                ? [c.originalPath.replace(/^\//, ""), file.filename]
                : [file.filename];
          }),
        ),
      ];
    } catch {
      return null;
    }
  }

  /** The PR's threads, positions tracked to its latest push. */
  private threads(r: PullRef, latest: number, signal?: AbortSignal) {
    const key = `${this.prPath(r)}@${latest}`;
    const known = this.threadCache.get(key);
    if (known && Date.now() - known.at < 15_000)
      return untilAborted(known.value, signal);
    // Shared by every view that asks within the window, so no one view's
    // cancellation may end it; each caller stops waiting on its own instead.
    const value = this.request<{ value: AzThread[] }>(
      `${this.prPath(r)}/threads?$iteration=${latest}&$baseIteration=0&${VERSION}`,
    ).then((r) => r.data.value);
    this.threadCache.set(key, { at: Date.now(), value });
    value.catch(() => {
      if (this.threadCache.get(key)?.value === value)
        this.threadCache.delete(key);
    });
    if (this.threadCache.size > 20)
      this.threadCache.delete(this.threadCache.keys().next().value!);
    return untilAborted(value, signal);
  }

  private forget(r: PullRef) {
    for (const key of this.threadCache.keys())
      if (key.startsWith(`${this.prPath(r)}@`)) this.threadCache.delete(key);
  }

  /** Everything the review reads about a PR's discussion, in one go. */
  private async discussed(r: PullRef, signal?: AbortSignal) {
    const [pr, { iterations, latest }] = await Promise.all([
      this.azurePull(r, signal),
      this.latestIteration(r, signal),
    ]);
    const threads = latest ? await this.threads(r, latest.id, signal) : [];
    return { pr, iterations, threads, head: sha(latest?.sourceRefCommit) };
  }

  async reviews(r: PullRef, _page: number, signal?: AbortSignal) {
    const { pr, iterations, threads, head } = await this.discussed(r, signal);
    return { items: reviewsOf(pr, threads, iterations, head), nextPage: null };
  }

  async reviewComments(r: PullRef, review: number, signal?: AbortSignal) {
    const { pr, threads, head } = await this.discussed(r, signal);
    const thread = threads.find((t) => t.id === review);
    return thread && isLineThread(thread)
      ? threadComments(this.account.server, pr, thread, head)
      : [];
  }

  async discussion(r: PullRef, _page: number) {
    const { pr, threads } = await this.discussed(r);
    return {
      items: discussionOf(this.account.server, pr, threads),
      nextPage: null,
    };
  }

  /** A new thread outside any file, active as Azure DevOps starts them. */
  async comment(r: PullRef, body: string) {
    this.forget(r);
    return (
      await this.request(`${this.prPath(r)}/threads?${VERSION}`, {
        method: "POST",
        body: {
          comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
          status: "active",
        },
      })
    ).data;
  }

  async reply(r: PullRef, comment: number, body: string) {
    const at = commentOf(comment);
    this.forget(r);
    return (
      await this.request(
        `${this.prPath(r)}/threads/${at.thread}/comments?${VERSION}`,
        {
          method: "POST",
          body: { parentCommentId: at.comment, content: body, commentType: 1 },
        },
      )
    ).data;
  }

  /** Resolving is a thread's: fixed, or active again. */
  async resolveComment(r: PullRef, comment: number, resolved: boolean) {
    this.forget(r);
    await this.request(
      `${this.prPath(r)}/threads/${commentOf(comment).thread}?${VERSION}`,
      { method: "PATCH", body: { status: resolved ? "fixed" : "active" } },
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

  contentsAt(p: Pull, file: ChangedFile, signal?: AbortSignal) {
    return filePair(p, file, async (commit, path) => {
      const query = new URLSearchParams({
        path: azurePath(path),
        "versionDescriptor.version": commit,
        "versionDescriptor.versionType": "commit",
        $format: "octetStream",
        download: "true",
      });
      try {
        return (
          await this.request<string>(
            `${this.repoPath(p)}/items?${query}&${VERSION}`,
            { raw: true, limit: signal ? 128 * 1024 : MAX_FILE, signal },
          )
        ).data;
      } catch (e) {
        // A submodule has no contents to read; show it as binary-like.
        if (file.submodule && e instanceof ApiError && e.status === 404)
          return "\0";
        throw e;
      }
    });
  }

  /**
   * Posts each draft as a thread, the body as a comment and the verdict as
   * a vote. Azure takes them one by one, so a retry after a failure skips
   * what an earlier attempt already posted rather than doubling it.
   */
  async submit(
    r: PullRef,
    head: string,
    event: string,
    body: string,
    drafts: Draft[],
  ): Promise<Review> {
    const [pr, { latest }] = await Promise.all([
      this.azurePull(r),
      this.latestIteration(r),
    ]);
    const p = asPull(this.account.server, pr, latest);
    if (!latest || p.head.sha !== head)
      throw new Error(
        "A new commit arrived. Refresh and review it before submitting.",
      );
    if (p.state !== "open")
      throw new Error(
        "This pull request is closed. You can still add to the conversation.",
      );
    if (drafts.some((d) => d.revision !== `${p.merge_base}:${head}`))
      throw new Error(
        "Some draft comments belong to an older revision. Re-anchor them before submitting.",
      );
    this.forget(r);
    const threads = await this.threads(r, latest.id);
    const attempt = `${this.prPath(r)}@${head}`;
    const before = unfinished.get(attempt) ?? new Set(threads.map((t) => t.id));
    unfinished.set(attempt, before);
    const posted = threads.filter((t) => !before.has(t.id));
    const mine = (t: AzThread, content: string) =>
      !t.isDeleted &&
      t.comments[0]?.author.id === this.me &&
      t.comments[0]?.content === content;
    const tracking = drafts.length ? await this.trackingIds(r, latest) : {};
    let sent = 0;
    try {
      for (const d of drafts) {
        const side = d.side === "deletions" ? "left" : "right";
        const at = { line: d.line, offset: 1 };
        const already = posted.some(
          (t) =>
            mine(t, d.body) &&
            t.threadContext?.filePath === azurePath(d.path) &&
            t.threadContext[`${side}FileStart`]?.line === d.line,
        );
        if (already) continue;
        await this.request(`${this.prPath(r)}/threads?${VERSION}`, {
          method: "POST",
          body: {
            comments: [{ parentCommentId: 0, content: d.body, commentType: 1 }],
            status: "active",
            threadContext: {
              filePath: azurePath(d.path),
              [`${side}FileStart`]: at,
              [`${side}FileEnd`]: at,
            },
            pullRequestThreadContext: {
              // Equal iterations mean Azure's common-commit comparison, the
              // merge base against the latest push that the drafts were made on.
              iterationContext: {
                firstComparingIteration: latest.id,
                secondComparingIteration: latest.id,
              },
              ...(tracking[d.path]
                ? { changeTrackingId: tracking[d.path] }
                : {}),
            },
          },
        });
        sent++;
      }
      if (body.trim() && !posted.some((t) => !t.threadContext && mine(t, body)))
        await this.comment(r, body);
      const vote = voteFor(event);
      if (vote !== null)
        await this.request(
          `${this.prPath(r)}/reviewers/${encodeURIComponent(this.me)}?${VERSION}`,
          { method: "PUT", body: { vote } },
        );
    } catch (e) {
      throw new Error(
        `${sent ? `${sent} of the comments were posted; submitting again posts only the rest. ` : ""}${(e as Error).message}`,
      );
    } finally {
      this.forget(r);
    }
    unfinished.delete(attempt);
    const vote = voteFor(event);
    return {
      id: vote === null ? 0 : 2 ** 40 + userId(this.me),
      body,
      state: vote === null ? "COMMENT" : event,
      user: this.account.user,
      submitted_at: new Date().toISOString(),
      commit_id: head,
    };
  }

  mergeReadiness(r: PullRef): Promise<MergeReadiness> {
    return azureMergeReadiness(this, r);
  }

  /** The waits between looks at a completion; see `azureMerge`. */
  completionChecks = [1000, 1000, 2000, 2000, 4000];

  merge(r: PullRef, head: string, method: MergeMethod) {
    this.forget(r);
    return azureMerge(this, r, head, method);
  }

  /** Which change each path is in the latest push, which Azure anchors new threads to. */
  private async trackingIds(r: PullRef, latest: AzIteration) {
    const ids: Record<string, number> = {};
    for (let skip = 0; skip < 20_000;) {
      const { data } = await this.request<{
        changeEntries: AzChange[];
        nextSkip?: number;
      }>(
        `${this.prPath(r)}/iterations/${latest.id}/changes?$compareTo=0&$top=2000&$skip=${skip}&${VERSION}`,
      );
      for (const c of data.changeEntries) {
        const file = asChangedFile(c);
        if (file && c.changeTrackingId) ids[file.filename] = c.changeTrackingId;
      }
      if (!data.nextSkip) break;
      skip = data.nextSkip;
    }
    return ids;
  }

  async repository(r: Repo): Promise<RepositoryInfo> {
    const { data } = await this.request<{
      name: string;
      project: { name: string };
      defaultBranch?: string;
      remoteUrl: string;
      sshUrl: string;
    }>(`${this.repoPath(r)}?${VERSION}`);
    return {
      full_name: `${data.project.name}/${data.name}`,
      default_branch: (data.defaultBranch ?? "refs/heads/main").replace(
        /^refs\/heads\//,
        "",
      ),
      clone_url: data.remoteUrl,
      ssh_url: data.sshUrl,
    };
  }

  async hasRepository(r: Repo) {
    try {
      const found = await this.repository(r);
      return (
        found.full_name.toLowerCase() === `${r.owner}/${r.name}`.toLowerCase()
      );
    } catch (e) {
      if (e instanceof ApiError && [403, 404].includes(e.status)) return false;
      throw e;
    }
  }

  async branches(r: Repo) {
    return (await branchRefs(this, r, "")).map((ref) => ({
      name: ref.name.replace(/^refs\/heads\//, ""),
    }));
  }

  /** The branch's tip, or null when Azure has no such branch. */
  async branchHead(r: Repo, branch: string) {
    // The filter matches by prefix, so `main` also finds `main-old`.
    const ref = (await branchRefs(this, r, branch)).find(
      (h) => h.name === `refs/heads/${branch}`,
    );
    return ref ? ref.objectId.toLowerCase() : null;
  }

  async createPull(
    r: Repo,
    input: { head: string; base: string; title: string; body: string },
    draft: boolean,
  ) {
    const { data } = await this.request<AzPull>(
      `${this.repoPath(r)}/pullrequests?${VERSION}`,
      {
        method: "POST",
        body: {
          sourceRefName: `refs/heads/${input.head}`,
          targetRefName: `refs/heads/${input.base}`,
          title: input.title,
          description: input.body,
          isDraft: draft,
        },
      },
    );
    return { pull: asPull(this.account.server, data), draftIgnored: false };
  }
}
