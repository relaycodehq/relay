// Azure DevOps' pull request answers, and how they read in the Gitea shapes
// the rest of Relay speaks. Azure has no reviews: a reviewer votes, and line
// comments are threads, so each file thread reads as Gitea files a lone line
// comment, a body-less COMMENT review, and each vote as a verdict.
import type {
  ChangedFile,
  Discussion,
  Issue,
  Pull,
  PullListing,
  Review,
  ReviewComment,
} from "../../../shared/types";
import { pullWebUrl } from "../../../shared/source-control";

export interface AzIdentity {
  id: string;
  displayName?: string;
  uniqueName?: string;
  isContainer?: boolean;
}
export interface AzReviewer extends AzIdentity {
  /** 10 approved, 5 with suggestions, 0 none, -5 waiting for author, -10 rejected. */
  vote: number;
  hasDeclined?: boolean;
}
interface AzRepository {
  id: string;
  name: string;
  project: { id: string; name: string };
  remoteUrl?: string;
  sshUrl?: string;
  defaultBranch?: string;
}
export interface AzPull {
  pullRequestId: number;
  status: "active" | "abandoned" | "completed" | "notSet";
  title: string;
  description?: string;
  createdBy: AzIdentity;
  creationDate: string;
  closedDate?: string;
  isDraft?: boolean;
  sourceRefName: string;
  targetRefName: string;
  lastMergeSourceCommit?: { commitId: string };
  lastMergeTargetCommit?: { commitId: string };
  reviewers?: AzReviewer[];
  labels?: { id: string; name: string; active?: boolean }[];
  repository: AzRepository;
  forkSource?: { repository?: AzRepository };
}
/** One push to the PR's branch, with where it and its target stood. */
export interface AzIteration {
  id: number;
  createdDate?: string;
  updatedDate?: string;
  sourceRefCommit: { commitId: string };
  targetRefCommit: { commitId: string };
  commonRefCommit?: { commitId: string };
}
export interface AzChange {
  changeTrackingId?: number;
  changeType: string;
  originalPath?: string;
  item?: { path?: string; isFolder?: boolean; gitObjectType?: string };
}
export interface AzLineBlock {
  /** `add`, `delete` or `edit`; the numeric enum (1, 2, 3) in some responses. */
  changeType: string | number;
  originalLinesCount: number;
  modifiedLinesCount: number;
}
interface AzPosition {
  line: number;
  offset: number;
}
export interface AzComment {
  id: number;
  parentCommentId: number;
  content?: string;
  commentType: string;
  author: AzIdentity;
  publishedDate: string;
  isDeleted?: boolean;
}
export interface AzThread {
  id: number;
  status?: string;
  publishedDate: string;
  isDeleted?: boolean;
  threadContext?: {
    filePath: string;
    rightFileStart?: AzPosition;
    rightFileEnd?: AzPosition;
    leftFileStart?: AzPosition;
    leftFileEnd?: AzPosition;
  } | null;
  properties?: Record<string, { $value?: unknown } | undefined>;
  comments: AzComment[];
}

/**
 * A stable number for an Azure identity, whose ids are GUIDs where Gitea's
 * are numbers. Votes, authors and "is this mine" only compare them.
 */
export function userId(guid: string) {
  let hash = 0x811c9dc5;
  for (const c of guid.toLowerCase()) {
    hash ^= c.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) + 1;
}
export const asUser = (who: AzIdentity) => ({
  id: userId(who.id),
  login: who.uniqueName || who.displayName || "",
  ...(who.displayName ? { full_name: who.displayName } : {}),
});

/** Comments are numbered within their thread; Relay's one number carries both. */
const PER_THREAD = 1000;
export const commentId = (thread: number, comment: number) =>
  thread * PER_THREAD + comment;
export const commentOf = (id: number) => ({
  thread: Math.floor(id / PER_THREAD),
  comment: id % PER_THREAD,
});
/** Above every thread id, so a vote's review never reads as a thread's. */
const voteId = (who: AzIdentity) => 2 ** 40 + userId(who.id);

