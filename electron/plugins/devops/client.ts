import type { WorkItemField } from "../../../shared/devops";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The network failed, as opposed to Azure DevOps turning the sign-in down. */
export class DevOpsUnreachable extends Error {}

export interface IterationNode {
  id: number;
  attributes?: { startDate?: string; finishDate?: string };
  children?: IterationNode[];
}

/** A work item as the batch answers it: its fields by reference name. */
export interface FoundItem {
  id: number;
  fields: Record<string, unknown>;
}

const projectPath = (project: string) =>
  project ? `/${encodeURIComponent(project)}` : "";

/** Azure DevOps' REST API for one organization, with one sign-in. */
export class DevOpsClient {
  constructor(
    private fetch: Fetch,
    readonly base: string,
    private auth: string,
  ) {}

  async whoAmI() {
    const { authenticatedUser: user } = await this.request<{
      authenticatedUser?: {
        providerDisplayName?: string;
        properties?: { Account?: { $value?: string } };
      };
    }>(`${this.base}/_apis/connectionData`);
    return user?.providerDisplayName || user?.properties?.Account?.$value;
  }

  /** `project` empty asks the whole organization. */
  async fields(project: string): Promise<WorkItemField[]> {
    const { value } = await this.request<{ value: WorkItemField[] }>(
      `${this.base}${projectPath(project)}/_apis/wit/fields?api-version=7.1`,
    );
    return value
      .map(({ name, referenceName }) => ({ name, referenceName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The ids `query` finds, in its order. */
  async wiql(project: string, query: string) {
    const { workItems } = await this.request<{ workItems: { id: number }[] }>(
      `${this.base}${projectPath(project)}/_apis/wit/wiql?api-version=7.1&$top=200`,
      { query },
    );
    return workItems.map((w) => w.id).slice(0, 200);
  }

  /** Items it can't read are left out, in no particular order. */
  async workItems(ids: number[], fields: string[]): Promise<FoundItem[]> {
    const { value } = await this.request<{ value: FoundItem[] }>(
      `${this.base}/_apis/wit/workitemsbatch?api-version=7.1`,
      { ids, fields, errorPolicy: "omit" },
    );
    return value.filter(Boolean);
  }

  iterations(project: string) {
    return this.request<IterationNode>(
      `${this.base}/${encodeURIComponent(project)}/_apis/wit/classificationnodes/Iterations?$depth=10&api-version=7.1`,
    );
  }

  /** POSTs `body` as JSON, or GETs when there is none. */
  private async request<T>(url: string, body?: unknown) {
    let res: Response;
    try {
      res = await this.fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: this.auth,
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
}
