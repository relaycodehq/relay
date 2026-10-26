import { expect, it, vi } from "vitest";
import { Text } from "@codemirror/state";
import { api } from "../../lib/api";
import { lsp } from "../language-servers/client";
import { FileDocument } from "./file-document";
import { syncWithServer, tellServerText } from "./lsp-sync";

vi.mock("../language-servers/client", () => ({
  lsp: {
    change: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
  },
}));

vi.mock("../../lib/api", () => ({ api: { projectFile: vi.fn() } }));

it("sends a text once, however many requests ask for it, and an edited one again", async () => {
  const text = Text.of(["const a = 1;"]);
  await tellServerText("/p", "a.ts", text);
  await tellServerText("/p", "a.ts", text);
  expect(lsp.change).toHaveBeenCalledTimes(1);
  const edited = text.replace(10, 11, Text.of(["2"]));
  await tellServerText("/p", "a.ts", edited);
  expect(lsp.change).toHaveBeenLastCalledWith("/p", "a.ts", "const a = 2;");
  expect(lsp.change).toHaveBeenCalledTimes(2);
});

it("tries a text again after sending it failed", async () => {
  vi.mocked(lsp.change).mockRejectedValueOnce(new Error("bridge down"));
  const text = Text.of(["let b;"]);
  await tellServerText("/p", "b.ts", text);
  await tellServerText("/p", "b.ts", text);
  expect(vi.mocked(lsp.change).mock.calls.filter(([, path]) => path === "b.ts")).toHaveLength(2);
});

it("moves the server's copy along when the open file is renamed", async () => {
  const file = { contents: "let c;", version: "v", head: "h", original: "let c;" };
  vi.mocked(api.projectFile).mockResolvedValue(
    file as Awaited<ReturnType<typeof api.projectFile>>,
  );
  const doc = new FileDocument({ kind: "project", where: "/p" }, "c.ts", () => []);
  await vi.waitFor(() => expect(doc.state).toBeDefined());
  syncWithServer(doc);
  expect(lsp.open).toHaveBeenLastCalledWith("/p", "c.ts", "let c;");
  doc.moveTo("d.ts");
  expect(lsp.close).toHaveBeenLastCalledWith("/p", "c.ts");
  expect(lsp.open).toHaveBeenLastCalledWith("/p", "d.ts", "let c;");
  doc.dispose();
  expect(lsp.close).toHaveBeenLastCalledWith("/p", "d.ts");
});
