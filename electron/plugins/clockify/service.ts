import { randomUUID } from "node:crypto";
import {
  clockifySettingsSchema,
  tidy,
  defaultClockifySettings,
  type ClockifyBlock,
  type ClockifyBlockEdit,
  type ClockifyProject,
  type ClockifyReview,
  type ClockifySecrets,
  type ClockifySettings,
  type ClockifyStatus,
  type ClockifyTimerAction,
} from "../../../shared/clockify";
import type { ProjectChat } from "../../../shared/projects";
import type { AISettings } from "../../../shared/settings";
import { attributeTime } from "../../../shared/time-attribution";
import type { Store } from "../../store";
import type { PluginSecrets } from "../secrets";
import { ClockifyClient, seconds, type Fetch } from "./client";
import { blockEvidence, describeBlocks } from "./describe";
import { chatEvidence, dayChats, type ChatSource } from "./evidence";

const MIN = 60_000;
/** A turn longer than this is more likely a restart than work. */
const MAX_TURN = 3 * 60 * MIN;
const MIN_BLOCK = 5 * MIN;
/** The same thread touched again within this adds nothing. */
const TOUCH_EVERY = MIN;
const MAX_TOUCHES = 5_000;

export interface ClockifyDeps {
  store: Store;
  secrets: PluginSecrets;
  fetch: Fetch;
  chats: ChatSource;
  projectName: (id: string) => string;
  aiSettings: () => AISettings;
  now?: () => number;
}

/**
 * The Clockify plugin: a working day tracked locally, turned into a
 * timesheet when it's stopped, and sent to Clockify only once reviewed.
 */
export class ClockifyPlugin {
  private describing?: AbortController;
  private projectsCache?: { key: string; at: number; list: ClockifyProject[] };
  private now: () => number;

  constructor(private deps: ClockifyDeps) {
    this.now = deps.now ?? Date.now;
  }

  private get store() {
    return this.deps.store;
  }

  enabled() {
    return !!this.store.get().plugins?.clockify;
  }

  /**
   * Turned off in Settings: a running day pauses, so the time the plugin is
   * off never counts as work, and any drafting stops. Everything else stays
   * for when it's turned back on.
   */
  async turnedOff() {
    this.describing?.abort();
    const now = this.now();
    await this.store.update((s) => {
      const c = s.clockify;
      if (c?.review?.describing) c.review = { ...c.review, describing: false };
      const day = c?.day;
      if (day && !day.pauses.some((p) => p.end === undefined))
        day.pauses = [...day.pauses, { start: now }];
    });
  }

  settings(): ClockifySettings {
    return clockifySettingsSchema.parse({
      ...defaultClockifySettings,
      ...this.store.get().clockify?.settings,
    });
  }

  status(): ClockifyStatus {
    const saved = this.store.get().clockify;
    const day = saved?.day;
    return {
      settings: this.settings(),
      hasToken: this.deps.secrets.has("clockify", "token"),
      persistent: this.deps.secrets.persistent("clockify"),
      day: day ? { start: day.start, pauses: day.pauses } : null,
      review: saved?.review ?? null,
    };
  }

  async save(settings: ClockifySettings, secrets: ClockifySecrets) {
    let account: string | undefined;
    let next = settings;
    if (secrets.token) {
      const user = await new ClockifyClient(
        this.deps.fetch,
        settings.host,
        secrets.token,
      ).user();
      account = user.name || user.email;
      if (!next.workspaceId)
        next = {
          ...next,
          workspaceId: user.activeWorkspace || user.defaultWorkspace || "",
        };
    }
    await this.deps.secrets.set("clockify", "token", secrets.token);
    await this.store.update((s) => {
      s.clockify = { ...s.clockify, settings: next };
    });
    this.projectsCache = undefined;
    return { ...this.status(), ...(account ? { account } : {}) };
  }

  private async client() {
    const token = await this.deps.secrets.get("clockify", "token");
    if (!token)
      throw new Error("Add your Clockify API key in Settings → Plugins.");
    return new ClockifyClient(this.deps.fetch, this.settings().host, token);
  }

  private workspace() {
    const id = this.settings().workspaceId;
    if (!id)
      throw new Error("Choose a Clockify workspace in Settings → Plugins.");
    return id;
  }

  async workspaces() {
    return (await this.client()).workspaces();
  }

