import { expect, it, vi } from "vitest";
vi.mock("../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { RunCommand } from "./CodeBlock";
import { RichText } from "./ui";

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
