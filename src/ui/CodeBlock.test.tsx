// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
vi.mock("../lib/api", () => ({ api: {} }));
const tokenized: string[] = [];

vi.mock("@pierre/diffs", async (importOriginal) => {
  const diffs = await importOriginal<typeof import("@pierre/diffs")>();
  return {
    ...diffs,
    getSharedHighlighter: async (
      ...args: Parameters<typeof diffs.getSharedHighlighter>
    ) => {
      const shared = await diffs.getSharedHighlighter(...args);
      return {
        codeToTokens: (...call: Parameters<typeof shared.codeToTokens>) => {
          tokenized.push(call[0]);
          return shared.codeToTokens(...call);
        },
      };
    },
  };
});

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeBlock, highlight, RunCommand } from "./CodeBlock";
import { RichText } from "./RichText";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const inThread = (text: string) =>
  renderToStaticMarkup(
    <RunCommand.Provider value={async () => true}>
      <RichText text={text} />
    </RunCommand.Provider>,
  );
const typeButtons = (html: string) =>
  html.match(/aria-label="(Type in|Paste into) terminal"/g)?.length ?? 0;

it("offers a closed shell block to the terminal, not one still streaming in", () => {
  expect(typeButtons(inThread("Run:\n\n```bash\nnpm test\n```"))).toBe(1);
  expect(typeButtons(inThread("Run:\n\n```bash\nnpm te"))).toBe(0);
  expect(typeButtons(inThread("Run:\n\n```bash\nnpm test\n``"))).toBe(0);
  expect(typeButtons(inThread("~~~~sh\nnpm test\n~~~~~"))).toBe(1);
  expect(typeButtons(inThread("~~~sh\nnpm test\n```"))).toBe(0);
  expect(typeButtons(inThread("> ```sh\n> npm test\n> ```"))).toBe(1);
  expect(inThread("```sh\nnpm ci\nnpm test\n```")).toContain(
    'aria-label="Paste into terminal"',
  );
});

it("offers nothing outside a thread, or for code that isn't a command", () => {
  expect(
    typeButtons(renderToStaticMarkup(<RichText text={"```sh\nls -la\n```"} />)),
  ).toBe(0);
  expect(typeButtons(inThread("```ts\nnpm test\n```"))).toBe(0);
  expect(typeButtons(inThread("```\nconst a = 1;\n```"))).toBe(0);
});

it("puts ▶ beside inline code that is a command, and only there", () => {
  const html = inThread(
    "Run `npm run build`, then open `src/main.ts` in `git`.",
  );
  expect(html.match(/class="inline-command"/g)).toHaveLength(1);
  expect(html).toContain(
    '<span class="inline-command"><code>npm run build</code>',
  );
  expect(renderToStaticMarkup(<RichText text="Run `npm test`." />)).toContain(
    "Run <code>npm test</code>.",
  );
});

it("draws a mermaid block only once it's closed, keeping its source until then", () => {
  const streaming = inThread("```mermaid\ngraph TD\n  A --> B");
  expect(streaming).not.toContain('aria-label="Show source"');
  expect(streaming).toContain("A --&gt; B");
  const closed = inThread("```mermaid\ngraph TD\n  A --> B\n```");
  expect(closed).toContain('aria-label="Show source"');
  expect(closed).toContain('aria-label="Copy code"');
  // The source stands in until the diagram is drawn in the page.
  expect(closed).toContain("A --&gt; B");
});

it("colours code, and leaves a language the lexers don't know plain", async () => {
  const code =
    "export function f(a: number): string {\n  return String(a); // trailing\n}";
  const colours = async (lang: string) => {
    const { lines } = await highlight(code, lang, "pierre-dark");
    expect(
      lines
        .flat()
        .map((token) => token.content)
        .join(""),
    ).toBe(code.replaceAll("\n", ""));
    return new Set(lines.flat().map((token) => token.color)).size;
  };
  expect(await colours("tsx")).toBeGreaterThan(3);
  expect(await colours("prisma")).toBe(1);
});

function mount(code: string, closed: boolean) {
  const element = document.createElement("div");
  const root = createRoot(element);
  act(() => root.render(<CodeBlock code={code} lang="ts" closed={closed} />));
  const coloured = () => !!element.querySelector("code span[style]");
  return { coloured, unmount: () => act(() => root.unmount()) };
}

it("paints a finished block opened again in colour at once, tokenizing it once", async () => {
  const code = "const answer: number = 42;";
  const first = mount(code, true);
  expect(first.coloured()).toBe(false);
  await vi.waitFor(() => expect(first.coloured()).toBe(true));
  first.unmount();

  vi.useFakeTimers();
  try {
    const again = mount(code, true);
    expect(again.coloured()).toBe(true);
    // Nothing is left to tokenize, so nothing waits on the throttle either.
    expect(vi.getTimerCount()).toBe(0);
    again.unmount();
  } finally {
    vi.useRealTimers();
  }
  expect(tokenized.filter((text) => text === code)).toHaveLength(1);
});

it("doesn't keep the colours of a block still streaming in", async () => {
  const code = "const streamed = 1;\nconst half";
  const first = mount(code, false);
  await vi.waitFor(() => expect(first.coloured()).toBe(true));
  first.unmount();
  expect(mount(code, false).coloured()).toBe(false);
});
