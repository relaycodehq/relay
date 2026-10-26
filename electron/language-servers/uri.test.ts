import { describe, expect, it } from "vitest";
import { pathsFor } from "./uri";

describe("paths on macOS and Linux", () => {
  const p = pathsFor("darwin");
  const root = "/Users/me/my project";

  it("makes URIs that escape what needs it", () => {
    expect(p.toUri(root, "src/a b#1.rs")).toBe(
      "file:///Users/me/my%20project/src/a%20b%231.rs",
    );
    expect(p.toUri(root, "/opt/x/é.rs")).toBe("file:///opt/x/%C3%A9.rs");
  });

  it("reads URIs back, whichever way they were escaped", () => {
    expect(p.fromUri("file:///Users/me/my%20project/src/a.rs")).toBe(
      "/Users/me/my project/src/a.rs",
    );
    expect(p.fromUri("file://localhost/tmp/a.rs")).toBe("/tmp/a.rs");
    expect(p.fromUri("untitled:Untitled-1")).toBeUndefined();
    expect(p.fromUri("jar:file:///x.jar!/A.class")).toBeUndefined();
    expect(p.fromUri("file:///bad%zz")).toBeUndefined();
  });

  it("names files in the folder by relative path and others absolutely", () => {
    expect(p.toWorkspacePath(root, `${root}/src/a.rs`)).toEqual({
      path: "src/a.rs",
      outside: false,
    });
    expect(p.toWorkspacePath(root, "/Users/me/.cargo/lib.rs")).toEqual({
      path: "/Users/me/.cargo/lib.rs",
      outside: true,
    });
    // A sibling folder that only shares the prefix is outside.
    expect(p.toWorkspacePath(root, `${root}-2/a.rs`).outside).toBe(true);
    // A file named like a parent reference is still inside.
    expect(p.toWorkspacePath(root, `${root}/..env`)).toEqual({
      path: "..env",
      outside: false,
    });
  });

  it("round trips", () => {
    const uri = p.toUri(root, "a/ü ber.rs");
    expect(p.fromUri(uri)).toBe(`${root}/a/ü ber.rs`);
  });

  it("keys equal files alike", () => {
    expect(p.key("/a/b/../c.rs")).toBe(p.key("/a/c.rs"));
    expect(p.key("/a/C.rs")).not.toBe(p.key("/a/c.rs"));
  });
});

describe("paths on Windows", () => {
  const p = pathsFor("win32");
  const root = "C:\\Users\\Me\\proj";

  it("writes drive paths with forward slashes", () => {
    expect(p.toUri(root, "src/main.rs")).toBe(
      "file:///C:/Users/Me/proj/src/main.rs",
    );
    expect(p.toUri(root, "D:\\x y\\a.rs")).toBe("file:///D:/x%20y/a.rs");
  });

  it("writes network shares with the host", () => {
    expect(p.toUri(root, "\\\\server\\share\\a b.rs")).toBe(
      "file://server/share/a%20b.rs",
    );
    expect(p.fromUri("file://server/share/a%20b.rs")).toBe(
      "\\\\server\\share\\a b.rs",
    );
  });

  it("reads servers' URIs, with the colon escaped or not", () => {
    expect(p.fromUri("file:///c%3A/Users/Me/proj/src/a.rs")).toBe(
      "c:\\Users\\Me\\proj\\src\\a.rs",
    );
    expect(p.fromUri("file:///C:/Users/Me/proj/a.rs")).toBe(
      "C:\\Users\\Me\\proj\\a.rs",
    );
  });

  it("treats a file in the folder alike whatever the drive letter's case", () => {
    const file = p.fromUri("file:///c%3A/Users/Me/proj/src/a.rs")!;
    expect(p.toWorkspacePath(root, file)).toEqual({
      path: "src/a.rs",
      outside: false,
    });
    expect(p.key(file)).toBe(p.key("C:\\Users\\Me\\proj\\SRC\\a.rs"));
  });

  it("calls another drive outside", () => {
    expect(p.toWorkspacePath(root, "D:\\other\\a.rs")).toEqual({
      path: "D:\\other\\a.rs",
      outside: true,
    });
  });
});
