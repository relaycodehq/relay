import { expect, it, vi } from "vitest";
import type {
  LspDiagnostic,
  LspDiagnosticsEvent,
} from "../../../shared/language-servers";

const listeners = new Set<(event: LspDiagnosticsEvent) => void>();

vi.mock("../../lib/api", () => ({
  api: {
    onLspDiagnostics: (callback: (event: LspDiagnosticsEvent) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  },
}));

const { onLspDiagnostics } = await import("./client");

const send = (event: LspDiagnosticsEvent) => listeners.forEach((l) => l(event));

it("gives an editor mounted again the diagnostics its file already has", () => {
  const first = vi.fn();
  const stop = onLspDiagnostics("w", "a.ts", first);
  const diagnostics: LspDiagnostic[] = [
    {
      line: 1,
      character: 0,
      endLine: 1,
      endCharacter: 4,
      severity: "error",
      message: "Nope",
    },
  ];
  send({ where: "w", path: "a.ts", diagnostics });
  expect(first).toHaveBeenCalledWith(diagnostics);
  stop();

  const again = vi.fn();
  onLspDiagnostics("w", "a.ts", again);
  expect(again).toHaveBeenCalledWith(diagnostics);
  const other = vi.fn();
  onLspDiagnostics("w", "b.ts", other);
  expect(other).not.toHaveBeenCalled();
});
