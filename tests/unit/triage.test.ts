import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareCandidate,
  addRelatedChanges,
  takeBatch,
  serializeBatch,
  MAX_BATCH_FILES,
  type Candidate,
} from "../../electron/triage/evidence";
import {
  validateResponse,
  classifyChanges,
  INCOMPLETE_HUNKS_REASON,
  INVALID_BATCH_PREFIX,
  type ClassificationResult,
} from "../../electron/triage/classifier";
import { TriageService } from "../../electron/triage/service";
import { Store } from "../../electron/store";
import type { ChangedFile, FilePair, Pull } from "../../shared/types";
import type { Gitea } from "../../electron/gitea";

const head = "a".repeat(40),
  base = "b".repeat(40),
  ref = { owner: "team", name: "project", number: 1 };
const before = `import { Component, ChangeDetectorRef } from '@angular/core';
@Component({selector:'app-card', template:''})
export class Card {
  constructor(private readonly cd: ChangeDetectorRef) {}
  refresh() { this.cd.markForCheck(); }
}`;
const after = before
  .replace(
    "Component, ChangeDetectorRef",
    "Component, ChangeDetectorRef, inject",
  )
  .replace(
    "constructor(private readonly cd: ChangeDetectorRef) {}",
    "private readonly cd = inject(ChangeDetectorRef);",
  );
const file = (filename = "card.ts"): ChangedFile => ({
  filename,
  status: "modified",
  additions: 2,
  deletions: 2,
  changes: 4,
});
const pair = (a = before, b = after): FilePair => ({
  old: { name: "card.ts", contents: a, cacheKey: "old" },
  next: { name: "card.ts", contents: b, cacheKey: "new" },
  binary: false,
});
const candidate = (a = before, b = after) =>
  prepareCandidate(file(), pair(a, b));

