import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../shared/projects";
import {
  MAX_SHARED_FILES,
  mayHoldSecrets,
  sharedFiles,
  touchesSecrets,
  sharedFileText,
} from "./shared-files";

let seq = 0;

const answer = (over: Partial<ChatMessage>): ChatMessage => ({
  id: `m${++seq}`,
  seq,
  role: "assistant",
  body: "",
  status: "complete",
  created: seq,
  provider: "claude",
  version: 1,
  ...over,
});

const read = (path: string) => ({
  kind: "activity" as const,
  id: `a${++seq}`,
  activity: {
    id: `a${seq}`,
    kind: "read" as const,
    label: path,
    status: "complete" as const,
  },
});

async function folder(files: Record<string, string>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-shared-")));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

describe("sharedFiles", () => {
  it("shares changed files first, then read ones, each once", async () => {
    const root = await folder({
      "src/a.ts": "a",
      "src/b.ts": "b",
      "README.md": "r",
    });
    const messages = [
      answer({
        trace: [read(join(root, "README.md")), read(join(root, "src/a.ts"))],
      }),
      answer({ changes: [{ path: "src/a.ts", additions: 1, deletions: 0 }] }),
      answer({ changes: [{ path: "src/b.ts", additions: 1, deletions: 0 }] }),
    ];
    const files = await sharedFiles(messages, root);
    expect(files.map((f) => [f.path, f.changed])).toEqual([
      ["src/b.ts", true],
      ["src/a.ts", true],
      ["README.md", false],
    ]);
  });

  it("keeps files that usually hold keys, binaries and anything outside the thread's folder private", async () => {
    const root = await folder({
      ".env": "KEY=1",
      "keys/server.pem": "x",
      "logo.bin": "\0\0\0",
      "ok.ts": "ok",
    });
    const outside = await folder({ "notes.txt": "private" });
    const messages = [
      answer({
        changes: ["ok.ts", ".env", "keys/server.pem", "logo.bin"].map(
          (path) => ({ path, additions: 1, deletions: 0 }),
        ),
        trace: [read(join(outside, "notes.txt")), read("/etc/hosts")],
      }),
    ];
    expect((await sharedFiles(messages, root)).map((f) => f.path)).toEqual([
      "ok.ts",
    ]);
  });

  it("follows links before deciding: one leading out of the folder or to a key file stays private", async () => {
    const root = await folder({ ".env": "KEY=1", "real.ts": "ok" });
    const outside = await folder({ "notes.txt": "private" });
    await symlink(join(outside, "notes.txt"), join(root, "notes.md"));
    await symlink(join(root, ".env"), join(root, "config.ts"));
    await symlink(join(root, "real.ts"), join(root, "alias.ts"));
    const messages = [
      answer({
        changes: ["notes.md", "config.ts", "alias.ts"].map((path) => ({
          path,
          additions: 1,
          deletions: 0,
        })),
      }),
    ];
    const files = await sharedFiles(messages, root);
    expect(files.map((f) => f.path)).toEqual(["alias.ts"]);
    // Swapped for a link after it was picked, it isn't read.
    await rm(join(root, "alias.ts"));
    await symlink(join(outside, "notes.txt"), join(root, "alias.ts"));
    await expect(sharedFileText(files[0]!)).rejects.toThrow();
  });

  it("leaves out pictures the agent only looked at", async () => {
    const root = await folder({ "shot.png": "not really a png", "a.ts": "a" });
    const messages = [
      answer({
        trace: [read(join(root, "shot.png")), read(join(root, "a.ts"))],
      }),
    ];
    expect((await sharedFiles(messages, root)).map((f) => f.path)).toEqual([
      "a.ts",
    ]);
  });

  it("stops at 20 files", async () => {
    const names = Array.from({ length: 25 }, (_, i) => `f${i}.ts`);
    const root = await folder(Object.fromEntries(names.map((n) => [n, n])));
    const messages = [
      answer({
        changes: names.map((path) => ({ path, additions: 1, deletions: 0 })),
      }),
    ];
    expect(await sharedFiles(messages, root)).toHaveLength(MAX_SHARED_FILES);
  });

  it("redacts secrets inside a shared file", async () => {
    const key = ["gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("");
    const root = await folder({ "config.ts": `const token = "${key}";` });
    const [file] = await sharedFiles(
      [
        answer({
          changes: [{ path: "config.ts", additions: 1, deletions: 0 }],
        }),
      ],
      root,
    );
    expect(await sharedFileText(file!)).not.toContain(key);
  });
});

describe("mayHoldSecrets", () => {
  it("names the usual key files but not their examples", () => {
    for (const path of [
      "/p/.env",
      "/p/.env.local",
      "/p/id_ed25519",
      "/p/.ssh/config",
      "/p/.git/config",
      "/p/cert.p12",
    ])
      expect(mayHoldSecrets(path), path).toBe(true);
    for (const path of [
      "/p/.env.example",
      "/p/src/environment.ts",
      "/p/keyboard.ts",
    ])
      expect(mayHoldSecrets(path), path).toBe(false);
  });
});

describe("touchesSecrets", () => {
  it("spots key files in a read's path or a command's words", () => {
    for (const label of [
      "/repo/.env",
      "cat .env.local",
      "cat ~/.ssh/config | head",
      "openssl x509 -in 'certs/server.pem'",
      "echo KEY=1 >.env",
    ])
      expect(touchesSecrets(label), label).toBe(true);
    for (const label of [
      "npm test",
      "cat .env.example",
      "rg API_KEY src",
      "/repo/src/env.ts",
    ])
      expect(touchesSecrets(label), label).toBe(false);
  });
});
