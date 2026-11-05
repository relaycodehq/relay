import { expect, it, vi } from "vitest";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { chromeArgs, withProbe } from "./sdk";

const started: Options[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: Options }) => {
    started.push(options);
    return { close: () => {} };
  },
}));

vi.mock("../../../platform/executables", () => ({
  findExecutable: async () => "/bin/claude",
}));

vi.mock("../../accounts", () => ({ runAccount: async () => undefined }));

vi.mock("../auth-trace", () => ({
  traceProbe: () => ({ debugFile: undefined, closed: () => {} }),
}));

it("probes a project with its settings but none of its hooks", async () => {
  await withProbe(
    {
      cwd: "/repo",
      settingSources: ["user", "project", "local"],
      extraArgs: chromeArgs,
    },
    async () => {},
  );
  expect(started.at(-1)).toMatchObject({
    cwd: "/repo",
    settingSources: ["user", "project", "local"],
    settings: { disableAllHooks: true },
    extraArgs: chromeArgs,
  });
});
