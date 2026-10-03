import { describe, expect, it } from "vitest";
import { changedTarget, fileTarget } from "./file-link-target";

const file = (path: string, line?: number) => ({
  path,
  line,
  directory: false,
});
const folder = (path: string) => ({ path, directory: true });

describe("changedTarget", () => {
  const changes = ["src/a.ts", "src/lib/b.ts", "tests/b.ts"];
  it("selects the one change a link names, under its full path", () => {
    expect(changedTarget(file("src/a.ts", 4), changes)).toEqual(
      file("src/a.ts", 4),
    );
    expect(changedTarget(file("a.ts"), changes)).toEqual(file("src/a.ts"));
  });
  it("leaves a name several changes share, or none does, to Files", () => {
    expect(changedTarget(file("b.ts"), changes)).toBeUndefined();
    expect(changedTarget(file("src/c.ts"), changes)).toBeUndefined();
  });
  it("selects a folder with any change in it, as the folder", () => {
    expect(changedTarget(folder("src"), changes)).toEqual(folder("src"));
    expect(changedTarget(folder("docs"), changes)).toBeUndefined();
  });
});

describe("fileTarget", () => {
  it("opens the one file found, under its full path", () => {
    expect(fileTarget(file("b.ts", 2), ["src/lib/b.ts"], false)).toEqual(
      file("src/lib/b.ts", 2),
    );
  });
  it("opens a path Git doesn't list when it's on disk", () => {
    expect(fileTarget(file("out/log.txt"), [], true)).toEqual(
      file("out/log.txt"),
    );
  });
  it("searches Files for a name that fits several files, or none", () => {
    expect(fileTarget(file("b.ts"), ["src/b.ts", "tests/b.ts"], false)).toEqual(
      { ...file("b.ts"), search: "b.ts" },
    );
    expect(fileTarget(file("gone.ts"), [], false)).toEqual({
      ...file("gone.ts"),
      search: "gone.ts",
    });
  });
});
