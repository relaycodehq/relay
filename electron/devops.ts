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
  type WorkItem,
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
  "System.Description",
  "Microsoft.VSTS.TCM.ReproSteps",
];
const itemsTtl = 2 * 60_000;
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
  /** Secrets that could not be encrypted live for this session only. */
  private session: { pat?: string; openRouterKey?: string } = {};
  private cliToken?: { value: string; expires: number };
  private items?: { key: string; at: number; items: WorkItem[] };
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
    this.items = undefined;
    this.cliToken = undefined;
    return this.status();
  }

  async workItems(
    project: Project | null,
    refresh = false,
  ): Promise<WorkItemsResult> {
    const settings = this.settings();
    if (!settings.enabled) throw new Error("Azure DevOps is turned off.");
    const threshold = settings.filter.threshold;
    // Hidden projects never reach Azure DevOps or the filter.
    if (project && settings.hiddenProjects.includes(project.id))
      return { items: [], relevance: null, threshold };
    const items = await this.assigned(settings, refresh);
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

  private async assigned(settings: DevOpsSettings, refresh: boolean) {
    const base = organizationUrl(settings.organization);
    const key = `${base}|${settings.project}|${settings.auth}`;
    if (
      !refresh &&
      this.items?.key === key &&
      Date.now() - this.items.at < itemsTtl
    )
      return this.items.items;
    const auth = await this.authorization(settings, base);
    const scope = settings.project
      ? `/${encodeURIComponent(settings.project)}`
      : "";
    const wiql = await this.request<{ workItems: { id: number }[] }>(
      `${base}${scope}/_apis/wit/wiql?api-version=7.1&$top=200`,
      auth,
      {
        query: [
          "SELECT [System.Id] FROM WorkItems",
          "WHERE [System.AssignedTo] = @Me",
          `AND [System.State] NOT IN (${closedStates.map((s) => `'${s}'`).join(", ")})`,
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
        fields,
        errorPolicy: "omit",
      });
      const order = new Map(ids.map((id, i) => [id, i]));
      items = batch.value
        .filter(Boolean)
        .map((w) => toWorkItem(base, w.id, w.fields))
        .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    }
    this.items = { key, at: Date.now(), items };
    return items;
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

  private async request<T>(url: string, auth: string, body: unknown) {
    let res: Response;
    try {
      res = await this.fetch(url, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Azure DevOps could not be reached.");
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
): WorkItem {
  const text = (k: string) =>
    typeof f[k] === "string" ? (f[k] as string) : "";
  const project = text("System.TeamProject");
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
    description: plainText(
      text("System.Description") || text("Microsoft.VSTS.TCM.ReproSteps"),
    ).slice(0, 2000),
    url: `${base}/${encodeURIComponent(project)}/_workitems/edit/${id}`,
  };
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
