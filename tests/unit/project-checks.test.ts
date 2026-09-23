import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { detectProject } from "../../electron/checks/detect";
import { ProjectChecks } from "../../electron/checks/service";
import {
  languageProject,
  reviewCode,
  reviewPath,
} from "../fixtures/language-project";
import type { ProjectCheckState, SymbolQuery } from "../../shared/checks";
const roots: string[] = [];
const services: ProjectChecks[] = [];
afterEach(async () => {
  services.forEach((s) => s.stop());
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
  services.length = 0;
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const server = "https://git.example.test/gitea",
  ref = { owner: "Web", name: "web-store", number: 7 };
async function ready(
  service: ProjectChecks,
  head: string,
  condition: (s: ProjectCheckState) => boolean = () => true,
) {
  let state: ProjectCheckState | null = null;
  await expect
    .poll(
      async () => {
        state = await service.state("pr", head);
        if (state?.status === "failed") throw new Error(state.message);
        return state?.status === "ready" && condition(state);
      },
      { timeout: 30000, interval: 100 },
    )
    .toBe(true);
  return state!;
}
describe("project language support", () => {
  it("detects Angular application/test configs, JSONC references, JS and unsupported projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-detect-"));
    roots.push(root);
    expect((await detectProject(root)).framework).toBe("Unsupported");
    await writeFile(join(root, "jsconfig.json"), "{}");
    expect((await detectProject(root)).framework).toBe("JavaScript");
    await mkdir(join(root, "app"));
    await writeFile(join(root, "app/tsconfig.json"), "{}");
    await writeFile(
      join(root, "tsconfig.json"),
      '// solution\n{"files":[],"references":[{"path":"./app"}],}',
    );
    expect((await detectProject(root)).targets.map((t) => t.config)).toEqual([
      "app/tsconfig.json",
    ]);
    await writeFile(join(root, "test.json"), "{}");
    await writeFile(
      join(root, "angular.json"),
      JSON.stringify({
        projects: {
          portal: {
            architect: {
              build: { options: { tsConfig: "app/tsconfig.json" } },
              test: { options: { tsConfig: "test.json" } },
            },
          },
        },
      }),
    );
    const info = await detectProject(root);
    expect(info.framework).toBe("Angular");
    expect(info.targets.map((t) => t.config)).toEqual([
      "app/tsconfig.json",
      "test.json",
    ]);
  });
  it("rejects config traversal, invalid metadata and symlink escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-detect-"));
    const outside = await mkdtemp(join(tmpdir(), "relay-outside-"));
    roots.push(root, outside);
    await writeFile(join(outside, "config.json"), "{}");
    await symlink(join(outside, "config.json"), join(root, "tsconfig.json"));
    await expect(detectProject(root)).rejects.toThrow("inside");
    await rm(join(root, "tsconfig.json"));
    await writeFile(join(root, "package.json"), "broken");
    await expect(detectProject(root)).rejects.toThrow("invalid JSON");
    await rm(join(root, "package.json"));
    await writeFile(
      join(root, "angular.json"),
      JSON.stringify({
        projects: {
          bad: {
            targets: { build: { options: { tsConfig: "../outside.json" } } },
          },
        },
      }),
    );
    await expect(detectProject(root)).rejects.toThrow("inside");
  });
  it("keeps Windows configuration paths inside the repository", async () => {
    vi.resetModules();
    vi.doMock("node:path", async () => {
      const path =
        await vi.importActual<typeof import("node:path")>("node:path");
      return { ...path.win32, default: path.win32 };
    });
    try {
      const { inside } = await import("../../electron/checks/detect");
      expect(inside("C:\\repo", "C:\\repo\\tsconfig.json")).toBe(true);
      expect(inside("C:\\repo", "C:\\repo\\..shared\\a.ts")).toBe(true);
      expect(inside("C:\\repo", "C:\\outside\\tsconfig.json")).toBe(false);
      expect(inside("C:\\repo", "C:\\")).toBe(false);
      expect(inside("C:\\repo", "D:\\repo\\tsconfig.json")).toBe(false);
    } finally {
      vi.doUnmock("node:path");
      vi.resetModules();
    }
  });
  it("checks Angular templates and TS, navigates real symbols, handles unsaved buffers and disk changes without writes", async () => {
    const { root, head, git } = await languageProject(server, true);
    roots.push(root);
    const service = new ProjectChecks(resolve("electron/checks/worker.mjs"));
    services.push(service);
    await service.start("pr", root, server, ref, head, "angular:tsconfig.json");
    let s = await ready(service, head);
    expect(s.errors).toBe(2);
    expect(
      s.diagnostics.some(
        (d) => d.path === "src/card.html" && d.message.includes("missing"),
      ),
    ).toBe(true);
    expect(s.files[reviewPath].errors).toBe(1);
    expect(s.files["src/card.html"].errors).toBe(1);
    const query: SymbolQuery = {
      path: reviewPath,
      line: 4,
      column: 22,
      hash: hash(reviewCode),
      kind: "definition",
    };
    const def = await service.symbol("pr", head, query);
    expect(def.locations[0].path).toBe("src/greeting.ts");
    expect(def.display).toContain("greet");
    expect(def.documentation).toContain("friendly");
    const refs = await service.symbol("pr", head, {
      ...query,
      kind: "references",
    });
    expect(refs.locations.length).toBeGreaterThanOrEqual(4);
    const html = "<h1>{{ title }}</h1>\n<p>{{ missing }}</p>\n";
    const ngDef = await service.symbol("pr", head, {
      path: "src/card.html",
      line: 1,
      column: 9,
      hash: hash(html),
      kind: "definition",
    });
    expect(ngDef.locations[0].path).toBe("src/card.ts");
    await expect(
      service.symbol("pr", head, { ...query, hash: "0".repeat(64) }),
    ).rejects.toThrow("changed");
    await service.update(
      "pr",
      head,
      "src/card.html",
      html.replace("missing", "title"),
    );
    s = await ready(
      service,
      head,
      (s) =>
        s.files["src/card.html"]?.hash ===
        hash(html.replace("missing", "title")),
    );
    expect(s.errors).toBe(1);
    await service.update(
      "pr",
      head,
      reviewPath,
      reviewCode.replace("= 42", '= "Ready"'),
    );
    s = await ready(service, head, (s) => s.errors === 0);
    expect(s.files[reviewPath].errors).toBe(0);
    const source = await service.symbol("pr", head, {
      ...query,
      hash: s.files[reviewPath].hash,
      kind: "source",
    });
    expect(source.source?.text).toContain('"Ready"');
    expect(await readFile(join(root, reviewPath), "utf8")).toBe(reviewCode);
    expect(git("status", "--porcelain")).toBe("");
    await service.update("pr", head, reviewPath, null);
    await ready(service, head, (s) => s.errors === 1);
    await service.update("pr", head, "src/card.html", null);
    await ready(service, head, (s) => s.errors === 2);
    await writeFile(
      join(root, reviewPath),
      reviewCode.replace("= 42", '= "Disk"'),
    );
    await ready(
      service,
      head,
      (s) =>
        s.files[reviewPath]?.hash ===
          hash(reviewCode.replace("= 42", '= "Disk"')) && s.errors === 1,
    );
    // Paused: disk changes only mark results stale until resume.
    service.pause("pr", true);
    await writeFile(
      join(root, reviewPath),
      reviewCode.replace("= 42", '= "Paused"'),
    );
    await new Promise((r) => setTimeout(r, 1500));
    s = (await service.state("pr", head))!;
    expect(s.status).toBe("paused");
    expect(s.errors).toBe(1);
    service.pause("pr", false);
    await ready(
      service,
      head,
      (s) =>
        s.files[reviewPath]?.hash ===
        hash(reviewCode.replace("= 42", '= "Paused"')),
    );
    service.stop("pr");
    expect((await service.state("pr", head))?.status).toBe("stopped");
  }, 60000);
  it("rejects wrong checkout, handles cancellation during startup, and stops after checkout changes", async () => {
    const { root, head, git } = await languageProject(server);
    roots.push(root);
    const service = new ProjectChecks(resolve("electron/checks/worker.mjs"));
    services.push(service);
    await expect(
      service.start(
        "pr",
        root,
        server,
        ref,
        "a".repeat(40),
        "typescript:tsconfig.json",
      ),
    ).rejects.toThrow("head");
    const pending = service.start(
      "pr",
      root,
      server,
      ref,
      head,
      "typescript:tsconfig.json",
    );
    service.stop("pr");
    await expect(pending).rejects.toThrow("stopped");
    await service.start(
      "pr",
      root,
      server,
      ref,
      head,
      "typescript:tsconfig.json",
    );
    await ready(service, head);
    git("commit", "--allow-empty", "--quiet", "-m", "Different checkout");
    await expect
      .poll(async () => (await service.state("pr", head))?.status, {
        timeout: 10000,
        interval: 500,
      })
      .toBe("failed");
  }, 30000);
  it.each(["typescript", "angular"] as const)(
    "counts %s suggestions separately and refreshes strictness from config files",
    async (provider) => {
      const { root, head } = await languageProject(
        server,
        provider === "angular",
      );
      roots.push(root);
      if (provider === "angular")
        await writeFile(join(root, "src/card.html"), "<h1>{{ title }}</h1>\n");
      const config = JSON.parse(
        await readFile(join(root, "tsconfig.json"), "utf8"),
      );
      config.extends = "./tsconfig.strictness.json";
      await writeFile(
        join(root, "tsconfig.strictness.json"),
        JSON.stringify({ compilerOptions: { noUnusedParameters: false } }),
      );
      await writeFile(join(root, "tsconfig.json"), JSON.stringify(config));
      const text =
        "/** @deprecated Use current instead. */\nfunction legacy() { return 1; }\nexport function inspect(unused: string) { return legacy(); }\n";
      await writeFile(join(root, reviewPath), text);
      const service = new ProjectChecks(resolve("electron/checks/worker.mjs"));
      services.push(service);
      await service.start(
        "pr",
        root,
        server,
        ref,
        head,
        `${provider}:tsconfig.json`,
      );
      let s = await ready(service, head);
      expect(s).toMatchObject({ errors: 0, warnings: 0, suggestions: 2 });
      expect(s.files[reviewPath]).toMatchObject({
        errors: 0,
        warnings: 0,
        suggestions: 2,
      });
      expect(s.diagnostics.map((d) => [d.code, d.severity])).toEqual([
        ["TS6133", "info"],
        ["TS6387", "info"],
      ]);
      await service.update(
        "pr",
        head,
        reviewPath,
        "export function inspect() { return 1; }\n",
      );
      s = await ready(service, head, (s) => s.suggestions === 0);
      expect(s.diagnostics).toEqual([]);
      expect(s.files[reviewPath]).toMatchObject({
        errors: 0,
        warnings: 0,
        suggestions: 0,
      });
      expect(await readFile(join(root, reviewPath), "utf8")).toBe(text);
      await service.update("pr", head, reviewPath, null);
      await ready(service, head, (s) => s.suggestions === 2);
      config.compilerOptions.noUnusedParameters = true;
      await writeFile(join(root, "tsconfig.json"), JSON.stringify(config));
      s = await ready(service, head, (s) => s.errors === 1);
      expect(s).toMatchObject({ errors: 1, warnings: 0, suggestions: 1 });
      expect(s.files[reviewPath]).toMatchObject({
        errors: 1,
        warnings: 0,
        suggestions: 1,
      });
      expect(s.diagnostics.map((d) => [d.code, d.severity])).toEqual([
        ["TS6133", "error"],
        ["TS6387", "info"],
      ]);
      delete config.compilerOptions.noUnusedParameters;
      await writeFile(join(root, "tsconfig.json"), JSON.stringify(config));
      await ready(service, head, (s) => s.errors === 0 && s.suggestions === 2);
      await writeFile(
        join(root, "tsconfig.strictness.json"),
        JSON.stringify({ compilerOptions: { noUnusedParameters: true } }),
      );
      s = await ready(
        service,
        head,
        (s) => s.errors === 1 && s.suggestions === 1,
      );
      expect(s.diagnostics[0]).toMatchObject({
        code: "TS6133",
        severity: "error",
      });
    },
    30000,
  );
  it("keeps accurate totals and prioritizes errors when suggestions exceed the display limit", async () => {
    const { root, head } = await languageProject(server);
    roots.push(root);
    const path = "src/a-suggestions.ts";
    await writeFile(
      join(root, path),
      "export {};\n" +
        Array.from({ length: 1505 }, (_, i) => `const unused${i} = ${i};`).join(
          "\n",
        ),
    );
    const service = new ProjectChecks(resolve("electron/checks/worker.mjs"));
    services.push(service);
    await service.start(
      "pr",
      root,
      server,
      ref,
      head,
      "typescript:tsconfig.json",
    );
    const s = await ready(service, head);
    expect(s).toMatchObject({
      errors: 1,
      warnings: 0,
      suggestions: 1505,
      truncated: true,
    });
    expect(s.diagnostics).toHaveLength(1500);
    expect(s.diagnostics[0]).toMatchObject({
      path: reviewPath,
      severity: "error",
      code: "TS2322",
    });
    expect(s.files[path]).toMatchObject({
      errors: 0,
      warnings: 0,
      suggestions: 1505,
    });
  }, 30000);
});
