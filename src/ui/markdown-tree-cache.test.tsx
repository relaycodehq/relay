// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({ api: {} }));
// remark-gfm is in every setup and sits right after the parser, so it
// counts each run of the pipeline and each real parse of a text.
const runs = { pipelines: 0, parses: 0 };

vi.mock("remark-gfm", async (importOriginal) => {
  const gfm = (await importOriginal<typeof import("remark-gfm")>()).default;
  return {
    default: function (this: { parser?: (...args: never[]) => unknown }) {
      runs.pipelines++;
      gfm.call(this as never);
      const parse = this.parser!;
      this.parser = (...args) => {
        runs.parses++;
        return parse(...args);
      };
    },
  };
});

import { RichText } from "./RichText";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A finished thread's answers: prose, file links, commands, code, a table, math. */
function thread(name: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    [
      `## ${name} step ${i}`,
      `I read \`src/app/App.tsx\` and [the hook](src/lib/useNow.ts:${i + 1}), then ran \`npm test\`.`,
      "- a point with **bold**\n- a link to https://example.com/" + i,
      "```ts\nconst x = " + i + ";\n```",
      `| file | lines |\n| --- | ---: |\n| ${name}${i}.ts | ${i} |`,
      `The sum is:\n\n$$\n\\sum_{k=1}^{${i}} k\n$$`,
      // Raw HTML keeps a message from splitting into blocks, so only one has it.
      i ? "Done." : "<b>raw html</b> and <details>stays text</details>",
    ].join("\n\n"),
  );
}

function open(texts: string[], typed = false) {
  const element = document.createElement("div");
  const root = createRoot(element);
  act(() =>
    root.render(
      texts.map((text, i) => (
        <RichText
          key={i}
          text={text}
          typed={typed}
          projectRoot="/project"
          onOpenFile={() => {}}
        />
      )),
    ),
  );
  const html = element.innerHTML;
  act(() => root.unmount());
  return html;
}

beforeEach(() => {
  runs.pipelines = 0;
  runs.parses = 0;
});

it("switching back to a thread parses none of its finished messages", () => {
  const a = thread("A", 40),
    b = thread("B", 40);
  const first = open(a);
  open(b);
  expect(runs.parses).toBeGreaterThan(200);

  runs.pipelines = 0;
  runs.parses = 0;
  const again = open(a);
  expect(runs).toEqual({ pipelines: 0, parses: 0 });
  expect(again).toBe(first);
});

it("reads a text again under another setup", () => {
  const text = "Some *typed* text\n\n    indented";
  open([text]);
  runs.parses = 0;
  open([text], true);
  expect(runs.parses).toBe(1);
  open([text], true);
  expect(runs.parses).toBe(1);
});

it("keeps only the text a block mounted with, not what streamed in", () => {
  const element = document.createElement("div");
  const root = createRoot(element);
  act(() => root.render(<RichText text="Streaming hel" />));
  act(() => root.render(<RichText text="Streaming hello" />));
  act(() => root.unmount());

  runs.parses = 0;
  open(["Streaming hel"]);
  expect(runs.parses).toBe(0);
  open(["Streaming hello"]);
  expect(runs.parses).toBe(1);
});