  async projects() {
    const { host, workspaceId } = this.settings();
    const key = `${host}/${this.workspace()}`;
    const cached = this.projectsCache;
    if (cached?.key === key && this.now() - cached.at < 5 * MIN)
      return cached.list;
    const list = await (await this.client()).projects(workspaceId);
    this.projectsCache = { key, at: this.now(), list };
    return list;
  }

  async timer(action: ClockifyTimerAction) {
    this.requireEnabled();
    const now = this.now();
    const day = this.store.get().clockify?.day;
    if (action === "start") {
      if (day) return this.status();
      await this.store.update((s) => {
        s.clockify = {
          ...s.clockify,
          day: { start: now, pauses: [], touches: [] },
        };
      });
      return this.status();
    }
    if (!day) throw new Error("The timer isn't running.");
    const open = day.pauses.at(-1)?.end === undefined && day.pauses.length > 0;
    if (action === "pause" || action === "resume") {
      if ((action === "pause") === open) return this.status();
      await this.store.update((s) => {
        const d = s.clockify!.day!;
        d.pauses =
          action === "pause"
            ? [...d.pauses, { start: now }]
            : d.pauses.map((p, i) =>
                i === d.pauses.length - 1 ? { ...p, end: now } : p,
              );
      });
      return this.status();
    }
    const review = this.store.get().clockify?.review;
    if (review?.blocks.some((b) => b.clockifyProjectId && !b.submittedId))
      throw new Error("Send or discard the day you're reviewing first.");
    await this.wrapUp();
    return this.status();
  }

  /** Remembers where the person is, while the day runs and isn't paused. */
  async touch(projectId: string, chatId?: string) {
    if (!this.enabled()) return;
    const day = this.store.get().clockify?.day;
    if (!day || day.pauses.some((p) => p.end === undefined)) return;
    const now = this.now();
    const last = day.touches.at(-1);
    if (
      last &&
      last.projectId === projectId &&
      last.chatId === chatId &&
      now - last.at < TOUCH_EVERY
    )
      return;
    await this.store.update((s) => {
      const d = s.clockify?.day;
      if (!d) return;
      d.touches = [
        ...d.touches,
        { at: now, projectId, ...(chatId ? { chatId } : {}) },
      ].slice(-MAX_TOUCHES);
    });
  }

  /** Ends the day and lays it out as a timesheet, then has it described. */
  private async wrapUp() {
    const day = this.store.get().clockify!.day!;
    const settings = this.settings();
    const idleCap = settings.idleMinutes * MIN;
    const now = this.now();
    const chats = await dayChats(this.deps.chats, day.start);
    let end = now;
    const evidence = chatEvidence(chats, { start: day.start, end }, now);
    // A timer left running overnight stops where the day's work did.
    if (new Date(day.start).toDateString() !== new Date(now).toDateString()) {
      const lastSeen = Math.max(
        day.start,
        ...day.touches.map((t) => t.at),
        ...evidence.turns.map((t) => t.end),
        ...evidence.touches.map((t) => t.at),
      );
      end = Math.min(now, Math.max(day.start + MIN, lastSeen + idleCap));
    }
    const pieces = attributeTime(
      { start: day.start, end, pauses: day.pauses },
      evidence.turns,
      [...evidence.touches, ...day.touches],
      {
        idleCap,
        maxTurn: MAX_TURN,
        minBlock: MIN_BLOCK,
        included: (id) => !!settings.projects[id],
      },
    );
    const blocks: ClockifyBlock[] = pieces.map((p) => ({
      id: randomUUID(),
      start: p.start,
      end: p.end,
      relayProjectId: p.projectId,
      clockifyProjectId: p.projectId ? settings.projects[p.projectId] : "",
      description: "",
      chatIds: p.chatIds,
      ...(p.reason ? { reason: p.reason } : {}),
      ...(p.uncertain ? { uncertain: true } : {}),
    }));
    await this.store.update((s) => {
      s.clockify = {
        ...s.clockify,
        day: undefined,
        review: {
          start: day.start,
          end,
          blocks,
          threads: Object.fromEntries(
            chats
              .filter((c) => blocks.some((b) => b.chatIds.includes(c.id)))
              .map((c) => [c.id, c.title]),
          ),
          describing: true,
        },
      };
    });
    void this.describe(chats).catch(() => {});
  }

