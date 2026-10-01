import { readFile, rename, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import {
  organizationUrl,
  type DevOpsSecrets,
  type DevOpsSettings,
  type DevOpsStatus,
  type WorkItem,
  type WorkItemField,
  type WorkItemScope,
  type WorkItemsResult,
} from "../../../shared/devops";
import type { Project } from "../../../shared/projects";
import type { Store } from "../../store";
import { DevOpsAuth } from "./auth";
import { DevOpsClient, type Fetch } from "./client";
import { DevOpsKeys } from "./keys";
import { readSettings } from "./settings";
import { loadWorkItems } from "./work-items";

type Encrypt = (value: string) => Promise<string | null>;
type Decrypt = (value: string) => Promise<string>;

const itemsTtl = 2 * 60_000;
const fieldsTtl = 60 * 60_000;
/** Keeps each Jev request well inside its 64k-token budget. */
const filterBatch = 80;
/** Filter answers for projects or hints unused this long are dropped. */
const relevanceTtl = 30 * 24 * 60 * 60_000;

const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface RelevanceCache {
  /** Filter cache key → last use and question hash → yes-probability. */
  [key: string]: { at: number; answers: Record<string, number> };
}

export class DevOps {
  private keys: DevOpsKeys;
  private auth: DevOpsAuth;
  private items = new Map<
    WorkItemScope,
    { key: string; at: number; items: WorkItem[] }
  >();
  private fieldList?: { key: string; at: number; fields: WorkItemField[] };
  /** Loaded from `cacheFile` on first use, so answers outlive restarts. */
  private relevance?: Promise<RelevanceCache>;
  /** One filter run per cache key at a time, so overlaps never ask twice. */
  private filtering = new Map<string, Promise<unknown>>();
  private saving = Promise.resolve();

  constructor(
    private store: Store,
    private fetch: Fetch,
    encrypt: Encrypt,
    decrypt: Decrypt,
    private cacheFile?: string,
  ) {
    this.keys = new DevOpsKeys(store, encrypt, decrypt);
    this.auth = new DevOpsAuth(fetch, () => this.keys.get("pat"));
  }

  settings(): DevOpsSettings {
    return readSettings(this.store.get().devops);
  }

  status(): DevOpsStatus {
    return {
      settings: this.settings(),
      hasPat: this.keys.has("pat"),
      hasOpenRouterKey: this.keys.has("openRouterKey"),
      persistent: this.keys.persistent(),
    };
  }

  async save(settings: DevOpsSettings, secrets: DevOpsSecrets) {
    if (settings.organization) organizationUrl(settings.organization);
    const writeKeys = await this.keys.seal(secrets);
    await this.store.update((s) => {
      s.devops = settings;
      writeKeys(s);
    });
    this.items.clear();
    this.fieldList = undefined;
    this.auth.forget();
    return this.status();
  }

  /** The plugin's switch: work items on or off, keeping the rest of the settings. */
  async setEnabled(enabled: boolean) {
    return this.save({ ...this.settings(), enabled }, {});
  }

  /**
   * Who Azure DevOps takes the saved sign-in for, so Settings shows what it
   * really accepts. Throws `DevOpsUnreachable` when it can't be asked.
   */
  async whoAmI(): Promise<string | undefined> {
    return (await this.client(this.settings())).whoAmI();
  }

  async workItems(
    project: Project | null,
    refresh = false,
    scope: WorkItemScope = "mine",
  ): Promise<WorkItemsResult> {
    const settings = this.settings();
    if (!settings.enabled) throw new Error("Azure DevOps is turned off.");
    const threshold = settings.filter.threshold;
    // Hidden projects never reach Azure DevOps or the filter.
    if (project && settings.hiddenProjects.includes(project.id))
      return { items: [], relevance: null, threshold };
    const items = await this.list(settings, refresh, scope);
    const result: WorkItemsResult = {
      items,
      relevance: null,
      threshold,
    };
    if (!project || !settings.filter.enabled || !items.length) return result;
    try {
      result.relevance = await this.filter(settings, project, items);
    } catch (error) {
      result.filterError =
        error instanceof Error ? error.message : "The filter failed.";
    }
    return result;
  }

  /** The fields the organization's work items have, by display name. */
  async fields(): Promise<WorkItemField[]> {
    const settings = this.settings();
    return this.fieldsAt(settings, await this.client(settings));
  }

  /** Throws for a missing or malformed organization before any sign-in. */
  private async client(settings: DevOpsSettings) {
    const base = organizationUrl(settings.organization);
    return new DevOpsClient(
      this.fetch,
      base,
      await this.auth.header(settings.auth, base),
    );
  }

  private async fieldsAt(settings: DevOpsSettings, client: DevOpsClient) {
    const key = `${client.base}|${settings.project}`;
    if (
      this.fieldList?.key === key &&
      Date.now() - this.fieldList.at < fieldsTtl
    )
      return this.fieldList.fields;
    const fields = await client.fields(settings.project);
    this.fieldList = { key, at: Date.now(), fields };
    return fields;
  }

  /** Each scope's list is kept a while, until a refresh or new settings. */
  private async list(
    settings: DevOpsSettings,
    refresh: boolean,
    scope: WorkItemScope,
  ) {
    const base = organizationUrl(settings.organization);
    const key = JSON.stringify([
      base,
      settings.project,
      settings.auth,
      settings.sort,
      scope === "team" ? settings.team : settings.mine,
    ]);
    const cached = this.items.get(scope);
    if (!refresh && cached?.key === key && Date.now() - cached.at < itemsTtl)
      return cached.items;
    if (scope === "team" && !settings.team.members.length) return [];
    const client = await this.client(settings);
    const items = await loadWorkItems(client, settings, scope, () =>
      this.fieldsAt(settings, client),
    );
    this.items.set(scope, { key, at: Date.now(), items });
    return items;
  }

  /**
   * Asks the System One model one yes/no question per work item. Answers are
   * keyed on exactly what Jev sees, so comments, state changes and other
   * edits outside the prompt never ask again.
   */
  private async filter(
    settings: DevOpsSettings,
    project: Project,
    items: WorkItem[],
  ) {
    const key = await this.keys.get("openRouterKey");
    if (!key) throw new Error("Add an OpenRouter API key to use the filter.");
    const keywords = settings.filter.keywords[project.id] ?? "";
    const state = {
      project: {
        name: project.name,
        folder: basename(project.path),
        ...(project.repository
          ? {
              repository: `${project.repository.owner}/${project.repository.name}`,
            }
          : {}),
        ...(keywords ? { keywords } : {}),
      },
    };
    const cacheKey = sha([settings.filter.model, state]);
    const questions = new Map(
      items.map((w) => {
        const question = {
          type: "noul",
          instructions: {
            work_item: {
              title: w.title,
              type: w.type,
              area_path: w.areaPath,
              team_project: w.project,
              ...(w.tags.length ? { tags: w.tags } : {}),
              ...(w.description
                ? { description: w.description.slice(0, 400) }
                : {}),
            },
            question: keywords
              ? "`work_item` is work on the software project in `project`: it matches the project's name, repository, folder or `project.keywords`."
              : "`work_item` is work on the software project in `project`: it matches the project's name, repository or folder.",
          },
          criteria: {
            true: "The work item is about this project's product, codebase or features.",
            false:
              "The work item is about a different product, app, device or component.",
          },
        };
        return [w.id, { question, hash: sha(question) }];
      }),
    );
    const run = (this.filtering.get(cacheKey) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const cache = await this.relevanceCache();
        const entry = (cache[cacheKey] ??= { at: 0, answers: {} });
        entry.at = Date.now();
        const missing = items.filter(
          (w) => !(questions.get(w.id)!.hash in entry.answers),
        );
        try {
          for (let i = 0; i < missing.length; i += filterBatch) {
            const batch = missing.slice(i, i + filterBatch);
            const answers = await this.decide(
              key,
              settings.filter.model,
              state,
              Object.fromEntries(
                batch.map((w) => [`wi_${w.id}`, questions.get(w.id)!.question]),
              ),
            );
            for (const w of batch) {
              const p = answers[`wi_${w.id}`];
              if (typeof p === "number")
                entry.answers[questions.get(w.id)!.hash] = p;
            }
          }
        } finally {
          // Keep only questions about items still assigned, answered or not.
          const current = new Set([...questions.values()].map((q) => q.hash));
          for (const hash of Object.keys(entry.answers))
            if (!current.has(hash)) delete entry.answers[hash];
          await this.saveRelevance(cache);
        }
        return entry.answers;
      });
    this.filtering.set(cacheKey, run);
    try {
      const answers = await run;
      return Object.fromEntries(
        items
          .filter((w) => questions.get(w.id)!.hash in answers)
          .map((w) => [w.id, answers[questions.get(w.id)!.hash]]),
      );
    } finally {
      if (this.filtering.get(cacheKey) === run) this.filtering.delete(cacheKey);
    }
  }

  private relevanceCache() {
    return (this.relevance ??= (async () => {
      if (!this.cacheFile) return {};
      try {
        const saved = JSON.parse(await readFile(this.cacheFile, "utf8"));
        return saved?.version === 1 && saved.keys ? saved.keys : {};
      } catch {
        // A missing or damaged cache only costs a few questions.
        return {};
      }
    })());
  }

  private saveRelevance(cache: RelevanceCache) {
    for (const [key, entry] of Object.entries(cache))
      if (Date.now() - entry.at > relevanceTtl) delete cache[key];
    const file = this.cacheFile;
    if (!file) return;
    const text = JSON.stringify({ version: 1, keys: cache });
    // Writes queue up so runs for different projects never share the temp file.
    return (this.saving = this.saving.then(async () => {
      try {
        await writeFile(`${file}.tmp`, text, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      } catch {
        // The answers stay cached in memory for this session.
      }
    }));
  }

  private async decide(
    key: string,
    model: string,
    state: unknown,
    questions: Record<string, unknown>,
  ) {
    let res: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await this.fetch("https://openrouter.ai/api/v1/systemone", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, state, questions }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new Error("OpenRouter could not be reached.");
      }
      if (res.status !== 429 && res.status !== 529) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
    if (!res!.ok) {
      const body = (await res!.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(
        res!.status === 401
          ? "OpenRouter rejected the API key."
          : `Filter failed: ${body?.error?.message ?? res!.status}`,
      );
    }
    const body = (await res!.json()) as {
      answers?: Record<string, { type: string; noul?: number }>;
    };
    return Object.fromEntries(
      Object.entries(body.answers ?? {})
        .filter(
          ([, a]) => typeof a.noul === "number" && a.noul >= 0 && a.noul <= 1,
        )
        .map(([k, a]) => [k, a.noul!]),
    );
  }
}
