import { expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { sentPills, UserText } from "./UserText";

const render = (text: string) =>
  renderToStaticMarkup(
    <UserText
      text={text}
      skills={[{ name: "commit", label: "Commit changes" }]}
      onOpenImage={() => {}}
      projectRoot="/work/relay"
      onOpenFile={() => {}}
    />,
  );

it("pills the skills the message was sent with, as they were labelled", () => {
  const html = render(
    "tests pass, so $commit it. Not $doctor, $HOME or `$commit` though",
  );
  expect(html.match(/prompt-pill skill/g)).toHaveLength(1);
  expect(html).toContain("Commit changes");
  expect(html).toContain("</span></span> it. Not $doctor, $HOME or <code");
  expect(html).not.toContain("");
});

it("pills a quote where it was sent, but not a quote shown in a code block", () => {
  const html = render(
    "> The cache tweak has a real downside.\n\nWhy?\n\n```\n> not a quote\n```",
  );
  expect(html.match(/prompt-pill quote/g)).toHaveLength(1);
  expect(html).toContain("The cache tweak has a real downside.");
  expect(html).not.toContain("<blockquote");
  expect(html).toContain("&gt; not a quote");
});

it("pills code that names a file, and leaves other code as code", () => {
  const html = render(
    "check `src/app/main.ts` and `src/app/`, then `npm run dev`",
  );
  expect(html).toContain('class="prompt-pill file" title="src/app/main.ts"');
  expect(html).toContain('class="prompt-pill folder"');
  expect(html).toContain("<code>npm run dev</code>");
});

it("lists for a copy the same pills the message shows", () => {
  expect(
    sentPills(
      "> The cache tweak has a real downside.\n\n$commit `src/app/main.ts` and `src/app/`, not `npm run dev` or [Image #1]\n\n```\n`src/app/main.ts`\n```",
      [{ name: "commit", label: "Commit changes" }],
      "/work/relay",
    ),
  ).toEqual({
    skills: { $commit: "Commit changes" },
    quotes: ["The cache tweak has a real downside."],
    files: ["src/app/main.ts", "src/app/"],
  });
});