const branch = (ref: string) => ref.replace(/^refs\/heads\//, "");
export const sha = (commit?: { commitId: string }) =>
  commit?.commitId.toLowerCase() ?? "";
/** A file path as Azure names it, from the root with a leading slash. */
export const azurePath = (path: string) => `/${path}`;
const relayPath = (path: string) => path.replace(/^\//, "");

const repoOf = (r: AzRepository) => ({
  owner: { id: 0, login: r.project.name },
  name: r.name,
  full_name: `${r.project.name}/${r.name}`,
  clone_url: r.remoteUrl ?? "",
});

const webUrl = (server: string, pr: AzPull) =>
  pullWebUrl({
    server,
    owner: pr.repository.project.name,
    name: pr.repository.name,
    number: pr.pullRequestId,
  });

/**
 * The PR as Gitea lists one, which Azure's PRs can't say how much they change;
 * the iteration, when read, says where it stands now.
 */
export function asListedPull(
  server: string,
  pr: AzPull,
  iteration?: AzIteration,
): PullListing {
  return {
    server,
    owner: pr.repository.project.name,
    name: pr.repository.name,
    number: pr.pullRequestId,
    id: pr.pullRequestId,
    title: pr.title,
    body: pr.description ?? "",
    state: pr.status === "active" ? "open" : "closed",
    draft: !!pr.isDraft,
    merged: pr.status === "completed",
    html_url: webUrl(server, pr),
    head: {
      ref: branch(pr.sourceRefName),
      sha: sha(iteration?.sourceRefCommit ?? pr.lastMergeSourceCommit),
      repo: repoOf(pr.forkSource?.repository ?? pr.repository),
    },
    base: {
      ref: branch(pr.targetRefName),
      sha: sha(iteration?.targetRefCommit ?? pr.lastMergeTargetCommit),
      repo: repoOf(pr.repository),
    },
    merge_base: sha(iteration?.commonRefCommit),
    user: asUser(pr.createdBy),
    updated_at:
      pr.closedDate ??
      iteration?.updatedDate ??
      iteration?.createdDate ??
      pr.creationDate,
    labels: labelsOf(pr),
    comments: 0,
  };
}

/** The PR as Gitea gives one. Azure doesn't count lines on it, and the client counts its files. */
export const asPull = (
  server: string,
  pr: AzPull,
  iteration?: AzIteration,
): Pull => ({
  ...asListedPull(server, pr, iteration),
  additions: 0,
  deletions: 0,
  changed_files: 0,
});

const labelsOf = (pr: AzPull) =>
  (pr.labels ?? [])
    .filter((l) => l.active !== false)
    .map((l) => ({ id: userId(l.id), name: l.name, color: "" }));

export function asIssue(
  server: string,
  pr: AzPull,
): Issue & { draft: boolean } {
  return {
    id: pr.pullRequestId,
    number: pr.pullRequestId,
    title: pr.title,
    body: pr.description ?? "",
    state: pr.status === "active" ? "open" : "closed",
    draft: !!pr.isDraft,
    html_url: webUrl(server, pr),
    // Listings carry no date of the last push or comment, only the PR's
    // iterations do, so an open PR sorts by when it was opened.
    updated_at: pr.closedDate ?? pr.creationDate,
    user: asUser(pr.createdBy),
    repository: {
      owner: pr.repository.project.name,
      name: pr.repository.name,
      full_name: `${pr.repository.project.name}/${pr.repository.name}`,
      server,
    },
    labels: labelsOf(pr),
    comments: 0,
    pull_request: { merged: pr.status === "completed" },
  };
}

/** Whether `me` was asked to review and hasn't voted or declined yet. */
export const waitsOn = (pr: AzPull, me: string) =>
  !!pr.reviewers?.some((r) => r.id === me && r.vote === 0 && !r.hasDeclined);

/** A changed file as Gitea lists one, its line counts filled in later. */
export function asChangedFile(change: AzChange): ChangedFile | null {
  const path = change.item?.path;
  if (!path || change.item?.isFolder || change.item?.gitObjectType === "tree")
    return null;
  const type = change.changeType.toLowerCase();
  const status = type.includes("delete")
    ? "deleted"
    : type.includes("add")
      ? "added"
      : type.includes("rename")
        ? "renamed"
        : "modified";
  return {
    filename: relayPath(path),
    ...(status === "renamed" && change.originalPath
      ? { previous_filename: relayPath(change.originalPath) }
      : {}),
    ...(change.item?.gitObjectType === "commit" ? { submodule: true } : {}),
    status,
    additions: 0,
    deletions: 0,
    changes: 0,
  };
}

/** Lines added and removed, from a file diff's blocks. */
export function lineCounts(blocks: AzLineBlock[]) {
  let additions = 0,
    deletions = 0;
  for (const b of blocks) {
    const type =
      typeof b.changeType === "number"
        ? ["none", "add", "delete", "edit"][b.changeType]
        : b.changeType.toLowerCase();
    if (type === "add" || type === "edit") additions += b.modifiedLinesCount;
    if (type === "delete" || type === "edit") deletions += b.originalLinesCount;
  }
  return { additions, deletions, changes: additions + deletions };
}

const said = (t: AzThread) =>
  t.comments.filter(
    (c) => c.commentType === "text" && !c.isDeleted && c.content?.trim(),
  );
const property = (t: AzThread, key: string) => t.properties?.[key]?.$value;
const resolved = (t: AzThread) =>
  !!t.status && !["active", "pending", "unknown"].includes(t.status);

/** A thread on a file's lines with something said in it. */
export const isLineThread = (t: AzThread) =>
  !t.isDeleted && !!t.threadContext?.filePath && said(t).length > 0;

/** The commit each iteration's push left the branch at, by when it came. */
function commitAt(iterations: AzIteration[], at: string) {
  const time = Date.parse(at);
  let found = iterations[0];
  for (const i of iterations)
    if (Date.parse(i.createdDate ?? "") <= time) found = i;
  return sha(found?.sourceRefCommit);
}

/**
 * The PR's reviews: a body-less COMMENT for each line thread, and each
 * reviewer's standing vote as APPROVED or REQUEST_CHANGES, dated by the vote
 * Azure logged and set on the commit the branch was at then.
 */
export function reviewsOf(
  pr: AzPull,
  threads: AzThread[],
  iterations: AzIteration[],
  head: string,
): Review[] {
  const lines: Review[] = threads.filter(isLineThread).map((t) => ({
    id: t.id,
    body: "",
    state: "COMMENT",
    user: asUser(said(t)[0].author),
    submitted_at: t.publishedDate,
    commit_id: head,
    comments_count: said(t).length,
  }));
  const votes: Review[] = (pr.reviewers ?? [])
    .filter((r) => r.vote !== 0 && !r.isContainer)
    .map((r) => {
      const logged = threads
        .filter(
          (t) =>
            property(t, "CodeReviewThreadType") === "VoteUpdate" &&
            t.comments[0]?.author.id === r.id,
        )
        .at(-1);
      const at = logged?.publishedDate ?? pr.creationDate;
      return {
        id: voteId(r),
        body: "",
        state: r.vote > 0 ? "APPROVED" : "REQUEST_CHANGES",
        user: asUser(r),
        submitted_at: at,
        commit_id: commitAt(iterations, at),
        comments_count: 0,
      };
    });
  return [...lines, ...votes];
}

/**
 * A line thread's comments, all on the head: threads are read tracked to the
 * latest push, as Azure DevOps itself shows them.
 */
export function threadComments(
  server: string,
  pr: AzPull,
  thread: AzThread,
  head: string,
): ReviewComment[] {
  const where = thread.threadContext!;
  const right = where.rightFileEnd ?? where.rightFileStart;
  const left = where.leftFileEnd ?? where.leftFileStart;
  return said(thread).map((c) => ({
    id: commentId(thread.id, c.id),
    body: c.content ?? "",
    path: relayPath(where.filePath),
    position: right?.line ?? 0,
    original_position: right ? 0 : (left?.line ?? 0),
    commit_id: head,
    user: asUser(c.author),
    created_at: c.publishedDate,
    html_url: `${webUrl(server, pr)}?discussionId=${thread.id}`,
    pull_request_review_id: thread.id,
    resolver: resolved(thread) ? { id: 0, login: "" } : null,
  }));
}

/** Comments outside any file, oldest first: the PR's conversation. */
export function discussionOf(
  server: string,
  pr: AzPull,
  threads: AzThread[],
): Discussion[] {
  return threads
    .filter((t) => !t.isDeleted && !t.threadContext?.filePath)
    .flatMap((t) =>
      said(t).map((c) => ({
        id: commentId(t.id, c.id),
        body: c.content ?? "",
        user: asUser(c.author),
        created_at: c.publishedDate,
        html_url: `${webUrl(server, pr)}?discussionId=${t.id}`,
      })),
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** Gitea's review events as Azure votes; a plain comment leaves the vote alone. */
export const voteFor = (event: string) =>
  event === "APPROVED" ? 10 : event === "REQUEST_CHANGES" ? -5 : null;
