import { expect, it } from "vitest";
import { openCode2Models } from "./model-ids";

it("files OpenCode 2's models under their provider, named and described as OpenCode 1's; a provider without a known name by its id", () => {
  // As `opencode acp` 2.0.28 lists them.
  const listed = [
    ["anthropic/claude-fable-5", "anthropic/Claude Fable 5"],
    ["llama.cpp/gemma-4-e4b.gguf", "llama.cpp/Gemma-4-E4B (local)"],
    ["opencode/deepseek-v4.1-flash", "opencode/DeepSeek V4.1 Flash"],
    [
      "openrouter/~anthropic/claude-opus-latest",
      "openrouter/Claude Opus Latest",
    ],
    ["openrouter/google/gemma-3-12b-it", "openrouter/Gemma 3 12B IT"],
  ].map(([id, name]) => ({ id, name, description: "", efforts: [] }));

  expect(
    openCode2Models(listed).map(({ id, name, group, description }) => ({
      id,
      name,
      group,
      description,
    })),
  ).toEqual([
    {
      id: "llama.cpp/gemma-4-e4b.gguf",
      name: "Gemma-4-E4B (local)",
      group: "llama.cpp",
      description: "",
    },
    {
      id: "opencode/deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      group: "OpenCode Zen",
      description: "",
    },
    {
      id: "openrouter/~anthropic/claude-opus-latest",
      name: "Claude Opus Latest",
      group: "OpenRouter",
      description: "anthropic",
    },
    {
      id: "openrouter/google/gemma-3-12b-it",
      name: "Gemma 3 12B IT",
      group: "OpenRouter",
      description: "google",
    },
  ]);
});
