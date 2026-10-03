import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The folder rules from AGENTS.md ("Where code goes"), checked so they hold
// without anyone remembering them.

const root = resolve(__dirname, "../..");

function sources(folder: string): string[] {
  return readdirSync(join(root, folder), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

/** Relative imports of `folder`'s non-test files that land in one of `banned`. */
function reaches(folder: string, banned: string[]): string[] {
  const found: string[] = [];
  for (const file of sources(folder)) {
    if (/\.test\.tsx?$/.test(file)) continue;
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
    expect(reaches("shared", ["src", "electron", "server"])).toEqual([]);
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
});
