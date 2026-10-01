import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelevanceFilter } from "../../electron/plugins/devops/relevance";
import { askSystemOne } from "../../electron/plugins/devops/system-one";
import { toWorkItem } from "../../electron/plugins/devops/parse";
import { defaultDevOpsSettings } from "../../shared/devops";
import type { Project } from "../../shared/projects";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.useRealTimers();
});

it("finds answers saved before, so the questions' shape stays put", async () => {
  // Hashes as an earlier Relay saved them for these items and this project.
  const file = join(await mkdtemp(join(tmpdir(), "relay-relevance-")), "r");
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      keys: {
        "8037f9b18384d63105c1212c30fb318e2162063160d264dc86b5e5d1a4f43201": {
          at: Date.now(),
          answers: {
            d58d27366db182321d4a652b08a6bd874867cef62a3cf3a3fb657e1faee362df: 0.75,
            b4c621bd2a1780c3c072e0910a03a8e52327926bf7d0dfc520ee8e75c767d19e: 0.25,
          },
        },
      },
    }),
  );
  const fetch = vi.fn(async () => json({}));
  const filter = new RelevanceFilter(fetch, async () => "sk-or", file);
  const project: Project = {
    id: "p1",
    path: "/work/licensing",
    name: "licensing",
    repository: { owner: "contoso", name: "licensing" },
    added: 1,
  } as Project;
  const items = [
    toWorkItem(
      "https://dev.azure.com/org",
      1,
      {
        "System.Title": "Licensing: search",
        "System.WorkItemType": "Bug",
        "System.AreaPath": "Software\\WEB",
        "System.TeamProject": "Software",
        "System.Tags": "Licensing; UX",
        "System.Description": "<p>Find keys</p>",
      },
      new Set(),
    ),
    toWorkItem(
      "https://dev.azure.com/org",
      2,
      {
        "System.Title": "Port Kiosk",
        "System.WorkItemType": "Task",
        "System.AreaPath": "Software",
        "System.TeamProject": "Software",
      },
      new Set(),
    ),
  ];
  const relevance = await filter.filter(
    { ...defaultDevOpsSettings.filter, keywords: { p1: "Licensing" } },
    project,
    items,
  );
  expect(relevance).toEqual({ 1: 0.75, 2: 0.25 });
  expect(fetch).not.toHaveBeenCalled();
});

it("waits out a busy OpenRouter and keeps only sensible answers", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({}, 429))
    .mockResolvedValueOnce(json({}, 529))
    .mockResolvedValueOnce(
      json({
        answers: {
          a: { type: "noul", noul: 0.4 },
          b: { type: "noul", noul: 1.5 },
          c: { type: "noul" },
        },
      }),
    );
  const asked = askSystemOne(fetch, "sk-or", "jev-latest", {}, { a: {} });
  await vi.advanceTimersByTimeAsync(1500);
  expect(await asked).toEqual({ a: 0.4 });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("gives up after three busy answers and names a refused key", async () => {
  vi.useFakeTimers();
  const busy = vi.fn(async () =>
    json({ error: { message: "Rate limited" } }, 429),
  );
  const asked = askSystemOne(busy, "sk-or", "jev-latest", {}, {});
  const failed = expect(asked).rejects.toThrow("Filter failed: Rate limited");
  await vi.advanceTimersByTimeAsync(3500);
  await failed;
  expect(busy).toHaveBeenCalledTimes(3);

  await expect(
    askSystemOne(async () => json({}, 401), "sk-or", "jev-latest", {}, {}),
  ).rejects.toThrow("OpenRouter rejected the API key.");
});
