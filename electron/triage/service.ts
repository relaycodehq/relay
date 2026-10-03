import { randomUUID } from "node:crypto";
import type { Gitea } from "../pull-requests/gitea";
import type { Store } from "../app/store";
import type { ChangedFile, PullRef, Review, Page } from "../../shared/types";
import { revisionOf } from "../../shared/types";
import {
  TRIAGE_VERSION,
  notedPaths,
  type TriageState,
  type TriageResult,
} from "../../shared/triage";
import { filePathSchema } from "../../shared/validation";
import { ResponseTooLarge } from "../../shared/http";
import {
  prepareCandidate,
  addRelatedChanges,
  takeBatch,
  type Candidate,
} from "./evidence";
import { classifyChanges } from "./classifier";
import {
  freshCheckpoint,
  groupId,
  pendingWork,
  remainingPaths,
  resumable,
  readAnalysis,
  saveAnalysis,
  restoreState,
  type Checkpoint,
  type SavedAnalysis,
} from "./checkpoint";

const freshUsage = () => ({ inputTokens: 0, outputTokens: 0, batches: 0 });
const defaults = {
  inputTokens: 700_000,
  batches: 40,
  evidenceChars: 2_000_000,
  retries: 1,
};
class RevisionChanged extends Error {}

export class TriageService {
  private active?: {
    key: string;
    state: TriageState;
    controller: AbortController;
  };
  private last?: { key: string; state: TriageState };
  private starting = false;
  private limits: typeof defaults;
  constructor(
    private store: Store,
    private dataDir: string,
    private classify = classifyChanges,
    limits: Partial<typeof defaults> = {},
  ) {
    this.limits = { ...defaults, ...limits };
  }
  cancel() {
    this.active?.controller.abort();
  }
  async state(key: string, revision: string): Promise<TriageState | null> {
    const live =
      this.active?.key === key
        ? this.active.state
        : this.last?.key === key
          ? this.last.state
          : undefined;
    if (live?.revision === revision) return live;
    const saved = await readAnalysis(this.dataDir, key, revision);
    return saved ? restoreState(saved) : null;
  }
  async start(
    client: Gitea,
    ref: PullRef,
    key: string,
    head: string,
    base: string,
  ) {
    if (this.active || this.starting)
      throw new Error(
        "Another PR is being analyzed. Pause that analysis or let it finish first.",
      );
    this.starting = true;
    try {
      const settings = this.store.aiSettings();
      const choice = {
        ...settings.grouping,
        provider: settings.groupingProvider,
      };
      const revision = `${base}:${head}`;
      const previous = await readAnalysis(this.dataDir, key, revision);
      const saved =
        previous && remainingPaths(previous.checkpoint).length
          ? previous
          : undefined;
      const state: TriageState = saved
        ? { ...restoreState(saved), id: randomUUID(), status: "scanning" }
        : {
            ...choice,
            id: randomUUID(),
            revision,
            status: "scanning",
            scanned: 0,
            total: 0,
            checked: 0,
            candidates: 0,
            usage: freshUsage(),
          };
      const controller = new AbortController();
      this.active = { key, state, controller };
      this.last = { key, state };
      void this.run(client, ref, key, state, controller.signal, saved)
        .catch((e) => {
          state.status = "failed";
          state.error =
            e instanceof Error
              ? e.message
              : "Analysis stopped. The last saved checkpoint is preserved.";
        })
        .finally(() => {
          if (this.active?.state === state) this.active = undefined;
        });
      return state;
    } finally {
      this.starting = false;
    }
  }
  async protectedPaths(
    client: Gitea,
    ref: PullRef,
    key: string,
    revision: string,
    signal?: AbortSignal,
  ) {
    const protectedPaths = new Set(
      notedPaths(this.store.get().progress[key], revision),
    );
    for (let page: number | null = 1, count = 0; page !== null;) {
      signal?.throwIfAborted();
      if (++count > 40)
        throw new Error(
          "Review history is too large to check discussions safely. Review these files normally.",
        );
      const reviews: Page<Review> = await client.reviews(ref, page, signal);
      for (const review of reviews.items) {
        signal?.throwIfAborted();
        if (review.comments_count === 0) continue;
        const data = await client.reviewComments(ref, review.id, signal);
        if (!Array.isArray(data) || review.comments_count > data.length)
          throw new Error(
            "Could not load the complete line discussions. Grouping is unavailable until they can be checked.",
          );
        for (const comment of data)
          if (comment.path && !comment.resolver)
            protectedPaths.add(comment.path);
      }
      page = reviews.nextPage;
    }
    return protectedPaths;
  }
  async groupPaths(
    client: Gitea,
    ref: PullRef,
    key: string,
    head: string,
    base: string,
    id: string,
  ) {
    const revision = `${base}:${head}`,
      state = await this.state(key, revision);
    const group = state?.result?.groups.find((g) => g.id === id);
    if (!group)
      throw new Error(
        "This group is no longer available. Analyze the current revision again.",
      );
    if (revisionOf(await client.pull(ref)) !== revision)
      throw new Error(
        "This PR has new commits. Refresh before marking a group viewed.",
      );
    const protectedPaths = await this.protectedPaths(
      client,
      ref,
      key,
      revision,
    );
    const paths = group.paths.filter((p) => !protectedPaths.has(p));
    if (!paths.length)
      throw new Error(
        "These files have discussions, drafts or bookmarks. Review them individually.",
      );
    return paths;
  }
  private async run(
    client: Gitea,
    ref: PullRef,
    key: string,
    state: TriageState,
    signal: AbortSignal,
    previous?: SavedAnalysis,
  ) {
    const p = await client.pull(ref, signal);
    const verifyRevision = async () => {
      if (revisionOf(await client.pull(ref, signal)) !== state.revision)
        throw new RevisionChanged(
          "New commits arrived. This checkpoint is saved for the previous revision; refresh the PR before analyzing its new changes.",
        );
    };
    if (revisionOf(p) !== state.revision)
      throw new RevisionChanged(
        "This PR changed. Refresh before resuming analysis.",
      );
    const files: ChangedFile[] = [];
    for (let page: number | null = 1; page !== null;) {
      signal.throwIfAborted();
      const next: Page<ChangedFile> = await client.files(ref, page, signal);
      for (const f of next.items) filePathSchema.parse(f.filename);
      files.push(...next.items);
      page = next.nextPage;
      if (files.length > 1000 || (page !== null && next.items.length === 0))
        throw new Error(
          "This PR exceeds the 1,000-file analysis limit. Files can still be reviewed normally.",
        );
    }
    if (
      new Set(files.map((f) => f.filename)).size !== files.length ||
      (p.changed_files != null && p.changed_files !== files.length)
    )
      throw new Error(
        "The complete file list could not be verified. Refresh the PR and retry.",
      );
    if (
      previous &&
      JSON.stringify(previous.result.files) !== JSON.stringify(files)
    ) {
      // Metadata ordering may differ, but the immutable paths/statuses must agree.
      const identity = (list: ChangedFile[]) =>
        list
          .map((f) =>
            JSON.stringify([f.filename, f.previous_filename, f.status]),
          )
          .sort()
          .join("\n");
      if (identity(previous.result.files) !== identity(files))
        throw new Error(
          "The saved checkpoint's file list does not match this PR. It has been preserved.",
        );
    }
    const checkpoint =
      previous?.checkpoint ?? freshCheckpoint(files.map((f) => f.filename));
    let protectedPaths = await this.protectedPaths(
      client,
      ref,
      key,
      state.revision,
      signal,
    );
    const usage = { ...(previous?.result.usage ?? freshUsage()) };
    const startedUsage = { ...usage };
    const candidates = new Map(checkpoint.candidates.map((c) => [c.path, c]));
    const fileMap = new Map(files.map((f) => [f.filename, f]));
    const checkedBudget = () =>
      usage.batches - startedUsage.batches >= this.limits.batches ||
      usage.inputTokens - startedUsage.inputTokens >= this.limits.inputTokens;
    let budgetReached = false;
    const publish = async (stop?: Checkpoint["stop"]) => {
      checkpoint.stop = stop;
      const result = this.result(
        files,
        checkpoint,
        state.revision,
        usage,
        protectedPaths,
        state.model!,
        state.fast ?? false,
        state.reasoningEffort ?? "medium",
        state.provider ?? "codex",
      );
      await saveAnalysis(this.dataDir, key, { result, checkpoint });
      state.result = result;
      state.usage = { ...usage };
      state.total = files.length;
      state.scanned = files.length - checkpoint.scanPending.length;
      state.resume = resumable(checkpoint);
    };
    const skip = (path: string, reason: string) => {
      checkpoint.skipped[path] = reason;
      checkpoint.scanPending = checkpoint.scanPending.filter((p) => p !== path);
      delete checkpoint.failures[path];
    };
    await publish("interrupted");
    try {
      state.status = "scanning";
      let evidenceChars = 0;
      // Each save rewrites the whole checkpoint, which grows with every file,
      // so save at most once a second; a crash repeats only that second.
      let saved = Date.now();
      for (const path of [...checkpoint.scanPending]) {
        signal.throwIfAborted();
        if (evidenceChars >= this.limits.evidenceChars) {
          budgetReached = true;
          break;
        }
        if (protectedPaths.has(path))
          skip(path, "Has a discussion, draft or bookmark");
        else {
          try {
            const evidence = prepareCandidate(
              fileMap.get(path)!,
              await client.contentsAt(p, fileMap.get(path)!, signal),
            );
            if (typeof evidence === "string") skip(path, evidence);
            else {
              evidenceChars += evidence.evidence.length;
              candidates.set(path, evidence);
              checkpoint.candidates.push(evidence);
              checkpoint.scanPending = checkpoint.scanPending.filter(
                (p) => p !== path,
              );
              delete checkpoint.failures[path];
            }
          } catch (e) {
            signal.throwIfAborted();
            const reason =
              e instanceof Error
                ? e.message.slice(0, 1000)
                : "File could not be analyzed";
            if (e instanceof ResponseTooLarge) skip(path, reason);
            else checkpoint.failures[path] = { stage: "scan", reason };
          }
        }
        state.scanned = files.length - checkpoint.scanPending.length;
        if (Date.now() - saved >= 1000) {
          await publish("interrupted");
          saved = Date.now();
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await publish("interrupted");
      const packets = new Map(
        [...candidates.values()].map((c) => [
          c.path,
          addRelatedChanges(c, candidates),
        ]),
      );
      // Each failed file gets one bounded retry with a smaller request. Successful
      // decisions are never replayed; later resumes reset this per-run attempt cap.
      const attempts = new Map<string, number>();
      for (const mode of ["discover", "match"] as const) {
        state.status = mode === "discover" ? "classifying" : "matching";
        state.checked = 0;
        state.candidates = pendingWork(checkpoint)[mode].length;
        while (true) {
          signal.throwIfAborted();
          const pending = pendingWork(checkpoint)
            [mode].filter(
              (path) =>
                (attempts.get(`${mode}:${path}`) ?? 0) <= this.limits.retries,
            )
            .map((path) => packets.get(path)!);
          if (!pending.length) break;
          if (checkedBudget()) {
            budgetReached = true;
            break;
          }
          const retry = pending.find(
            (c) => (attempts.get(`${mode}:${c.path}`) ?? 0) > 0,
          );
          const batch: Candidate[] = retry ? [retry] : takeBatch(pending);
          for (const c of batch)
            attempts.set(
              `${mode}:${c.path}`,
              (attempts.get(`${mode}:${c.path}`) ?? 0) + 1,
            );
          let response: Awaited<ReturnType<typeof classifyChanges>>;
          try {
            response = await this.classify(
              batch,
              checkpoint.definitions,
              signal,
              mode,
              {
                model: state.model!,
                fast: state.fast ?? false,
                reasoningEffort: state.reasoningEffort ?? "medium",
              },
              state.provider ?? "codex",
            );
          } catch (e) {
            signal.throwIfAborted();
            const reason =
              e instanceof Error
                ? e.message.slice(0, 1000)
                : "The model could not complete this request.";
            for (const c of batch)
              checkpoint.failures[c.path] = { stage: mode, reason };
            await publish("error");
            // An invocation failure often means login, rate limiting or network
            // trouble. Keep its batch queued rather than replaying the entire PR.
            state.error = reason;
            state.status = "paused";
            return;
          }
          usage.inputTokens += response.usage.inputTokens;
          usage.outputTokens += response.usage.outputTokens;
          usage.batches++;
          await verifyRevision();
          const rejected = new Set(response.rejectedFiles);
          for (const group of response.result.groups)
            if (
              !checkpoint.definitions.some((g) => g.pattern === group.pattern)
            )
              checkpoint.definitions.push(group);
          for (const file of response.result.files) {
            if (rejected.has(file.path))
              checkpoint.failures[file.path] = {
                stage: mode,
                reason: file.reason,
              };
            else {
              checkpoint.decisions[file.path] = {
                decision: file.decision,
                pattern: file.pattern,
                reason: file.reason,
                checkedPatterns: checkpoint.definitions.length,
                coveredHunks: file.coveredHunks,
              };
              delete checkpoint.failures[file.path];
            }
          }
          await publish("interrupted");
          state.checked += batch.length;
        }
        if (budgetReached) break;
      }
      signal.throwIfAborted();
      await verifyRevision();
      protectedPaths = await this.protectedPaths(
        client,
        ref,
        key,
        state.revision,
        signal,
      );
      await publish(
        remainingPaths(checkpoint).length
          ? budgetReached
            ? "budget"
            : "incomplete"
          : undefined,
      );
      state.status = state.resume ? "paused" : "complete";
    } catch (e) {
      if (e instanceof RevisionChanged) throw e;
      if (signal.aborted) {
        await publish("paused");
        state.status = state.resume ? "paused" : "complete";
      } else {
        // Preserve the last durable checkpoint even if a final network check fails.
        checkpoint.stop = "error";
        await publish("error");
        state.status = state.resume ? "paused" : "failed";
        state.error = e instanceof Error ? e.message : "Analysis stopped.";
      }
    }
  }
  private result(
    files: ChangedFile[],
    c: Checkpoint,
    revision: string,
    usage: TriageResult["usage"],
    protectedPaths: Set<string>,
    model: string,
    fast: boolean,
    reasoningEffort: NonNullable<TriageResult["reasoningEffort"]>,
    provider: NonNullable<TriageResult["provider"]>,
  ): TriageResult {
    const ordinary: Record<string, string> = {
      ...c.preservedOrdinary,
      ...c.skipped,
    };
    const grouped = new Map<string, string[]>();
    for (const [path, decision] of Object.entries(c.decisions)) {
      if (decision.decision === "group")
        grouped.set(decision.pattern, [
          ...(grouped.get(decision.pattern) ?? []),
          path,
        ]);
      else ordinary[path] = decision.reason;
    }
    const groups = [
      ...c.preservedGroups,
      ...[...grouped].map(([pattern, paths]) => {
        const def = c.definitions.find((g) => g.pattern === pattern)!;
        return {
          id: groupId(pattern, revision, model),
          name: def.name,
          description: def.description,
          paths,
        };
      }),
    ].flatMap((group) => {
      const paths = group.paths.filter((path) => {
        if (!protectedPaths.has(path)) return true;
        ordinary[path] = "Has a discussion, draft or bookmark";
        return false;
      });
      if (paths.length < 2) {
        for (const path of paths) ordinary[path] = "No other confirmed matches";
        return [];
      }
      return [{ ...group, paths }];
    });
    for (const path of remainingPaths(c))
      ordinary[path] =
        c.failures[path]?.reason ??
        (c.stop === "budget"
          ? "Analysis budget reached. Resume to finish checking this file."
          : c.decisions[path]
            ? "Waiting to check this file against later patterns. Its previous decision is saved."
            : "Not analyzed yet. Resume analysis to continue.");
    groups.sort(
      (a, b) => b.paths.length - a.paths.length || a.name.localeCompare(b.name),
    );
    const remaining = remainingPaths(c).length;
    const notice = remaining
      ? c.stop === "budget"
        ? `Analysis paused at this run's budget limit. ${remaining} files still need checking. Resume from the saved checkpoint.`
        : c.stop === "incomplete"
          ? `${remaining} ${remaining === 1 ? "file needs" : "files need"} another attempt. Valid decisions are saved; resume to retry only unfinished work.`
          : `Checkpoint saved · ${remaining} files still need checking.`
      : undefined;
    return {
      version: TRIAGE_VERSION,
      revision,
      model,
      fast,
      reasoningEffort,
      provider,
      createdAt: new Date().toISOString(),
      files,
      groups,
      ordinary,
      incompleteFiles: Object.keys(c.failures),
      usage: { ...usage },
      ...(notice ? { notice } : {}),
    };
  }
}
