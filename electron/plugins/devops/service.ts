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
import { RelevanceFilter } from "./relevance";
import { readSettings } from "./settings";
import { loadWorkItems } from "./work-items";

type Encrypt = (value: string) => Promise<string | null>;
type Decrypt = (value: string) => Promise<string>;

const itemsTtl = 2 * 60_000;
const fieldsTtl = 60 * 60_000;

/**
 * The Azure DevOps plugin: your work items or the team's for the composer,
 * optionally narrowed to the project by OpenRouter's System One.
 */
export class DevOps {
  private keys: DevOpsKeys;
  private auth: DevOpsAuth;
  private items = new Map<
    WorkItemScope,
    { key: string; at: number; items: WorkItem[] }
  >();
  private fieldList?: { key: string; at: number; fields: WorkItemField[] };
  private relevance: RelevanceFilter;

  constructor(
    private store: Store,
    private fetch: Fetch,
    encrypt: Encrypt,
    decrypt: Decrypt,
    /** Where the filter's answers are kept; none keeps them in memory. */
    cacheFile?: string,
  ) {
    this.keys = new DevOpsKeys(store, encrypt, decrypt);
    this.auth = new DevOpsAuth(fetch, () => this.keys.get("pat"));
    this.relevance = new RelevanceFilter(
      fetch,
      () => this.keys.get("openRouterKey"),
      cacheFile,
    );
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
      result.relevance = await this.relevance.filter(
        settings.filter,
        project,
        items,
      );
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
}
