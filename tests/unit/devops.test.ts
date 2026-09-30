import { it, expect, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DevOps, DevOpsUnreachable, plainText } from "../../electron/devops";
import { Store } from "../../electron/store";
import {
  defaultDevOpsSettings,
  organizationUrl,
  type DevOpsSettings,
} from "../../shared/devops";
import type { Project } from "../../shared/projects";

const project: Project = {
  id: "p1",
  path: "/work/licensing",
  name: "licensing",
  repository: null,
  added: 1,
};
const settings: DevOpsSettings = {
  ...defaultDevOpsSettings,
  enabled: true,
  organization: "contoso",
  project: "Software",
  filter: {
    ...defaultDevOpsSettings.filter,
    enabled: true,
    keywords: { p1: "Licensing, license keys" },
  },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
const fields = (
  id: number,
  title: string,
  changed = "2026-09-22T10:00:00Z",
) => ({
  id,
  fields: {
    "System.Title": title,
    "System.WorkItemType": "User Story",
    "System.State": "Active",
    "System.AreaPath": "Software\\WEB",
    "System.TeamProject": "Software",
    "System.Tags": "Licensing; UX",
    "System.ChangedDate": changed,
    "System.Description": "<div>Improve <b>search</b>&nbsp;&amp; UX</div>",
  },
});

async function setup(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  cacheFile?: string,
) {
  const store = new Store(await mkdtemp(join(tmpdir(), "relay-devops-")));
  await store.load();
  const devops = new DevOps(
    store,
    fetch,
    async (v) => `sealed:${v}`,
    async (v) => v.replace(/^sealed:/, ""),
    cacheFile,
  );
  await devops.save(settings, { pat: "secret-pat", openRouterKey: "sk-or-1" });
  return { store, devops };
}

it("normalizes organization names and URLs", () => {
  expect(organizationUrl("contoso")).toBe(
    "https://dev.azure.com/contoso",
  );
  expect(organizationUrl("https://dev.azure.com/contoso/Software/_boards")).toBe(
    "https://dev.azure.com/contoso",
  );
  expect(organizationUrl("https://contoso.visualstudio.com/Software")).toBe(
    "https://contoso.visualstudio.com",
  );
  expect(() => organizationUrl("http://dev.azure.com/contoso")).toThrow(/https/);
});

it("turns work item HTML into plain text", () => {
  expect(
    plainText("<p>One&nbsp;&lt;two&gt;</p><ul><li>a</li><li>b</li></ul>"),
  ).toBe("One <two>\n- a\n- b");
  expect(plainText("&#x1F600; &#99999999; &#xFFFFFFF;")).toBe(
    "😀 &#99999999; &#xFFFFFFF;",
  );
});

it("loads assigned items, asks Jev one question per item and caches answers", async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (url.includes("/_apis/wit/wiql")) {
      expect(url).toBe(
        "https://dev.azure.com/contoso/Software/_apis/wit/wiql?api-version=7.1&$top=200",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Basic ${Buffer.from(":secret-pat").toString("base64")}`,
      );
      expect(body.query).toContain("[System.AssignedTo] = @Me");
      expect(body.query).toContain("[System.TeamProject] = @project");
      return json({ workItems: [{ id: 9789 }, { id: 10263 }] });
    }
    if (url.includes("workitemsbatch")) {
      expect(body.ids).toEqual([9789, 10263]);
      // The batch answers out of order; the WIQL order wins.
      return json({
        value: [
          fields(10263, "(Fleet project) Port Kiosk to Windows tablet"),
          fields(9789, "Licensing: extend and improve search options and UX"),
        ],
      });
    }
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer sk-or-1",
    );
    expect(body.model).toBe("jev-latest");
    expect(body.state.project).toMatchObject({
      name: "licensing",
      keywords: "Licensing, license keys",
    });
    expect(Object.keys(body.questions)).toEqual(["wi_9789", "wi_10263"]);
    expect(body.questions.wi_9789).toMatchObject({
      type: "noul",
      instructions: {
        work_item: {
          title: expect.stringContaining("Licensing"),
          tags: ["Licensing", "UX"],
        },
      },
    });
    return json({
      answers: {
        wi_9789: { type: "noul", noul: 0.96 },
        wi_10263: { type: "noul", noul: 0.03 },
      },
    });
  });
  const { store, devops } = await setup(fetch);
  expect(store.get().devopsPat).toBe("sealed:secret-pat");

  const first = await devops.workItems(project);
  expect(first.items.map((w) => w.id)).toEqual([9789, 10263]);
  expect(first.items[0]).toMatchObject({
    tags: ["Licensing", "UX"],
    description: "Improve search & UX",
    url: "https://dev.azure.com/contoso/Software/_workitems/edit/9789",
  });
  expect(first.relevance).toEqual({ 9789: 0.96, 10263: 0.03 });
  expect(fetch).toHaveBeenCalledTimes(3);

  // Cached items and answers need no further requests.
  await devops.workItems(project);
  expect(fetch).toHaveBeenCalledTimes(3);
  // A refresh reloads items, but unchanged items keep their answers.
  await devops.workItems(project, true);
  expect(fetch).toHaveBeenCalledTimes(5);
});

it("asks Jev again only when what it sees changes, even after a restart", async () => {
  let listed = [fields(1, "Licensing: search"), fields(2, "Port Kiosk")];
  const asked: string[][] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("wiql"))
      return json({ workItems: listed.map((w) => ({ id: w.id })) });
    if (url.includes("workitemsbatch")) return json({ value: listed });
    const keys = Object.keys(JSON.parse(String(init?.body)).questions);
    asked.push(keys);
    return json({
      answers: Object.fromEntries(
        keys.map((k) => [k, { type: "noul", noul: 0.9 }]),
      ),
    });
  });
  const cacheFile = join(
    await mkdtemp(join(tmpdir(), "relay-relevance-")),
    "relevance.json",
  );
  const { devops } = await setup(fetch, cacheFile);
  // Overlapping loads share one question.
  await Promise.all([
    devops.workItems(project, true),
    devops.workItems(project, true),
  ]);
  expect(asked).toEqual([["wi_1", "wi_2"]]);

  // A comment or state change bumps ChangedDate but not the question.
  listed = [
    {
      ...fields(1, "Licensing: search", "2026-09-23T08:00:00Z"),
      fields: {
        ...fields(1, "Licensing: search").fields,
        "System.State": "Resolved",
      },
    },
    fields(2, "Port Kiosk to Windows", "2026-09-23T08:00:00Z"),
  ];
  const next = await devops.workItems(project, true);
  expect(asked).toEqual([["wi_1", "wi_2"], ["wi_2"]]);
  expect(next.relevance).toEqual({ 1: 0.9, 2: 0.9 });

  // A fresh start reads the answers back from disk.
  const restarted = await setup(fetch, cacheFile);
  const again = await restarted.devops.workItems(project);
  expect(asked).toHaveLength(2);
  expect(again.relevance).toEqual({ 1: 0.9, 2: 0.9 });
  // New hints are a new question for every item.
  await restarted.devops.save(
    {
      ...settings,
      filter: { ...settings.filter, keywords: { p1: "Licensing, BM" } },
    },
    {},
  );
  await restarted.devops.workItems(project);
  expect(asked.at(-1)).toEqual(["wi_1", "wi_2"]);
});

it("keeps the list when the filter fails and explains rejected tokens", async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("wiql")) return json({ workItems: [{ id: 1 }] });
    if (url.includes("workitemsbatch"))
      return json({ value: [fields(1, "A")] });
    return json({ error: { message: "No credits" } }, 402);
  });
  const { devops } = await setup(fetch);
  const result = await devops.workItems(project);
  expect(result.items).toHaveLength(1);
  expect(result.relevance).toBeNull();
  expect(result.filterError).toContain("No credits");

  const rejected = await setup(
    async () => new Response("<html>Sign in</html>", { status: 203 }),
  );
  await expect(rejected.devops.workItems(null)).rejects.toThrow(
    /rejected the credentials/,
  );
});

it("never asks Azure DevOps or Jev for a hidden project", async () => {
  const fetch = vi.fn(async () => json({ workItems: [] }));
  const { devops, store } = await setup(fetch);
  await devops.save({ ...settings, hiddenProjects: ["p1"] }, {});
  const result = await devops.workItems(project);
  expect(result.items).toEqual([]);
  expect(result.relevance).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  // Settings saved before the field existed read back as nothing hidden.
  const { hiddenProjects: _, ...older } = settings;
  await store.update((s) => {
    s.devops = older as DevOpsSettings;
  });
  expect(devops.settings().hiddenProjects).toEqual([]);
});

it("sends an attached work item ahead of the user's message", async () => {
  const { workItemMessage } = await import("../../shared/devops");
  const item = {
    id: 9789,
    title: "Licensing: extend search",
    type: "User Story",
    state: "On Hold",
    areaPath: "Software\\WEB",
    project: "Software",
    tags: ["Licensing"],
    changed: "",
    description: "Customers cannot find licenses.",
    url: "https://dev.azure.com/contoso/Software/_workitems/edit/9789",
  };
  expect(workItemMessage(item, "@claude  go over it with me")).toBe(
    [
      "@claude User has selected this work item:",
      "User Story #9789: Licensing: extend search",
      "State: On Hold · Area: Software\\WEB · Tags: Licensing",
      "https://dev.azure.com/contoso/Software/_workitems/edit/9789",
      "",
      "Customers cannot find licenses.",
      "~",
      "go over it with me",
    ].join("\n"),
  );
  // Without a message there is no separator.
  expect(workItemMessage(item, "@codex")).not.toContain("~");
  expect(workItemMessage(item, "")).toMatch(/^User has selected/);
});

it("says who Azure DevOps takes the sign-in for, and tells a refusal from no network", async () => {
  const asked: string[] = [];
  const { devops } = await setup(async (url, init) => {
    asked.push(`${init?.method} ${url}`);
    return json({
      authenticatedUser: {
        providerDisplayName: "Ann Example",
        properties: { Account: { $value: "ann@example.com" } },
      },
    });
  });
  expect(await devops.whoAmI()).toBe("Ann Example");
  expect(asked).toEqual([
    "GET https://dev.azure.com/contoso/_apis/connectionData",
  ]);

  const refused = await setup(
    async () => new Response("<html>Sign in</html>", { status: 203 }),
  );
  await expect(refused.devops.whoAmI()).rejects.toThrow(/rejected/);
  const offline = await setup(async () => {
    throw new TypeError("fetch failed");
  });
  await expect(offline.devops.whoAmI()).rejects.toBeInstanceOf(
    DevOpsUnreachable,
  );
});

it("turns work items on only once there is an organization", async () => {
  const { devops } = await setup(async () => json({}));
  await devops.setEnabled(false);
  expect(devops.settings().enabled).toBe(false);
  // The rest of the settings stay as they were.
  expect(devops.settings().project).toBe("Software");
  await devops.save({ ...devops.settings(), organization: "" }, {});
  await expect(devops.setEnabled(true)).rejects.toThrow(/organization/);
});
