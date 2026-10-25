import { describe, expect, it } from "vitest";
import { parseGlobs, pathFilter, ripgrepGlobArgs } from "./glob";

const allows = (include: string, exclude: string, ...paths: string[]) => {
  const keep = pathFilter(parseGlobs(include, exclude))!;
  return paths.filter(keep);
};

describe("parseGlobs", () => {
  it("splits on commas but not inside braces", () => {
    expect(parseGlobs("*.{ts,tsx}, src/**, ,docs/")).toEqual({
      include: ["*.{ts,tsx}", "src/**", "docs"],
      exclude: [],
    });
  });

  it("moves a negated include to the excludes", () => {
    expect(parseGlobs("*.ts, !*.test.ts", "dist/")).toEqual({
      include: ["*.ts"],
      exclude: ["*.test.ts", "dist"],
    });
  });

  it("is no filter at all when both fields are empty", () => {
    expect(pathFilter(parseGlobs("", " , "))).toBeUndefined();
  });
});

describe("pathFilter", () => {
  const paths = [
    "src/app.ts",
    "src/app.test.ts",
    "src/deep/er/util.tsx",
    "docs/readme.md",
    "app.ts",
    "node_modules/x/index.ts",
  ];

  it("matches a name without a slash at any depth", () => {
    expect(allows("*.ts", "", ...paths)).toEqual([
      "src/app.ts",
      "src/app.test.ts",
      "app.ts",
      "node_modules/x/index.ts",
    ]);
  });

  it("anchors a glob with a slash at the root", () => {
    expect(allows("src/*.ts", "", ...paths)).toEqual([
      "src/app.ts",
      "src/app.test.ts",
    ]);
    expect(allows("src/**/*.tsx", "", ...paths)).toEqual([
      "src/deep/er/util.tsx",
    ]);
  });

  it("takes a folder name as everything below it", () => {
    expect(allows("", "node_modules, docs", ...paths)).toEqual([
      "src/app.ts",
      "src/app.test.ts",
      "src/deep/er/util.tsx",
      "app.ts",
    ]);
  });

  it("lets an exclude win over an include, and reads braces", () => {
    expect(allows("*.{ts,tsx}", "*.test.ts, node_modules", ...paths)).toEqual([
      "src/app.ts",
      "src/deep/er/util.tsx",
      "app.ts",
    ]);
  });

  it("treats regex characters in a name as themselves", () => {
    expect(allows("a+b.ts", "", "a+b.ts", "aab.ts")).toEqual(["a+b.ts"]);
  });
});

describe("ripgrepGlobArgs", () => {
  it("names the folder's contents too, and excludes the same way", () => {
    expect(ripgrepGlobArgs({ include: ["src"], exclude: ["dist"] })).toEqual([
      "--glob",
      "src",
      "--glob",
      "src/**",
      "--glob",
      "!dist",
      "--glob",
      "!dist/**",
    ]);
  });
});
