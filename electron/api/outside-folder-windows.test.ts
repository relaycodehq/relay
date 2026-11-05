import { afterEach, expect, it, vi } from "vitest";

const temp = "C:\\Users\\bob\\AppData\\Local\\Temp";

vi.mock("electron", () => ({}));
vi.mock("../media", () => ({ mediaUrl: vi.fn() }));

vi.mock("node:os", async (actual) => ({
  ...(await actual<typeof import("node:os")>()),
  tmpdir: () => temp,
}));

// Nothing named /tmp on this drive; realpath hands back what it's given.
vi.mock("node:fs/promises", async (actual) => ({
  ...(await actual<typeof import("node:fs/promises")>()),
  access: vi.fn(() => Promise.reject(new Error("ENOENT"))),
  realpath: vi.fn((path: string) => Promise.resolve(path)),
}));

const platform = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
});

it("opens an answer's /tmp file from the Windows temp folder", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  const { outsideFolder } = await import("./project-files");
  await expect(outsideFolder("/tmp/plans")).resolves.toBe(`${temp}\\plans`);
});
