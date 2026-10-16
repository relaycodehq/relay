import type {
  Account,
  ChangedFile,
  Discussion,
  Draft,
  FilePair,
  Issue,
  Page,
  Pull,
  PullListing,
  PullRef,
  Repo,
  Review,
  ReviewComment,
} from "../../shared/types";

export type { PullListing };

/** A host's answer that wasn't OK, its status kept for callers that tell them apart. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type PullState = "open" | "closed" | "all";
export type SearchFilter = "review_requested" | "assigned" | "created" | "all";
export type FetchRequest = (
  url: string,
  options: RequestInit,
) => Promise<Response>;

/** A repository as its host describes it, for opening a pull request. */
export interface RepositoryInfo {
  full_name: string;
  default_branch: string;
  clone_url: string;
  ssh_url: string;
}

/**
 * Where a repository's pull requests live: GitHub, Gitea or Azure DevOps.
 * Each answers in Gitea's shapes, which the review was built on, so nothing
 * past the host's client cares which one it is.
 */
export interface PullHost {
  readonly account: Account;
  /** Cancels what's in flight, as when the sign-in goes away. */
  dispose(): void;
  /** A PR link on this host as a ref; throws for any other link. */
  parseUrl(url: string): PullRef;
  /** PRs you're part of, or ones matching `q`, across what you can see. */
  search(
    filter: SearchFilter,
    q: string,
    state: PullState,
    page: number,
  ): Promise<Page<Issue>>;
  pull(r: PullRef, signal?: AbortSignal): Promise<Pull>;
  /** The ref, or the commit itself, a clone fetches a PR's head commit by. */
  headRef(p: Pull): string;
  /** A page of the repository's pulls, newest first; entries may lack counts and the merge base. */
  pulls(
    r: Repo,
    state: PullState,
    page: number,
    signal?: AbortSignal,
    order?: "updated" | "created",
  ): Promise<Page<PullListing>>;
  /** Which of the repository's PRs `numbers` were merged. */
  mergedAmong(
    r: Repo,
    numbers: number[],
    signal: AbortSignal,
  ): Promise<number[]>;
  files(
    r: PullRef,
    page: number,
    signal?: AbortSignal,
  ): Promise<Page<ChangedFile>>;
  /** Paths that differ between two commits; null when the host can't say. */
  changedBetween(
    r: PullRef,
    from: string,
    to: string,
  ): Promise<string[] | null>;
  reviews(
    r: PullRef,
    page: number,
    signal?: AbortSignal,
  ): Promise<Page<Review>>;
  reviewComments(
    r: PullRef,
    review: number,
    signal?: AbortSignal,
  ): Promise<ReviewComment[]>;
  /** The PR's conversation: comments outside any review. */
  discussion(r: PullRef, page: number): Promise<Page<Discussion>>;
  comment(r: PullRef, body: string): Promise<unknown>;
  reply(r: PullRef, comment: number, body: string): Promise<unknown>;
  resolveComment(r: PullRef, comment: number, resolved: boolean): Promise<void>;
  /** A changed file's two sides, once the PR is still at `head` from `base`. */
  contents(
    r: PullRef,
    file: ChangedFile,
    head: string,
    base: string,
  ): Promise<FilePair>;
  contentsAt(
    p: Pull,
    file: ChangedFile,
    signal?: AbortSignal,
  ): Promise<FilePair>;
  submit(
    r: PullRef,
    head: string,
    event: string,
    body: string,
    drafts: Draft[],
  ): Promise<Review>;
  repository(r: Repo): Promise<RepositoryInfo>;
  /** Whether this sign-in sees `r` under that name; false for one it can't. */
  hasRepository(r: Repo): Promise<boolean>;
  branches(r: Repo): Promise<{ name: string }[]>;
  /** The branch's tip, or null when the host has no such branch. */
  branchHead(r: Repo, branch: string): Promise<string | null>;
  createPull(
    r: Repo,
    input: { head: string; base: string; title: string; body: string },
    draft: boolean,
  ): Promise<{ pull: Pull; draftIgnored: boolean }>;
}
