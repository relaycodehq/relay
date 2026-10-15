// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DOMSerializer } from "@tiptap/pm/model";
import {
  filePill,
  pastePill,
  Pill,
  pillSpec,
  quotePill,
  skillPill,
  type PillLook,
} from "./Pill";

// The editor's pill and a sent message's are written separately; they must
// stay the same parts in the same order, or the two drift apart in looks.
const shape = (pill: Element) => ({
  class: pill.className,
  marks: [...pill.attributes]
    .filter(({ name }) => name.startsWith("data-relay-"))
    .map(({ name, value }) => `${name}=${value}`),
  parts: [...pill.children].map((part) => [
    part.className.replace(" prompt-pill-remove", ""),
    part.textContent,
  ]),
});

it.each<PillLook>([
  skillPill("$commit", "Commit changes"),
  quotePill("The cache tweak has a real downside."),
  filePill("src/app/"),
  pastePill({ n: 2, text: "a\nb" }),
])("draws the $kind pill alike in the editor and in the thread", (look) => {
  const sent = document.createElement("div");
  sent.innerHTML = renderToStaticMarkup(<Pill look={look} />);
  const { dom } = DOMSerializer.renderSpec(document, pillSpec(look, {}));
  expect(shape(dom as Element)).toEqual(shape(sent.firstElementChild!));
});