describe("Generic change evidence", () => {
  it.each([
    ["python", "client.fetch(item)", "await client.fetch(item)"],
    ["yaml", "timeout: 10", "timeout: 30"],
    ["css", ".card { color: #fff; }", ".card { color: var(--foreground); }"],
    ["php", "$log->warn($error);", "$log->warning($error);"],
    [
      "ts",
      before.replace("class Card", "class Card extends Base"),
      after.replace("class Card", "class Card extends Base"),
    ],
    ["md", "Use the old command.", "Use the new command."],
  ])(
    "offers %s changes to the model without a predefined rule",
    (_language, a, b) => {
      const result = candidate(a, b) as Candidate;
      expect(result.path).toBe("card.ts");
      expect(JSON.parse(result.evidence).completePatch).toContain("@@");
      expect(JSON.parse(result.evidence).completePatch).toContain(
        a.split("\n")[0],
      );
    },
  );
  it("preserves every hunk, including an unrelated edit far from the repeated change", () => {
    const a =
      "oldApi();\n" + "// context\n".repeat(50) + "const timeout = 10;\n";
    const b = a.replace("oldApi", "newApi").replace("= 10", "= 30");
    const result = candidate(a, b) as Candidate;
    expect(result.hunks).toBe(2);
    const evidence = JSON.parse(result.evidence);
    expect(evidence.completePatch).toContain("+newApi()");
    expect(evidence.completePatch).toContain("+const timeout = 30");
  });
  it("does not reject generics, parameter decorators, constructor work or compiler directives", () => {
    const a =
      "// @ts-ignore\nclass Card extends Base { constructor(@Inject(DATA) private data: Options) { super(data); this.ready = true; } }";
    const b =
      "// @ts-ignore\nclass Card extends Base { private data = inject<Options>(DATA); constructor() { super(); this.ready = true; } }";
    expect(typeof candidate(a, b)).toBe("object");
  });
  it("includes added/deleted files and path-only renames", () => {
    expect(
      typeof prepareCandidate(
        { ...file(), status: "added" },
        { ...pair(), old: null },
      ),
    ).toBe("object");
    expect(
      typeof prepareCandidate(
        { ...file(), status: "deleted" },
        { ...pair(), next: null },
      ),
    ).toBe("object");
    const renamed = prepareCandidate(
      { ...file("new.ts"), previous_filename: "old.ts", status: "renamed" },
      pair(before, before),
    ) as Candidate;
    expect(renamed.hunks).toBe(0);
    expect(JSON.parse(renamed.evidence).previousPath).toBe("old.ts");
  });
  it("limits unchanged context without ever truncating the changed hunks", () => {
    const a = "// existing content\n".repeat(2000) + "oldApi();\n";
    const result = candidate(a, a.replace("oldApi", "newApi")) as Candidate;
    expect(result.evidence.length).toBeLessThan(2000);
    expect(JSON.parse(result.evidence).context.scope).toContain("omitted");
    expect(result.patch).toContain("+newApi()");
    expect(typeof candidate("", "added line\n".repeat(4000))).toBe("string");
    expect(typeof prepareCandidate(file(), { ...pair(), binary: true })).toBe(
      "string",
    );
    expect(typeof prepareCandidate(file(), { ...pair(), old: null })).toBe(
      "string",
    );
  });
  it("attaches the changed base class through relative and alias imports, not unrelated files", () => {
    const baseFile = {
      ...(candidate(
        "class Base { constructor(ref) {} }",
        "class Base { ref = acquire(); }",
      ) as Candidate),
      path: "src/core/base.ts",
    };
    for (const ref of ["../core/base", "core/base"]) {
      const child = {
        ...(candidate(
          `import { Base } from '${ref}'; class Card extends Base { constructor(ref) { super(ref); } }`,
          `import { Base } from '${ref}'; class Card extends Base { constructor() { super(); } }`,
        ) as Candidate),
        path: "src/ui/card.ts",
      };
      const other = { ...(candidate() as Candidate), path: "src/other.ts" };
      const result = addRelatedChanges(
        child,
        new Map([baseFile, child, other].map((c) => [c.path, c])),
      );
      expect(
        JSON.parse(result.evidence).relatedChanges.map((c: any) => c.path),
      ).toEqual(["src/core/base.ts"]);
    }
  });
  it("batches every eligible file exactly once, including unique edits, without unbounded context", () => {
    const all = Array.from({ length: 19 }, (_, i) => ({
      ...(candidate(`const n = ${i};`, `const n = ${i + 2};`) as Candidate),
      path: `${i}.txt`,
      evidence: JSON.stringify({ completePatch: "x".repeat(14_000) }),
    }));
    const pending = [...all],
      output: Candidate[] = [];
    while (pending.length) {
      const batch = takeBatch(pending);
      expect(serializeBatch(batch).length).toBeLessThanOrEqual(60_000);
      expect(batch.length).toBeLessThanOrEqual(MAX_BATCH_FILES);
      output.push(...batch);
    }
    expect(output.map((c) => c.path).sort()).toEqual(
      all.map((c) => c.path).sort(),
    );
  });
  it("sends shared dependency context once without dropping candidate changes", () => {
    const c = candidate() as Candidate;
    const related = { path: "base.ts", completePatch: "shared parent change" };
    const withReference = (path: string) => ({
      ...c,
      path,
      evidence: JSON.stringify({
        ...JSON.parse(c.evidence),
        relatedChanges: [related],
      }),
    });
    const packet = JSON.parse(
      serializeBatch([withReference("one.ts"), withReference("two.ts")]),
    );
    expect(packet.relatedChanges).toEqual([related]);
    expect(packet.candidates.map((c: any) => c.relatedPaths)).toEqual([
      ["base.ts"],
      ["base.ts"],
    ]);
    expect(
      packet.candidates.every((x: any) => x.completePatch === c.patch),
    ).toBe(true);
    const parent = { ...c, path: "base.ts" };
    expect(
      JSON.parse(serializeBatch([withReference("one.ts"), parent]))
        .relatedChanges,
    ).toEqual([]);
  });
});
const definition = {
  pattern: "p1",
  name: "Constructor dependencies → fields",
  description: "Move constructor dependencies into fields.",
  rule: "Replace constructor dependency parameters with equivalent field acquisition and the required import changes; no unrelated edits.",
};
const answer = (c: Candidate[]): ClassificationResult => ({
  groups: c.some((x) => x.path !== "mixed.ts") ? [definition] : [],
  files: c.map((x) => ({
    path: x.path,
    ...(x.path === "mixed.ts"
      ? { pattern: "" as const, decision: "normal" as const }
      : { pattern: "p1", decision: "group" as const }),
    reason:
      x.path === "mixed.ts"
        ? "Also changes refresh behavior."
        : "Only the common transformation.",
    coveredHunks:
      x.path === "mixed.ts"
        ? []
        : Array.from({ length: x.hunks }, (_, i) => i + 1),
  })),
});
describe("Model decision boundaries", () => {
  const c = candidate() as Candidate;
  it("rejects missing, duplicate, invented and partially covered file decisions", () => {
    expect(() => validateResponse(answer([c]), [c])).not.toThrow();
    const good = answer([c]);
    for (const value of [
      { ...good, files: [] },
      answer([c, c]),
      answer([{ ...c, path: "other.ts" }]),
      { ...good, groups: [] },
      {
        ...good,
        groups: [{ ...definition, pattern: "p999" }],
        files: [{ ...good.files[0], pattern: "p999" }],
      },
    ])
      expect(() => validateResponse(value, [c])).toThrow();
  });
  it("keeps valid file decisions when another file has incomplete, duplicate or invented hunk coverage", () => {
    const candidates = [
      c,
      { ...c, path: "two.ts" },
      { ...c, path: "three.ts" },
    ];
    for (const coveredHunks of [[], [1, 1], [2]]) {
      const good = answer(candidates);
      good.files[0].coveredHunks = coveredHunks;
      const result = validateResponse(good, candidates);
      expect(result.rejectedFiles).toEqual([c.path]);
      expect(result.files[0]).toMatchObject({
        decision: "normal",
        pattern: "",
        coveredHunks: [],
      });
      expect(result.files.slice(1).every((f) => f.decision === "group")).toBe(
        true,
      );
      expect(result.groups).toEqual([definition]);
    }
    const rejected = answer([c]);
    rejected.files[0].coveredHunks = [];
    expect(validateResponse(rejected, [c]).groups).toEqual([]);
  });
  it("prevents a later batch from redefining a pattern to absorb unrelated changes", () => {
    const good = answer([c]);
    expect(() => validateResponse(good, [c], [definition])).not.toThrow();
    expect(() =>
      validateResponse({ ...good, groups: [] }, [c], [definition], "match"),
    ).not.toThrow();
    expect(() =>
      validateResponse(
        { ...good, groups: [{ ...definition, rule: "Any cleanup" }] },
        [c],
        [definition],
      ),
    ).toThrow("changed an existing pattern");
  });
  it("normal decisions cannot claim a group or hunk coverage", () => {
    const mixed = { ...c, path: "mixed.ts" };
    const good = answer([mixed]);
    expect(() => validateResponse(good, [mixed])).not.toThrow();
    expect(() =>
      validateResponse(
        { ...good, files: [{ ...good.files[0], pattern: "p1" }] },
        [mixed],
      ),
    ).toThrow();
  });
});
async function fixture(
  classify = vi.fn<typeof classifyChanges>(async (c: Candidate[]) => ({
    result: answer(c),
    rejectedFiles: [],
    usage: { inputTokens: 100, outputTokens: 50, batches: 1 },
  })),
  limits: ConstructorParameters<typeof TriageService>[3] = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "relay-triage-")),
    store = new Store(dir);
  await store.load();
  const files = [file("one.ts"), file("two.ts"), file("mixed.ts")];
  let current = head,
    reviewComments: any[] = [];
  const client = {
    pr: () => "/pulls/1",
    pull: async () =>
      ({
        ...ref,
        head: { sha: current },
        merge_base: base,
        changed_files: files.length,
      }) as Pull,
    page: async (path: string) => ({
      items: path.endsWith("/reviews")
        ? reviewComments.length
          ? [{ id: 1, comments_count: reviewComments.length }]
          : []
        : files,
      nextPage: null,
    }),
    request: async () => ({ data: reviewComments }),
    contentsAt: async (_p: Pull, f: ChangedFile) =>
      pair(
        before,
        f.filename === "mixed.ts"
          ? after.replace("markForCheck", "detach")
          : after,
      ),
  } as unknown as Gitea;
  const service = new TriageService(store, dir, classify, limits);
  return {
    dir,
    store,
    files,
    client,
    service,
    classify,
    setHead: (v: string) => (current = v),
    setComments: (v: any[]) => (reviewComments = v),
  };
}
async function finish(f: Awaited<ReturnType<typeof fixture>>) {
  await vi.waitFor(async () =>
    expect((await f.service.state("key", `${base}:${head}`))?.status).toMatch(
      /complete|failed|paused/,
    ),
  );
  return (await f.service.state("key", `${base}:${head}`))!;
}
describe("Analysis lifecycle and durable groups", () => {
  it("counts only unresolved validation failures and keeps valid mixed decisions separate", async () => {
    const f = await fixture();
    f.files.push(file("three.ts"));
    f.classify.mockImplementation(async (c) => {
      const result = answer(c);
      result.files = result.files.map((file) =>
        file.path === "one.ts"
          ? {
              path: file.path,
              decision: "normal",
              pattern: "",
              coveredHunks: [],
              reason: INCOMPLETE_HUNKS_REASON,
            }
          : file,
      );
      return {
        result,
        rejectedFiles: ["one.ts"],
        usage: { inputTokens: 100, outputTokens: 20, batches: 1 },
      };
    });
    await f.service.start(f.client, ref, "key", head, base);
    const state = await finish(f);
    expect(state.result!.incompleteFiles).toEqual(["one.ts"]);
    expect(state.result!.notice).toContain("1 file needs another attempt");
    expect(state.result!.groups[0].paths.sort()).toEqual([
      "three.ts",
      "two.ts",
    ]);
    expect(state.result!.ordinary["mixed.ts"]).toBeTruthy();
    expect(f.store.get().progress).toEqual({});
    const reopened = new TriageService(f.store, f.dir, f.classify);
    expect((await reopened.state("key", `${base}:${head}`))?.result).toEqual(
      state.result,
    );
  });
  it.each(["recovered", "hunks", "batch"] as const)(
    "repairs a legacy warning without reanalyzing or changing decisions: %s",
    async (kind) => {
      const f = await fixture();
      await f.service.start(f.client, ref, "key", head, base);
      await finish(f);
      const cachedPath = join(
        f.dir,
        "analysis",
        (await readdir(join(f.dir, "analysis")))[0],
      );
      const cached = JSON.parse(await readFile(cachedPath, "utf8"));
      delete cached.incompleteFiles;
      delete cached.checkpoint;
      cached.notice =
        "Some Luna decisions were incomplete. Valid decisions were kept; see individual-file explanations.";
      if (kind === "hunks")
        cached.ordinary["mixed.ts"] = INCOMPLETE_HUNKS_REASON;
      if (kind === "batch")
        cached.ordinary["mixed.ts"] =
          `${INVALID_BATCH_PREFIX} The final response was not JSON.`;
      await writeFile(cachedPath, JSON.stringify(cached));
      const reopened = new TriageService(f.store, f.dir, f.classify);
      const result = (await reopened.state("key", `${base}:${head}`))!.result!;
      expect(result.incompleteFiles).toEqual(
        kind === "recovered" ? [] : ["mixed.ts"],
      );
      if (kind === "recovered") expect(result.notice).toBeUndefined();
      else expect(result.notice).toContain("classifying 1 file.");
      expect(result.groups).toEqual(cached.groups);
      expect(result.ordinary).toEqual(cached.ordinary);
      expect(f.classify).toHaveBeenCalledTimes(1);
      expect(f.store.get().progress).toEqual({});
    },
  );
  it("preserves verified groups and accounts for unchecked files if a later model request fails", async () => {
    const f = await fixture();
    f.files.push(
      ...Array.from({ length: MAX_BATCH_FILES }, (_, i) =>
        file(`extra-${i}.ts`),
      ),
    );
    f.classify.mockImplementationOnce(async (c) => ({
      result: answer(c),
      rejectedFiles: [],
      usage: { inputTokens: 2000, outputTokens: 100, batches: 1 },
    }));
    f.classify.mockRejectedValueOnce(new Error("Connection lost"));
    await f.service.start(f.client, ref, "key", head, base);
    const state = await finish(f);
    expect(state.status).toBe("paused");
    expect(state.resume?.remaining).toBeGreaterThan(0);
    expect(state.result!.groups[0].paths.length).toBeGreaterThan(1);
    expect(Object.values(state.result!.ordinary)).toContain("Connection lost");
    expect(f.store.get().progress).toEqual({});
  });
  it("reports budget exhaustion and keeps every unchecked file in individual review", async () => {
    const f = await fixture();
    f.files.push(
      ...Array.from({ length: MAX_BATCH_FILES }, (_, i) =>
        file(`extra-${i}.ts`),
      ),
    );
    f.classify.mockImplementation(async (c) => ({
      result: answer(c),
      rejectedFiles: [],
      usage: { inputTokens: 700_000, outputTokens: 100, batches: 1 },
    }));
    await f.service.start(f.client, ref, "key", head, base);
    const state = await finish(f);
    expect(state.status).toBe("paused");
    expect(f.classify).toHaveBeenCalledTimes(1);
    expect(state.result!.notice).toContain("budget limit");
    const checked = new Set(f.classify.mock.calls[0][0].map((c) => c.path));
    for (const file of f.files.filter((f) => !checked.has(f.filename)))
      expect(state.result!.ordinary[file.filename]).toContain("budget reached");
    expect(
      new Set([
        ...state.result!.groups.flatMap((g) => g.paths),
        ...Object.keys(state.result!.ordinary),
      ]).size,
    ).toBe(f.files.length);
    expect(f.store.get().progress).toEqual({});
  });
  it.each(["group", "normal"] as const)(
    "clears recovered validation failures when the later decision is %s",
    async (decision) => {
      let calls = 0;
      const classify = vi.fn<typeof classifyChanges>(
        async (c, known, _signal, mode) => {
          calls++;
          const matches = c.filter(
            (x) =>
              (calls > 1 && decision === "group" && x.path === "one.ts") ||
              x.path === "z.ts",
          );
          return {
            result: {
              groups: matches.length ? [definition] : [],
              files: c.map((x) => ({
                path: x.path,
                ...(matches.includes(x)
                  ? { pattern: "p1", decision: "group" as const }
                  : { pattern: "" as const, decision: "normal" as const }),
                reason: matches.includes(x)
                  ? "Matches the discovered transformation."
                  : calls === 1 && x.path === "one.ts"
                    ? INCOMPLETE_HUNKS_REASON
                    : "Contains unrelated behavior changes.",
                coveredHunks: matches.includes(x)
                  ? Array.from({ length: x.hunks }, (_, i) => i + 1)
                  : [],
              })),
            },
            rejectedFiles: calls === 1 ? ["one.ts"] : [],
            usage: { inputTokens: 100, outputTokens: 20, batches: 1 },
          };
        },
      );
      const f = await fixture(classify);
      f.files.push(
        ...Array.from({ length: MAX_BATCH_FILES - 3 }, (_, i) =>
          file(`x${i}.ts`),
        ),
        file("z.ts"),
      );
      const contents = f.client.contentsAt.bind(f.client);
      f.client.contentsAt = async (pull, file) =>
        file.filename === "z.ts"
          ? pair(
              ...([before, after].map((s) =>
                s
                  .replaceAll("Component", "Directive")
                  .replaceAll("ChangeDetectorRef", "ElementRef")
                  .replaceAll("Card", "Tile")
                  .replaceAll("cd", "element")
                  .replaceAll("refresh", "redraw")
                  .replaceAll("markForCheck", "remove"),
              ) as [string, string]),
            )
          : contents(pull, file);
      await f.service.start(f.client, ref, "key", head, base);
      const state = await finish(f);
      expect(state.status).toBe("complete");
      expect(classify.mock.calls.at(-1)![3]).toBe("match");
      expect(classify.mock.calls.at(-1)![1]).toEqual([definition]);
      expect(classify.mock.calls[1][0].map((c) => c.path)).toEqual(["one.ts"]);
      if (decision === "group") {
        expect(state.result!.groups[0].paths.sort()).toEqual([
          "one.ts",
          "z.ts",
        ]);
        expect(state.result!.ordinary["one.ts"]).toBeUndefined();
      } else {
        expect(state.result!.groups).toEqual([]);
        expect(state.result!.ordinary["one.ts"]).toBe(
          "Contains unrelated behavior changes.",
        );
      }
      expect(state.result!.incompleteFiles).toEqual([]);
      expect(state.result!.notice).toBeUndefined();
      expect(f.store.get().progress).toEqual({});
    },
  );
  it("groups only complete matching files, persists results and never marks viewed automatically", async () => {
    const f = await fixture();
    await f.service.start(f.client, ref, "key", head, base);
    const state = await finish(f);
    expect(state.status).toBe("complete");
    expect(state.result!.groups[0].paths).toEqual(["one.ts", "two.ts"]);
    expect(f.classify.mock.calls[0][0].map((c) => c.path)).toContain(
      "mixed.ts",
    );
    expect(state.result!.ordinary["mixed.ts"]).toBeTruthy();
    expect(f.store.get().progress).toEqual({});
    const reopened = new TriageService(f.store, f.dir, f.classify);
    expect((await reopened.state("key", `${base}:${head}`))?.result).toEqual(
      state.result,
    );
    expect(await reopened.state("key", `${base}:${"c".repeat(40)}`)).toBeNull();
    expect(
      await f.service.groupPaths(
        f.client,
        ref,
        "key",
        head,
        base,
        state.result!.groups[0].id,
      ),
    ).toEqual(["one.ts", "two.ts"]);
    f.setHead("c".repeat(40));
    await expect(
      f.service.groupPaths(
        f.client,
        ref,
        "key",
        head,
        base,
        state.result!.groups[0].id,
      ),
    ).rejects.toThrow("new commits");
  });
  it("excludes drafts, bookmarks and discussions, including new ones before bulk review", async () => {
    const f = await fixture();
    await f.service.start(f.client, ref, "key", head, base);
    const state = await finish(f);
    await f.store.update((s) => {
      s.progress.key = {
        read: {},
        drafts: [
          {
            id: "d",
            path: "one.ts",
            body: "Check this",
            line: 1,
            side: "additions",
            revision: `${base}:${head}`,
            createdAt: "",
          },
        ],
        marks: [],
      };
    });
    expect(
      await f.service.groupPaths(
        f.client,
        ref,
        "key",
        head,
        base,
        state.result!.groups[0].id,
      ),
    ).toEqual(["two.ts"]);
    f.setComments([{ path: "two.ts" }]);
    await expect(
      f.service.groupPaths(
        f.client,
        ref,
        "key",
        head,
        base,
        state.result!.groups[0].id,
      ),
    ).rejects.toThrow("discussions");
  });
  it("pauses a running request with a durable retry queue", async () => {
    const f = await fixture(
      vi.fn(
        (_c, _n, signal: AbortSignal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true },
            ),
          ),
      ) as any,
    );
    await f.service.start(f.client, ref, "key", head, base);
    await vi.waitFor(() => expect(f.classify).toHaveBeenCalled());
    f.service.cancel();
    const state = await finish(f);
    expect(state.status).toBe("paused");
    expect(state.result!.groups).toEqual([]);
    expect(state.resume!.remaining).toBe(3);
    const reopened = new TriageService(f.store, f.dir, f.classify);
    expect(
      (await reopened.state("key", `${base}:${head}`))!.resume!.remaining,
    ).toBe(3);
    expect(f.store.get().progress).toEqual({});
  });
  it("discards results if a new commit arrives during analysis", async () => {
    const f = await fixture();
    f.classify.mockImplementation(async (c: Candidate[]) => {
      f.setHead("c".repeat(40));
      return {
        result: answer(c),
        rejectedFiles: [],
        usage: { inputTokens: 100, outputTokens: 50, batches: 1 },
      };
    });
    await f.service.start(f.client, ref, "key", head, base);
    expect((await finish(f)).status).toBe("failed");
  });
  it("resumes after repeated budget pauses without downloading or classifying successful files twice", async () => {
    const f = await fixture(undefined, { batches: 1 });
    f.files.push(
      ...Array.from({ length: MAX_BATCH_FILES * 2 }, (_, i) =>
        file(`extra-${i}.ts`),
      ),
    );
    const downloads = vi.spyOn(f.client, "contentsAt");
    const allDecided = new Set<string>();
    let lastRemaining = f.files.length;
    for (let run = 0; run < 3; run++) {
      f.service = new TriageService(f.store, f.dir, f.classify, { batches: 1 });
      await f.service.start(f.client, ref, "key", head, base);
      const state = await finish(f);
      const paths = f.classify.mock.calls.at(-1)![0].map((c) => c.path);
      for (const path of paths) {
        expect(allDecided.has(path)).toBe(false);
        allDecided.add(path);
      }
      expect(state.usage.batches).toBe(run + 1);
      expect(downloads).toHaveBeenCalledTimes(f.files.length);
      if (run < 2) {
        expect(state.status).toBe("paused");
        expect(state.resume!.remaining).toBeLessThan(lastRemaining);
        lastRemaining = state.resume!.remaining;
        expect(
          await f.service.groupPaths(
            f.client,
            ref,
            "key",
            head,
            base,
            state.result!.groups[0].id,
          ),
        ).toEqual(state.result!.groups[0].paths);
      } else {
        expect(state.status).toBe("complete");
        expect(state.resume).toBeUndefined();
      }
    }
    expect(allDecided.size).toBe(f.files.length);
    expect(f.store.get().progress).toEqual({});
  });
  it("keeps discovery rules and a matching queue across an application restart", async () => {
    const classify = vi.fn<typeof classifyChanges>(
      async (c, known, _signal, mode) => ({
        result: {
          groups:
            !known.length && c.some((x) => x.path === "z.ts")
              ? [definition]
              : [],
          files: c.map((x) => ({
            path: x.path,
            ...(mode === "match" || x.path === "z.ts"
              ? { decision: "group" as const, pattern: "p1" }
              : { decision: "normal" as const, pattern: "" as const }),
            reason: "Valid decision",
            coveredHunks:
              mode === "match" || x.path === "z.ts"
                ? Array.from({ length: x.hunks }, (_, i) => i + 1)
                : [],
          })),
        },
        rejectedFiles: [],
        usage: { inputTokens: 100, outputTokens: 20, batches: 1 },
      }),
    );
    const f = await fixture(classify, { batches: 2 });
    f.files.splice(
      0,
      f.files.length,
      ...Array.from({ length: 12 }, (_, i) => file(`a${i}.ts`)),
      file("z.ts"),
    );
    await f.service.start(f.client, ref, "key", head, base);
    const paused = await finish(f);
    expect(paused.status).toBe("paused");
    expect(paused.resume!.remaining).toBe(12);
    const reload = new TriageService(f.store, f.dir, classify);
    expect(
      (await reload.state("key", `${base}:${head}`))!.resume!.remaining,
    ).toBe(12);
    f.service = reload;
    await reload.start(f.client, ref, "key", head, base);
    const done = await finish(f);
    expect(done.status).toBe("complete");
    expect(classify.mock.calls.at(-1)![3]).toBe("match");
    expect(classify.mock.calls.at(-1)![1]).toEqual([definition]);
    expect(classify.mock.calls.at(-1)![0].map((c) => c.path)).not.toContain(
      "z.ts",
    );
    expect(done.result!.groups[0].paths).toHaveLength(13);
  });
  it("recovers the last completed batch after interruption and retries only the in-flight work", async () => {
    const f = await fixture();
    f.files.push(
      ...Array.from({ length: 12 }, (_, i) => file(`extra-${i}.ts`)),
    );
    f.classify.mockImplementationOnce(async (c) => ({
      result: answer(c),
      rejectedFiles: [],
      usage: { inputTokens: 100, outputTokens: 20, batches: 1 },
    }));
    f.classify.mockImplementationOnce(
      (_c, _n, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("Stopped")), {
            once: true,
          }),
        ),
    );
    await f.service.start(f.client, ref, "key", head, base);
    await vi.waitFor(() => expect(f.classify).toHaveBeenCalledTimes(2));
    // A fresh instance reads disk while the old invocation is still in flight.
    const restored = await new TriageService(f.store, f.dir, f.classify).state(
      "key",
      `${base}:${head}`,
    );
    expect(restored!.status).toBe("paused");
    expect(restored!.result!.groups[0].paths.length).toBeGreaterThan(1);
    const interrupted = f.classify.mock.calls[1][0].map((c) => c.path).sort();
    f.service.cancel();
    await finish(f);
    f.service = new TriageService(f.store, f.dir, f.classify);
    await f.service.start(f.client, ref, "key", head, base);
    expect((await finish(f)).status).toBe("complete");
    expect(f.classify.mock.calls[2][0].map((c) => c.path).sort()).toEqual(
      interrupted,
    );
    expect(f.classify).toHaveBeenCalledTimes(3);
  });
  it("retries a failed file fetch while preserving already fetched evidence and decisions", async () => {
    const f = await fixture();
    const original = f.client.contentsAt.bind(f.client);
    const downloads = vi
      .spyOn(f.client, "contentsAt")
      .mockRejectedValueOnce(new Error("Temporary file fetch failure"))
      .mockImplementation(original);
    await f.service.start(f.client, ref, "key", head, base);
    expect((await finish(f)).resume!.remaining).toBe(1);
    const calls = downloads.mock.calls.length;
    f.service = new TriageService(f.store, f.dir, f.classify);
    await f.service.start(f.client, ref, "key", head, base);
    expect((await finish(f)).status).toBe("complete");
    expect(downloads).toHaveBeenCalledTimes(calls + 1);
    expect(downloads.mock.calls.at(-1)![1].filename).toBe("one.ts");
  });
  it("resumes a legacy partial result while retaining its confirmed groups", async () => {
    const f = await fixture();
    await f.service.start(f.client, ref, "key", head, base);
    await finish(f);
    const path = join(
      f.dir,
      "analysis",
      (await readdir(join(f.dir, "analysis")))[0],
    );
    const cached = JSON.parse(await readFile(path, "utf8"));
    delete cached.checkpoint;
    cached.notice =
      "Analysis budget reached. Remaining files stay in individual review; some earlier files could not be checked against later patterns.";
    cached.ordinary["mixed.ts"] =
      "Analysis budget reached before all pattern checks finished";
    await writeFile(path, JSON.stringify(cached));
    f.classify.mockClear();
    f.service = new TriageService(f.store, f.dir, f.classify);
    expect(
      (await f.service.state("key", `${base}:${head}`))!.resume!.remaining,
    ).toBe(1);
    await f.service.start(f.client, ref, "key", head, base);
    const done = await finish(f);
    expect(done.status).toBe("complete");
    expect(done.result!.groups).toEqual(cached.groups);
    expect(f.classify.mock.calls[0][0].map((c) => c.path)).toEqual([
      "mixed.ts",
    ]);
  });
  it("does not resume a checkpoint against a changed PR or overwrite a corrupt checkpoint", async () => {
    const f = await fixture(undefined, { batches: 1 });
    f.files.push(
      ...Array.from({ length: 12 }, (_, i) => file(`extra-${i}.ts`)),
    );
    await f.service.start(f.client, ref, "key", head, base);
    await finish(f);
    const path = join(
      f.dir,
      "analysis",
      (await readdir(join(f.dir, "analysis")))[0],
    );
    const before = await readFile(path, "utf8");
    f.service = new TriageService(f.store, f.dir, f.classify);
    f.setHead("c".repeat(40));
    await f.service.start(f.client, ref, "key", head, base);
    expect((await finish(f)).status).toBe("failed");
    expect(f.classify).toHaveBeenCalledTimes(1);
    expect(await readFile(path, "utf8")).toBe(before);
    await writeFile(path, "{interrupted write");
    f.service = new TriageService(f.store, f.dir, f.classify);
    await expect(
      f.service.start(f.client, ref, "key", head, base),
    ).rejects.toThrow("preserved");
    expect(await readFile(path, "utf8")).toBe("{interrupted write");
  });
  it("gives recovered and newly discovered groups distinct identities", async () => {
    const f = await fixture();
    await f.service.start(f.client, ref, "key", head, base);
    await finish(f);
    const path = join(
      f.dir,
      "analysis",
      (await readdir(join(f.dir, "analysis")))[0],
    );
    const cached = JSON.parse(await readFile(path, "utf8"));
    delete cached.checkpoint;
    cached.groups[0].id = createHash("sha256")
      .update(JSON.stringify([2, "p1", `${base}:${head}`, "gpt-5.6-luna"]))
      .digest("hex");
    cached.notice = "Analysis budget reached.";
    const additional = [file("extra-a.ts"), file("extra-b.ts")];
    f.files.push(...additional);
    cached.files.push(...additional);
    for (const file of additional)
      cached.ordinary[file.filename] =
        "Analysis budget reached before all pattern checks finished";
    await writeFile(path, JSON.stringify(cached));
    f.service = new TriageService(f.store, f.dir, f.classify);
    await f.service.start(f.client, ref, "key", head, base);
    const state = await finish(f);
    expect(state.status).toBe("complete");
    expect(state.result!.groups).toHaveLength(2);
    expect(new Set(state.result!.groups.map((g) => g.id)).size).toBe(2);
    for (const group of state.result!.groups)
      expect(
        await f.service.groupPaths(f.client, ref, "key", head, base, group.id),
      ).toEqual(group.paths);
  });
});