  async saveReview(edits: ClockifyBlockEdit[]) {
    const review = this.requireReview();
    const byId = new Map(edits.map((e) => [e.id, e]));
    const blocks = review.blocks.map((b) => {
      const edit = byId.get(b.id);
      if (!edit) return b;
      if (b.submittedId)
        throw new Error("That entry is already in Clockify; change it there.");
      const next = { ...b, ...edit };
      if (next.end < next.start)
        throw new Error("An entry must end after it starts.");
      return next;
    });
    await this.store.update((s) => {
      s.clockify!.review!.blocks = tidy(blocks);
    });
    return this.status();
  }

  /** Has the timesheet model describe each entry; descriptions edited meanwhile stay. */
  async describe(loaded?: ProjectChat[]) {
    this.requireEnabled();
    const review = this.requireReview();
    this.describing?.abort();
    const abort = new AbortController();
    this.describing = abort;
    await this.setReview({ describing: true, describeError: undefined });
    try {
      const chats = new Map(
        (loaded ?? (await dayChats(this.deps.chats, review.start))).map((c) => [
          c.id,
          c,
        ]),
      );
      const before = new Map(review.blocks.map((b) => [b.id, b.description]));
      const evidence = blockEvidence(
        review.blocks,
        chats,
        this.deps.projectName,
        review,
      );
      const described = await describeBlocks(
        review.blocks,
        evidence,
        this.deps.aiSettings(),
        abort.signal,
      );
      if (abort.signal.aborted) return this.status();
      await this.store.update((s) => {
        const r = s.clockify?.review;
        if (!r) return;
        r.describing = false;
        r.blocks = r.blocks.map((b) => {
          const text = described.get(b.id);
          return text && !b.submittedId && b.description === before.get(b.id)
            ? { ...b, description: text }
            : b;
        });
      });
    } catch (e) {
      if (!abort.signal.aborted)
        await this.setReview({
          describing: false,
          describeError: e instanceof Error ? e.message : String(e),
        });
    } finally {
      if (this.describing === abort) this.describing = undefined;
    }
    return this.status();
  }

  /**
   * Sends every entry that has a Clockify project and isn't sent yet, one at
   * a time, saving each as it lands. After a failed attempt it first looks
   * for entries that made it anyway, so a retry never doubles them.
   */
  async submit() {
    this.requireEnabled();
    const review = this.requireReview();
    const workspace = this.workspace();
    const client = await this.client();
    const pending = review.blocks.filter(
      (b) => b.clockifyProjectId && !b.submittedId,
    );
    if (!pending.length) return this.status();
    try {
      if (review.submitError) {
        const user = await client.user();
        const existing = await client.entries(
          workspace,
          user.id,
          review.start,
          review.end,
        );
        for (const b of pending) {
          const match = existing.find(
            (e) =>
              e.start === seconds(b.start) &&
              e.projectId === b.clockifyProjectId,
          );
          if (match) await this.markSent(b.id, match.id);
        }
      }
      for (const b of this.requireReview().blocks) {
        if (!b.clockifyProjectId || b.submittedId) continue;
        const id = await client.addEntry(workspace, {
          start: b.start,
          end: b.end,
          projectId: b.clockifyProjectId,
          description: b.description.trim(),
        });
        await this.markSent(b.id, id);
      }
      await this.setReview({ submitError: undefined });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.setReview({ submitError: message });
      throw e;
    }
    return this.status();
  }

  async discard() {
    this.describing?.abort();
    await this.store.update((s) => {
      if (s.clockify) s.clockify = { ...s.clockify, review: undefined };
    });
    return this.status();
  }

  private async markSent(blockId: string, submittedId: string) {
    await this.store.update((s) => {
      const r = s.clockify?.review;
      if (r)
        r.blocks = r.blocks.map((b) =>
          b.id === blockId ? { ...b, submittedId } : b,
        );
    });
  }

  private async setReview(patch: Partial<ClockifyReview>) {
    await this.store.update((s) => {
      const r = s.clockify?.review;
      if (r) s.clockify!.review = { ...r, ...patch };
    });
  }

  private requireReview() {
    const review = this.store.get().clockify?.review;
    if (!review) throw new Error("There's no day to review.");
    return review;
  }

  private requireEnabled() {
    if (!this.enabled())
      throw new Error("Turn on Clockify time tracking in Settings → Plugins.");
  }
}
