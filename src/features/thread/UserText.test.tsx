import { expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { UserText } from "./UserText";

const render = (text: string) =>
  renderToStaticMarkup(
    <UserText
      text={text}
      skills={[{ name: "commit", label: "Commit changes" }]}
      onOpenImage={() => {}}
    />,
  );

it("pills the skills the message was sent with, as they were labelled", () => {
  const html = render(
    "tests pass, so $commit it. Not $doctor, $HOME or `$commit` though",
  );
  expect(html.match(/composer-skill-chip/g)).toHaveLength(1);
  expect(html).toContain("Commit changes");
  expect(html).toContain("</span></span> it. Not $doctor, $HOME or <code");
  expect(html).not.toContain("");
});