describe("Configured grouping models", () => {
  it("pins a resumed checkpoint to its original model and speed, then applies new settings to fresh analysis", async () => {
    const f = await fixture(undefined, { batches: 1 });
    f.files.push(
      ...Array.from({ length: MAX_BATCH_FILES }, (_, i) =>
        file(`extra-${i}.ts`),
      ),
    );
    const original = {
      model: "gpt-5.6-sol",
      fast: true,
      reasoningEffort: "high" as const,
    };
    const updated = {
      model: "gpt-5.6-luna",
      fast: false,
      reasoningEffort: "low" as const,
    };
    await f.store.update((s) => {
      s.aiSettings = { grouping: original, questions: updated };
    });
    await f.service.start(f.client, ref, "key", head, base);
    expect((await finish(f)).status).toBe("paused");
    expect(f.classify.mock.calls.at(-1)![4]).toEqual(original);
    await f.store.update((s) => {
      s.aiSettings!.grouping = updated;
    });
    const reopened = new Store(f.dir);
    await reopened.load();
    f.service = new TriageService(reopened, f.dir, f.classify, { batches: 10 });
    await f.service.start(f.client, ref, "key", head, base);
    const resumed = await finish(f);
    expect(resumed.status).toBe("complete");
    expect(resumed.result).toMatchObject(original);
    expect(f.classify.mock.calls.at(-1)![4]).toEqual(original);
    await f.service.start(f.client, ref, "key", head, base);
    expect((await finish(f)).result).toMatchObject(updated);
    expect(f.classify.mock.calls.at(-1)![4]).toEqual(updated);
    expect(f.store.get().progress).toEqual({});
  });
});
