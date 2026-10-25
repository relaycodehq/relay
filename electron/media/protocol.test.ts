import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  link,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const protocol = vi.hoisted(() => ({
  handler: undefined as undefined | ((request: Request) => Promise<Response>),
}));

vi.mock("electron", () => ({
  protocol: {},
  session: {
    defaultSession: {
      protocol: {
        handle: (
          _scheme: string,
          handler: (request: Request) => Promise<Response>,
        ) => {
          protocol.handler = handler;
        },
      },
    },
  },
}));

vi.mock("node:fs/promises", async (actual) => {
  const fs = await actual<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open) };
});

import { mediaUrl, serveMedia } from "./index";
serveMedia();
let dir: string, root: string, file: string, outside: string;
let handles: FileHandle[];

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-media-")));
  root = join(dir, "repo");
  await mkdir(root);
  file = join(root, "clip.mp4");
  outside = join(dir, "outside.mp4");
  await writeFile(file, "0123456789");
  await writeFile(outside, "outside approval");
  handles = [];
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    handles.push(handle);
    return handle;
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.all(handles.map((handle) => handle.close().catch(() => {})));
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const get = (url: string, init?: RequestInit) =>
  protocol.handler!(new Request(url, init));

it("streams a validated handle for full, range and HEAD requests and closes it", async () => {
  const url = await mediaUrl(file, root);
  expect(await mediaUrl(file, root)).toBe(url);
  const full = await get(url);
  expect(full.status).toBe(200);
  expect(full.headers.get("content-length")).toBe("10");
  expect(await full.text()).toBe("0123456789");
  const range = await get(url, { headers: { range: "bytes=2-4" } });
  expect(range.status).toBe(206);
  expect(range.headers.get("content-range")).toBe("bytes 2-4/10");
  expect(await range.text()).toBe("234");
  const head = await get(url, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  await vi.waitFor(() =>
    expect(handles.every((handle) => handle.fd === -1)).toBe(true),
  );
});

it("returns empty media without constructing an invalid stream, and refuses missing or invalid ranges", async () => {
  await writeFile(file, "");
  const url = await mediaUrl(file, root);
  const empty = await get(url);
  expect(empty.status).toBe(200);
  expect(empty.headers.get("content-length")).toBe("0");
  expect(await empty.text()).toBe("");
  const range = await get(url, { headers: { range: "bytes=0-" } });
  expect(range.status).toBe(416);
  expect(range.headers.get("content-range")).toBe("bytes */0");
  await rm(file);
  expect((await get(url)).status).toBe(404);
  expect((await get("relay-media://file/unknown/clip.mp4")).status).toBe(404);
  expect(handles.every((handle) => handle.fd === -1)).toBe(true);
});

it("accepts ordinary atomic replacements within the approved folder", async () => {
  const url = await mediaUrl(file, root);
  const replacement = join(root, "new.mp4");
  await writeFile(replacement, "new video");
  await rename(replacement, file);
  expect(await (await get(url)).text()).toBe("new video");
});

it.skipIf(process.platform === "win32")(
  "refuses direct, parent-directory and hard-link replacements after approval",
  async () => {
    const url = await mediaUrl(file, root);
    await rm(file);
    await symlink(outside, file);
    expect((await get(url)).status).toBe(404);
    await rm(file);
    await link(outside, file);
    expect((await get(url)).status).toBe(404);
    await rm(file);
    await writeFile(file, "approved");
    await rename(root, root + "-old");
    await mkdir(join(dir, "other"));
    await writeFile(join(dir, "other", "clip.mp4"), "outside directory");
    await symlink(join(dir, "other"), root);
    expect((await get(url)).status).toBe(404);
  },
);

it("doesn't grant a file outside the approved folder", async () => {
  await expect(mediaUrl(outside, root)).rejects.toThrow("approved folder");
});

it.skipIf(process.platform === "win32")(
  "keeps streaming the opened file if its path changes after validation",
  async () => {
    const url = await mediaUrl(file, root);
    const trackedOpen = vi.mocked(open).getMockImplementation()!;
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await trackedOpen(...args);
      const stream = handle.createReadStream.bind(handle);
      vi.spyOn(handle, "createReadStream").mockImplementation((options) => {
        renameSync(file, file + ".old");
        symlinkSync(outside, file);
        return stream(options);
      });
      return handle;
    });
    expect(await (await get(url)).text()).toBe("0123456789");
    expect((await get(url)).status).toBe(404);
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a parent swapped during open and closes the outside handle",
  async () => {
    const url = await mediaUrl(file, root);
    const trackedOpen = vi.mocked(open).getMockImplementation()!;
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      await rename(root, root + "-old");
      await mkdir(join(dir, "other"));
      await writeFile(join(dir, "other", "clip.mp4"), "outside directory");
      await symlink(join(dir, "other"), root);
      return trackedOpen(...args);
    });
    expect((await get(url)).status).toBe(404);
    expect(handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);

it("closes the handle when the player cancels its response", async () => {
  await writeFile(file, Buffer.alloc(256 * 1024));
  const url = await mediaUrl(file, root);
  const response = await get(url);
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await vi.waitFor(() =>
    expect(handles.every((handle) => handle.fd === -1)).toBe(true),
  );
});
