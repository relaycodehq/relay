import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { describeCycle, findCycles, importsOf } from "./layout-graph";

// The folder rules from AGENTS.md ("Where code goes"), checked so they hold
// without anyone remembering them.

const root = resolve(__dirname, "../..");

function sources(folder: string, kind = /\.(ts|tsx)$/): string[] {
  return readdirSync(join(root, folder), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && kind.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

/** Relative imports of `folder`'s files, tests too if asked, that land in one of `banned`. */
function reaches(folder: string, banned: string[], tests = false): string[] {
  const found: string[] = [];
  for (const file of sources(folder)) {
    if (!tests && /\.test\.tsx?$/.test(file)) continue;
    const text = readFileSync(join(root, file), "utf8");
    for (const [, specifier] of text.matchAll(
      /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      const target = relative(root, resolve(root, dirname(file), specifier));
      if (banned.some((prefix) => target.startsWith(`${prefix}/`)))
        found.push(`${file} -> ${target}`);
    }
  }
  return found;
}

/** Folder cycles in `group` as `a → b → a` with an example import per step. */
function cyclesIn(group: string, valuesOnly: boolean) {
  const files = sources(group, /\.(tsx?|mjs|js)$/).map((path) => ({
    path,
    text: readFileSync(join(root, path), "utf8"),
  }));
  return findCycles(files, group, { valuesOnly });
}

// Cycles between top-level folders of electron/ that are tolerated for now,
// each as the sorted folders tangled together; none today. Value imports only:
// the persisted `Store` type links most folders on purpose. The test fails on a
// cycle that isn't listed and on a listed one that is gone.
const knownElectronCycles: string[][] = [];

describe("source layout", () => {
  it("keeps src/lib and src/ui free of features and the shell", () => {
    expect(reaches("src/lib", ["src/features", "src/app"])).toEqual([]);
    expect(reaches("src/ui", ["src/features", "src/app"])).toEqual([]);
  });

  it("keeps features from reaching up into the shell", () => {
    expect(reaches("src/features", ["src/app"])).toEqual([]);
  });

  it("keeps the renderer and the main process apart", () => {
    expect(reaches("src", ["electron", "server"])).toEqual([]);
    expect(reaches("electron", ["src"])).toEqual([]);
    // Its tests too: shared code is tested on its own, as the phone runs it.
    expect(reaches("shared", ["src", "electron", "server"], true)).toEqual([]);
  });

  it("leaves only entry points loose in electron/ and src/", () => {
    const loose = (folder: string) =>
      readdirSync(join(root, folder), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    expect(loose("electron")).toEqual([
      "main.ts",
      "net-fetch.d.ts",
      "preload.ts",
    ]);
    expect(loose("src")).toEqual(["main.tsx", "styles.css"]);
  });

  it("keeps features from importing each other in a circle", () => {
    // Type imports count here: across features they are still a dependency.
    expect(cyclesIn("src/features", false).map(describeCycle)).toEqual([]);
  });

  it("keeps main-process folders from importing each other in a circle", () => {
    const found = cyclesIn("electron", true);
    const known = new Set(knownElectronCycles.map((folders) => folders.join()));
    const present = new Set(found.map(({ folders }) => folders.join()));
    expect([
      ...found
        .filter(({ folders }) => !known.has(folders.join()))
        .map(
          (cycle) =>
            `new cycle between ${cycle.folders.join(", ")}:\n${describeCycle(cycle)}`,
        ),
      ...knownElectronCycles
        .filter((folders) => !present.has(folders.join()))
        .map(
          (folders) =>
            `knownElectronCycles lists [${folders.join(", ")}], but no cycle has exactly those folders any more: delete or update the entry`,
        ),
    ]).toEqual([]);
  });

  it("reads multi-line, type-only and dynamic imports", () => {
    expect(
      importsOf(`
import {
  a,
  type B,
} from "./multi";
import { type A, type B } from "./types";
import type { C } from "./type";
import D, { type E } from "./default";
export * from "./star";
export type { F } from "./reexport-type";
import "./side.css";
const lazy = () => import("./lazy");
const later = import(
  "./later"
).then((m) => m);
let t: import("./shape").Shape;
type Sdk = typeof import("./sdk");
// import { z } from "./comment";
const text = "import x from './string'";
`),
    ).toEqual([
      { specifier: "./multi", type: false },
      { specifier: "./types", type: true },
      { specifier: "./type", type: true },
      { specifier: "./default", type: false },
      { specifier: "./star", type: false },
      { specifier: "./reexport-type", type: true },
      { specifier: "./side.css", type: false },
      { specifier: "./lazy", type: false },
      { specifier: "./later", type: false },
      { specifier: "./shape", type: true },
      { specifier: "./sdk", type: true },
    ]);
  });
});
