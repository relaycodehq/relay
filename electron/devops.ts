import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
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
} from "../shared/devops";
import type { Project } from "../shared/projects";
import { findExecutable } from "./executables";
import type { Store } from "./store";

const exec = promisify(execFile);
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Encrypt = (value: string) => Promise<string | null>;
type Decrypt = (value: string) => Promise<string>;

/** The Azure DevOps application id, used as the token resource for `az`. */
const devopsResource = "499b84ac-1321-427f-aa17-267ca6975798";
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

interface IterationNode {
  id: number;
  attributes?: { startDate?: string; finishDate?: string };
  children?: IterationNode[];
}

interface RelevanceCache {
  /** Filter cache key → last use and question hash → yes-probability. */
  [key: string]: { at: number; answers: Record<string, number> };
}

/** The network failed, as opposed to Azure DevOps turning the sign-in down. */
export class DevOpsUnreachable extends Error {}

export class DevOps {
  /** Secrets that could not be encrypted live for this session only. */
  private session: { pat?: string; openRouterKey?: string } = {};
  private cliToken?: { value: string; expires: number };
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
    private encrypt: Encrypt,
    private decrypt: Decrypt,
    private cacheFile?: string,
  ) {}

  settings(): DevOpsSettings {
    const saved = this.store.get().devops;
    return devopsSettingsSchema.parse(
      saved
        ? {
            ...defaultDevOpsSettings,
            ...saved,
            filter: { ...defaultDevOpsSettings.filter, ...saved.filter },
            sort: savedSort(saved.sort),
            team: { ...defaultDevOpsSettings.team, ...saved.team },
          }
        : defaultDevOpsSettings,
    );
  }

  status(): DevOpsStatus {
    const s = this.store.get();
    return {
      settings: this.settings(),
      hasPat: !!(s.devopsPat || this.session.pat),
      hasOpenRouterKey: !!(s.devopsOpenRouterKey || this.session.openRouterKey),
      persistent: !this.session.pat && !this.session.openRouterKey,
    };
  }

  async save(settings: DevOpsSettings, secrets: DevOpsSecrets) {
    if (settings.organization) organizationUrl(settings.organization);
    const seal = async (value: string | null | undefined) =>
      value == null ? value : await this.encrypt(value);
    const pat = await seal(secrets.pat),
      openRouterKey = await seal(secrets.openRouterKey);
    if (secrets.pat !== undefined) this.session.pat = undefined;
    if (secrets.openRouterKey !== undefined)
      this.session.openRouterKey = undefined;
    if (secrets.pat && !pat) this.session.pat = secrets.pat;
    if (secrets.openRouterKey && !openRouterKey)
      this.session.openRouterKey = secrets.openRouterKey;
    await this.store.update((s) => {
      s.devops = settings;
      if (secrets.pat !== undefined) s.devopsPat = pat ?? undefined;
      if (secrets.openRouterKey !== undefined)
        s.devopsOpenRouterKey = openRouterKey ?? undefined;
    });
    this.items.clear();
    this.fieldList = undefined;
    this.cliToken = undefined;
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
    const settings = this.settings();
    const base = organizationUrl(settings.organization);
    const { authenticatedUser: user } = await this.request<{
      authenticatedUser?: {
        providerDisplayName?: string;
        properties?: { Account?: { $value?: string } };
      };
    }>(
      `${base}/_apis/connectionData`,
      await this.authorization(settings, base),
    );
    return user?.providerDisplayName || user?.properties?.Account?.$value;
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
    const base = organizationUrl(settings.organization);
    return this.fieldsAt(
      settings,
      base,
      await this.authorization(settings, base),
    );
  }

  private async fieldsAt(settings: DevOpsSettings, base: string, auth: string) {
    const key = `${base}|${settings.project}`;
    if (
      this.fieldList?.key === key &&
      Date.now() - this.fieldList.at < fieldsTtl
    )
      return this.fieldList.fields;
    const { value } = await this.request<{ value: WorkItemField[] }>(
      `${base}${projectPath(settings)}/_apis/wit/fields?api-version=7.1`,
      auth,
    );
    const fields = value
      .map(({ name, referenceName }) => ({ name, referenceName }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.fieldList = { key, at: Date.now(), fields };
    return fields;
  }

  /**
   * Your items or the team's: assigned to you or to its members, through its
   * filters, in the order Settings gives.
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
      scope === "team" ? settings.team : null,
    ]);
    const cached = this.items.get(scope);
    if (!refresh && cached?.key === key && Date.now() - cached.at < itemsTtl)
      return cached.items;
    if (scope === "team" && !settings.team.members.length) return [];
    const auth = await this.authorization(settings, base);
    // Reference names go as they are; display names are looked up once.
    const reference = async (name: string) => {
      if (name.includes(".")) return name;
      const lower = name.toLowerCase();
      const found = (await this.fieldsAt(settings, base, auth)).find(
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
    for (const f of scope === "team" ? settings.team.filters : [])
      filters.push({ ...f, field: await reference(f.field) });
    // A filter on the state picks the states; otherwise closed items stay out.
    const byState = filters.some(
      (f) => f.field.toLowerCase() === "system.state",
    );
    const wiql = await this.request<{ workItems: { id: number }[] }>(
      `${base}${projectPath(settings)}/_apis/wit/wiql?api-version=7.1&$top=200`,
      auth,
      {
        query: [
          "SELECT [System.Id] FROM WorkItems",
          scope === "mine"
            ? "WHERE [System.AssignedTo] = @Me"
            : `WHERE [System.AssignedTo] IN (${settings.team.members.map(wiqlString).join(", ")})`,
          byState
            ? ""
            : `AND [System.State] NOT IN (${closedStates.map(wiqlString).join(", ")})`,
          ...filters.map(
            (f) =>
              `AND [${f.field}] IN (${f.values.map(wiqlString).join(", ")})`,
          ),
          settings.project ? "AND [System.TeamProject] = @project" : "",
          "ORDER BY [System.ChangedDate] DESC",
        ]
          .filter(Boolean)
          .join(" "),
      },
    );
    const ids = wiql.workItems.map((w) => w.id).slice(0, 200);
    let items: WorkItem[] = [];
    if (ids.length) {
      const batch = await this.request<{
        value: { id: number; fields: Record<string, unknown> }[];
      }>(`${base}/_apis/wit/workitemsbatch?api-version=7.1`, auth, {
        ids,
        fields: [
          ...new Set([
            ...fields,
            ...sortKeys
              .map((k) => k.field)
              .filter((f) => f !== currentSprintField),
          ]),
        ],
        errorPolicy: "omit",
      });
      const found = batch.value.filter(Boolean);
      const sprints = bySprint
        ? await this.currentSprints(base, auth, [
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
  private async currentSprints(base: string, auth: string, projects: string[]) {
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
          visit(
            await this.request<IterationNode>(
              `${base}/${encodeURIComponent(project)}/_apis/wit/classificationnodes/Iterations?$depth=10&api-version=7.1`,
              auth,
            ),
          );
        } catch {
          // Without sprint dates the items still sort by priority.
        }
      }),
    );
    return current;
  }

  private async authorization(settings: DevOpsSettings, base: string) {
    if (settings.auth === "pat") {
      const pat = await this.secret("pat");
      if (!pat)
        throw new Error(
          "Add a personal access token for Azure DevOps in Settings.",
        );
      return `Basic ${Buffer.from(":" + pat).toString("base64")}`;
    }
    if (this.cliToken && this.cliToken.expires - Date.now() > 5 * 60_000)
      return `Bearer ${this.cliToken.value}`;
    const az = await findExecutable("az").catch(() => {
      throw new Error(
        "The Azure CLI was not found. Install it and run `az login`, or use a personal access token.",
      );
    });
    // `az` signs into its default tenant, which is often not the one that
    // backs the organization; DevOps then rejects the identity.
    const tenant = await this.resourceTenant(base);
    let out: string;
    try {
      ({ stdout: out } = await exec(
        az,
        [
          "account",
          "get-access-token",
          "--resource",
          devopsResource,
          ...(tenant ? ["--tenant", tenant] : []),
          "--output",
          "json",
        ],
        { timeout: 30_000 },
      ));
    } catch {
      throw new Error(
        tenant
          ? `The Azure CLI could not get a token for this organization. Run \`az login --tenant ${tenant}\` in a terminal and try again.`
          : "The Azure CLI could not get a token. Run `az login` in a terminal and try again.",
      );
    }
    const token = JSON.parse(out) as {
      accessToken: string;
      expires_on?: number;
      expiresOn?: string;
    };
    this.cliToken = {
      value: token.accessToken,
      expires: token.expires_on
        ? token.expires_on * 1000
        : Date.parse(token.expiresOn ?? "") || Date.now() + 30 * 60_000,
    };
    return `Bearer ${token.accessToken}`;
  }

  /** The Entra tenant Azure DevOps reports for an organization, if any. */
  private async resourceTenant(base: string) {
    try {
      const res = await this.fetch(`${base}/_apis/connectionData`, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000),
      });
      const tenant = res.headers.get("x-vss-resourcetenant") ?? "";
      // Organizations backed by Microsoft accounts report an empty GUID.
      return /^[0-9a-f-]{36}$/i.test(tenant) && !/^[0-]+$/.test(tenant)
        ? tenant
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async secret(kind: "pat" | "openRouterKey") {
    if (this.session[kind]) return this.session[kind];
    const s = this.store.get();
    const sealed = kind === "pat" ? s.devopsPat : s.devopsOpenRouterKey;
    return sealed ? await this.decrypt(sealed) : undefined;
  }

  /** POSTs `body` as JSON, or GETs when there is none. */
  private async request<T>(url: string, auth: string, body?: unknown) {
    let res: Response;
    try {
      res = await this.fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: auth,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new DevOpsUnreachable("Azure DevOps could not be reached.");
    }
    // An invalid PAT gets a 203 sign-in page instead of a 401.
    const json = res.headers.get("content-type")?.includes("json");
    if (res.status === 401 || res.status === 203 || (res.ok && !json))
      throw new Error(
        "Azure DevOps rejected the credentials. Check the token and its Work Items (Read) scope.",
      );
    if (!res.ok) {
      const detail = json
        ? ((await res.json().catch(() => null)) as { message?: string } | null)
            ?.message
        : undefined;
      throw new Error(
        res.status === 404
          ? "Azure DevOps organization or project not found."
          : (detail ?? `Azure DevOps returned ${res.status}.`),
      );
    }
    return (await res.json()) as T;
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
    const key = await this.secret("openRouterKey");
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

const projectPath = (settings: DevOpsSettings) =>
  settings.project ? `/${encodeURIComponent(settings.project)}` : "";

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
export function compareField(
  a: unknown,
  b: unknown,
  direction: SortKey["direction"],
) {
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
