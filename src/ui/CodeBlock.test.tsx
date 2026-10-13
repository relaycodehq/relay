import { expect, it, vi } from "vitest";
vi.mock("../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { highlight, RunCommand, type Highlighted } from "./CodeBlock";
import { RichText } from "./RichText";

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

it("colours a block streamed line by line exactly like the finished block", async () => {
  // A comment and a template string that span lines carry grammar state over.
  const code = [
    "/* opens here",
    "   still a comment */",
    "const greeting = `hello",
    "${name} and ${'quoted'}`;",
    "export function f(a: number): string {",
    "  return String(a); // trailing",
    "}",
  ].join("\n");
  const lines = code.split("\n");
  let prior: Highlighted | null = null;
  for (let end = 1; end <= lines.length; end++)
    prior = await highlight(
      lines.slice(0, end).join("\n"),
      "tsx",
      "pierre-dark",
      prior,
    );
  const whole = await highlight(code, "tsx", "pierre-dark", null);
  // Offsets count from each pass's start; only what's drawn has to match.
  const drawn = (lines: Highlighted["lines"] = []) =>
    lines.map((line) =>
      line.map(({ content, color, fontStyle }) => [content, color, fontStyle]),
    );
  expect(drawn(prior?.lines)).toEqual(drawn(whole.lines));
  expect(
    new Set(
      drawn(whole.lines)
        .flat()
        .map(([, color]) => color),
    ).size,
  ).toBeGreaterThan(3);
});
