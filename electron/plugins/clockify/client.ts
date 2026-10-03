import {
  clockifyHosts,
  type ClockifyHost,
  type ClockifyProject,
  type ClockifyWorkspace,
} from "../../../shared/clockify";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const PAGE_SIZE = 200;

/** Clockify keeps whole seconds. */
export const seconds = (ms: number) => Math.floor(ms / 1000) * 1000;
const iso = (ms: number) =>
  new Date(seconds(ms)).toISOString().replace(".000Z", "Z");
const MAX_PAGES = 25;

/**
 * Clockify's REST API with one person's key. Error messages never carry the
 * key: Clockify keys have no prefix, so redaction wouldn't spot one that
 * leaked into text.
 */
export class ClockifyClient {
  constructor(
    private fetch: Fetch,
    private host: ClockifyHost,
    private token: string,
  ) {}

  async user(): Promise<{
    id: string;
    name: string;
    email?: string;
    activeWorkspace?: string;
    defaultWorkspace?: string;
  }> {
    return this.request("GET", "/user");
  }

  async workspaces(): Promise<ClockifyWorkspace[]> {
    const list = await this.request<{ id: string; name: string }[]>(
      "GET",
      "/workspaces",
    );
    return list.map(({ id, name }) => ({ id, name }));
  }

  async projects(workspaceId: string): Promise<ClockifyProject[]> {
    const out: ClockifyProject[] = [];
    // Pages until one comes back empty, whichever page-size name the host honours.
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = await this.request<
        { id: string; name: string; clientName?: string; color?: string }[]
      >(
        "GET",
        `/workspaces/${encodeURIComponent(workspaceId)}/projects?archived=false&page=${page}&page-size=${PAGE_SIZE}`,
      );
      out.push(
        ...list.map(({ id, name, clientName, color }) => ({
          id,
          name,
          ...(clientName ? { clientName } : {}),
          ...(color ? { color } : {}),
        })),
      );
      if (!list.length) break;
    }
    return out;
  }

  /** The person's entries overlapping a range, start in whole seconds. */
  async entries(
    workspaceId: string,
    userId: string,
    start: number,
    end: number,
  ): Promise<{ id: string; projectId?: string; start: number }[]> {
    const list = await this.request<
      { id: string; projectId?: string; timeInterval?: { start?: string } }[]
    >(
      "GET",
      `/workspaces/${encodeURIComponent(workspaceId)}/user/${encodeURIComponent(userId)}/time-entries?start=${iso(start)}&end=${iso(end)}&page-size=${PAGE_SIZE}`,
    );
    return list.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      start: seconds(Date.parse(e.timeInterval?.start ?? "")),
    }));
  }

  async addEntry(
    workspaceId: string,
    entry: {
      start: number;
      end: number;
      projectId: string;
      description: string;
    },
  ): Promise<string> {
    const created = await this.request<{ id: string }>(
      "POST",
      `/workspaces/${encodeURIComponent(workspaceId)}/time-entries`,
      {
        start: iso(entry.start),
        end: iso(entry.end),
        projectId: entry.projectId,
        description: entry.description,
      },
    );
    if (!created?.id) throw new Error("Clockify didn't return the new entry.");
    return created.id;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetch(clockifyHosts[this.host].url + path, {
        method,
        headers: {
          "X-Api-Key": this.token,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("Couldn't reach Clockify. Check your connection.");
    }
    if (!response.ok) throw new Error(await this.failure(response));
    return (await response.json()) as T;
  }

  private async failure(response: Response) {
    if (response.status === 401)
      return "Clockify didn't accept the API key. Check it in Settings → Plugins.";
    if (response.status === 403)
      return "Your Clockify account can't do that in this workspace.";
    if (response.status === 429)
      return "Clockify is rate limiting Relay. Try again in a minute.";
    const detail = await response
      .json()
      .then((b) => {
        const message =
          typeof b === "object" && b && "message" in b ? b.message : undefined;
        return typeof message === "string" ? message.slice(0, 200) : "";
      })
      .catch(() => "");
    const safe = detail.split(this.token).join("[key]");
    return `Clockify answered ${response.status}${safe ? `: ${safe}` : "."}`;
  }
}
