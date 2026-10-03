import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelevanceFilter } from "./relevance";
import { askSystemOne } from "./system-one";
import { toWorkItem } from "./parse";
import { defaultDevOpsSettings } from "../../../shared/devops";
import type { Project } from "../../../shared/projects";

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
  // Waits 500ms and 1s between tries, and none after the last.
  await vi.advanceTimersByTimeAsync(1500);
  await failed;
  expect(busy).toHaveBeenCalledTimes(3);

  await expect(
    askSystemOne(async () => json({}, 401), "sk-or", "jev-latest", {}, {}),
  ).rejects.toThrow("OpenRouter rejected the API key.");
});

/** OpenRouter answering 0.5 to every question, noting which were asked. */
function answeringFetch(asked: string[]) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const { questions } = JSON.parse(String(init!.body)) as {
      questions: Record<string, unknown>;
    };
    asked.push(...Object.keys(questions));
    return json({
      answers: Object.fromEntries(
        Object.keys(questions).map((k) => [k, { type: "noul", noul: 0.5 }]),
      ),
    });
  });
}

const task = (id: number) =>
  toWorkItem(
    "https://dev.azure.com/org",
    id,
    {
      "System.Title": `Item ${id}`,
      "System.WorkItemType": "Task",
      "System.AreaPath": "Software",
      "System.TeamProject": "Software",
    },
    new Set(),
  );

const relay = { id: "p1", path: "/work/relay", name: "relay" } as Project;
const settings = defaultDevOpsSettings.filter;

it("keeps answers when switching between your items and the team's", async () => {
  const asked: string[] = [];
  const filter = new RelevanceFilter(
    answeringFetch(asked),
    async () => "sk-or",
  );
  const mine = [task(1), task(2)];
  const team = [task(2), task(3)];

  await filter.filter(settings, relay, mine);
  await filter.filter(settings, relay, team);
  expect(await filter.filter(settings, relay, mine)).toEqual({
    1: 0.5,
    2: 0.5,
  });
  expect(asked).toEqual(["wi_1", "wi_2", "wi_3"]);
});

it("forgets the longest-unused answers past a thousand", async () => {
  const asked: string[] = [];
  const file = join(await mkdtemp(join(tmpdir(), "relay-relevance-")), "r");
  const filter = new RelevanceFilter(
    answeringFetch(asked),
    async () => "sk-or",
    file,
  );
  const tasks = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => task(from + i));

  await filter.filter(settings, relay, tasks(1, 1000));
  // Used again, so these outlive the rest of the first fifty.
  await filter.filter(settings, relay, tasks(41, 50));
  await filter.filter(settings, relay, tasks(1001, 1040));
  const saved = JSON.parse(await readFile(file, "utf8"));
  const [entry] = Object.values(saved.keys) as { answers: object }[];
  expect(Object.keys(entry.answers)).toHaveLength(1000);

  asked.length = 0;
  await filter.filter(settings, relay, tasks(41, 1040));
  expect(asked).toEqual([]);
  await filter.filter(settings, relay, tasks(40, 40));
  expect(asked).toEqual(["wi_40"]);
});
