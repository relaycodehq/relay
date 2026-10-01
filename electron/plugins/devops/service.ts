import { readFile, rename, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import {
  defaultDevOpsSettings,
  devopsSettingsSchema,
  organizationUrl,
  type DevOpsSecrets,
  type DevOpsSettings,
  type DevOpsStatus,
  currentSprintField,
  type SortKey,
  type WorkItem,
  type WorkItemField,
  type WorkItemScope,
  type WorkItemsResult,
} from "../../../shared/devops";
import type { Project } from "../../../shared/projects";
import type { Store } from "../../store";
import { DevOpsAuth } from "./auth";
import { DevOpsClient, type Fetch, type IterationNode } from "./client";
import { DevOpsKeys } from "./keys";

type Encrypt = (value: string) => Promise<string | null>;
type Decrypt = (value: string) => Promise<string>;

const closedStates = ["Closed", "Done", "Removed", "Resolved", "Completed"];
const fields = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.AreaPath",
  "System.TeamProject",
  "System.Tags",
  "System.ChangedDate",
  "System.AssignedTo",
  "System.IterationId",
  "Microsoft.VSTS.Common.Priority",
  "System.Description",
  "Microsoft.VSTS.TCM.ReproSteps",
];
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
    const saved = this.store.get().devops;
    return devopsSettingsSchema.parse(
      saved
        ? {
            ...defaultDevOpsSettings,
            ...saved,
            filter: { ...defaultDevOpsSettings.filter, ...saved.filter },
            sort: savedSort(saved.sort),
            mine: { ...defaultDevOpsSettings.mine, ...saved.mine },
            team: { ...defaultDevOpsSettings.team, ...saved.team },
          }
        : defaultDevOpsSettings,
    );
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

  /**
   * Your items or the team's: assigned to you or to its members, each through
   * its own filters, in the order Settings gives.
   */
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
    const client = new DevOpsClient(
      this.fetch,
      base,
      await this.auth.header(settings.auth, base),
    );
    // Reference names go as they are; display names are looked up once.
    const reference = async (name: string) => {
      if (name.includes(".")) return name;
      const lower = name.toLowerCase();
      const found = (await this.fieldsAt(settings, client)).find(
        (f) =>
          f.name.toLowerCase() === lower ||
          f.referenceName.toLowerCase() === lower,
      );
      if (!found)
        throw new Error(
          `Azure DevOps has no work item field called “${name}”.`,
        );
      return found.referenceName;
    };
    const sortKeys: SortKey[] = [];
    for (const k of settings.sort.fields)
      sortKeys.push(
        k.field === currentSprintField
          ? k
          : { ...k, field: await reference(k.field) },
      );
    const bySprint = sortKeys.some((k) => k.field === currentSprintField);
    const filters = [];
    for (const f of scope === "team"
      ? settings.team.filters
      : settings.mine.filters)
      filters.push({ ...f, field: await reference(f.field) });
    // A filter on the state picks the states; otherwise closed items stay out.
    const byState = filters.some(
      (f) => f.field.toLowerCase() === "system.state",
    );
    const ids = await client.wiql(
      settings.project,
      [
        "SELECT [System.Id] FROM WorkItems",
        scope === "mine"
          ? "WHERE [System.AssignedTo] = @Me"
          : `WHERE [System.AssignedTo] IN (${settings.team.members.map(wiqlString).join(", ")})`,
        byState
          ? ""
          : `AND [System.State] NOT IN (${closedStates.map(wiqlString).join(", ")})`,
        ...filters.map(
          (f) => `AND [${f.field}] IN (${f.values.map(wiqlString).join(", ")})`,
        ),
        settings.project ? "AND [System.TeamProject] = @project" : "",
        "ORDER BY [System.ChangedDate] DESC",
      ]
        .filter(Boolean)
        .join(" "),
    );
    let items: WorkItem[] = [];
    if (ids.length) {
      const found = await client.workItems(ids, [
        ...new Set([
          ...fields,
          ...sortKeys
            .map((k) => k.field)
            .filter((f) => f !== currentSprintField),
        ]),
      ]);
      const sprints = bySprint
        ? await this.currentSprints(client, [
            ...new Set(
              found.map((w) => String(w.fields["System.TeamProject"])),
            ),
          ])
        : new Set<number>();
      const order = new Map(ids.map((id, i) => [id, i]));
      const inSprint = (w: (typeof found)[number]) =>
        Number(sprints.has(w.fields["System.IterationId"] as number));
      const value = (w: (typeof found)[number], field: string) =>
        field === currentSprintField
          ? inSprint(w)
          : fieldValue(w.fields, field);
      // Ties keep the WIQL's order: most recently changed first.
      items = found
        .sort(
          (a, b) =>
            sortKeys.reduce(
              (by, k) =>
                by ||
                compareField(value(a, k.field), value(b, k.field), k.direction),
              0,
            ) || order.get(a.id)! - order.get(b.id)!,
        )
        .map((w) => toWorkItem(base, w.id, w.fields, sprints));
    }
    this.items.set(scope, { key, at: Date.now(), items });
    return items;
  }

  /**
   * The iterations running today in these projects, whichever team plans
   * them: a sprint is current while its dates hold today.
   */
  private async currentSprints(client: DevOpsClient, projects: string[]) {
    const now = Date.now(),
      current = new Set<number>();
    const visit = (node: IterationNode) => {
      const start = Date.parse(node.attributes?.startDate ?? ""),
        finish = Date.parse(node.attributes?.finishDate ?? "");
      // The finish date is the sprint's last day, so it runs through it.
      if (start <= now && now < finish + 24 * 60 * 60_000) current.add(node.id);
      node.children?.forEach(visit);
    };
    await Promise.all(
      projects.map(async (project) => {
        try {
          visit(await client.iterations(project));
        } catch {
          // Without sprint dates the items still sort by priority.
        }
      }),
    );
    return current;
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

function toWorkItem(
  base: string,
  id: number,
  f: Record<string, unknown>,
  sprints: Set<number>,
): WorkItem {
  const text = (k: string) =>
    typeof f[k] === "string" ? (f[k] as string) : "";
  const project = text("System.TeamProject");
  const assignee = f["System.AssignedTo"];
  return {
    id,
    title: text("System.Title"),
    type: text("System.WorkItemType"),
    state: text("System.State"),
    areaPath: text("System.AreaPath"),
    project,
    tags: text("System.Tags")
      .split(";")
      .map((t) => t.trim())
      .filter(Boolean),
    changed: text("System.ChangedDate"),
    priority:
      typeof f["Microsoft.VSTS.Common.Priority"] === "number"
        ? f["Microsoft.VSTS.Common.Priority"]
        : null,
    currentSprint: sprints.has(f["System.IterationId"] as number),
    assignedTo:
      typeof assignee === "string" ? assignee : (identityName(assignee) ?? ""),
    description: plainText(
      text("System.Description") || text("Microsoft.VSTS.TCM.ReproSteps"),
    ).slice(0, 2000),
    url: `${base}/${encodeURIComponent(project)}/_workitems/edit/${id}`,
  };
}

/**
 * The saved order. Before the current sprint was a sort key of its own, a
 * switch put it ahead of the fields.
 */
function savedSort(sort: unknown): DevOpsSettings["sort"] {
  const saved = (sort ?? {}) as {
    currentSprint?: boolean;
    fields?: SortKey[];
  };
  const fields = saved.fields ?? defaultDevOpsSettings.sort.fields;
  return {
    fields: saved.currentSprint
      ? [
          { field: currentSprintField, direction: "desc" as const },
          ...fields,
        ].slice(0, 3)
      : fields,
  };
}

const wiqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const identityName = (value: unknown) =>
  value && typeof value === "object" && "displayName" in value
    ? String(value.displayName)
    : undefined;

/** A field from a batch answer; a hand-typed reference name may differ in case. */
function fieldValue(fields: Record<string, unknown>, reference: string) {
  if (reference in fields) return fields[reference];
  const lower = reference.toLowerCase();
  return Object.entries(fields).find(([k]) => k.toLowerCase() === lower)?.[1];
}

/** One sort key's verdict; an item without the field sorts last either way. */
function compareField(a: unknown, b: unknown, direction: SortKey["direction"]) {
  const value = (v: unknown) =>
    typeof v === "number"
      ? v
      : typeof v === "boolean"
        ? Number(v)
        : typeof v === "string"
          ? v || undefined
          : identityName(v);
  const x = value(a),
    y = value(b);
  if (x === undefined || y === undefined)
    return x === y ? 0 : x === undefined ? 1 : -1;
  const by =
    typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y), undefined, { numeric: true });
  return direction === "asc" ? by : -by;
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
export function plainText(html: string) {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] !== "#") return entities[e.toLowerCase()] ?? m;
      const code =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      // fromCodePoint throws on values past U+10FFFF.
      return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}
