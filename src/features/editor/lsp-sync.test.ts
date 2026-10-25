import { expect, it, vi } from "vitest";
import { Text } from "@codemirror/state";
import { lsp } from "../language-servers/client";
import { tellServerText } from "./lsp-sync";

vi.mock("../language-servers/client", () => ({ lsp: { change: vi.fn(async () => {}) } }));

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
