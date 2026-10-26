import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oneFilePerProject } from "./typescript-projects";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-ts-projects-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function folder(files: Record<string, unknown>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    const text =
      typeof content === "string" ? content : JSON.stringify(content);
    await writeFile(join(root, path), text);
  }
}

const solution = (...paths: string[]) => ({
  files: [],
  references: paths.map((path) => ({ path })),
});

describe("oneFilePerProject", () => {
  it("picks for each project a file no earlier project claims", async () => {
    await folder({
      "tsconfig.json": solution(
        "./tsconfig.web.json",
        "./tsconfig.node.json",
        "./tsconfig.preload.json",
        "./tsconfig.tests.json",
      ),
      "tsconfig.base.json": { compilerOptions: { strict: true } },
      "tsconfig.web.json": {
        extends: "./tsconfig.base.json",
        include: ["shared", "src"],
        exclude: ["**/*.test.*"],
      },
      "tsconfig.node.json": {
        include: ["shared", "electron"],
        exclude: ["**/*.test.*", "electron/preload.ts"],
      },
      "tsconfig.preload.json": { files: ["electron/preload.ts"] },
      "tsconfig.tests.json": { include: ["electron/**/*.test.*"] },
      "shared/a.ts": "",
      "src/types.d.ts": "",
      "src/app.tsx": "",
      "electron/a.test.ts": "",
      "electron/preload.ts": "",
      "electron/z/main.ts": "",
    });
    expect(await oneFilePerProject(root)).toEqual([
      "shared/a.ts",
      "electron/z/main.ts",
      "electron/preload.ts",
      "electron/a.test.ts",
    ]);
  });

  it("follows a solution inside the solution, and include inherited from a config it extends", async () => {
    await folder({
      "tsconfig.json": solution("./packages"),
      "packages/tsconfig.json": solution("./app"),
      "packages/app/tsconfig.json": { extends: "../shared.json" },
      "packages/shared.json": { include: ["app/lib"] },
      "packages/app/index.ts": "",
      "packages/app/lib/x.ts": "",
    });
    expect(await oneFilePerProject(root)).toEqual(["packages/app/lib/x.ts"]);
  });

  it("leaves out a project all of whose files an earlier one claims", async () => {
    await folder({
      "tsconfig.json": solution("./a.json", "./b.json"),
      "a.json": { include: ["src"] },
      "b.json": { include: ["src/**/*.ts"] },
      "src/x.ts": "",
    });
    expect(await oneFilePerProject(root)).toEqual(["src/x.ts"]);
  });

  it("picks nothing for a tsconfig that is one project, or none", async () => {
    expect(await oneFilePerProject(root)).toEqual([]);
    await folder({ "tsconfig.json": { include: ["src"] }, "src/x.ts": "" });
    expect(await oneFilePerProject(root)).toEqual([]);
  });
});
