// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAnswerEdges } from "./answer-edges";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function Column({ children }: { children: ReactNode }) {
  const column = useRef<HTMLDivElement>(null);
  useAnswerEdges(column);
  return <div ref={column}>{children}</div>;
}

function render(children: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root ??= createRoot(host);
  act(() => root!.render(<Column>{children}</Column>));
  return document.querySelector(".project-message.assistant")!;
}

const answer = (end: ReactNode) => (
  <article className="project-message assistant">
    <div className="markdown">Done.</div>
    {end}
    <footer className="message-actions" />
  </article>
);

const flush = () => act(() => Promise.resolve());

it("follows a card mounting between an answer's text and its actions", async () => {
  const article = render(answer(null));
  expect(article.hasAttribute("data-ends-in-text")).toBe(true);

  render(answer(<div className="card" />));
  await flush();
  expect(article.hasAttribute("data-ends-in-text")).toBe(false);
});

it("follows a side question arriving after an answer", async () => {
  const article = render(answer(null));
  expect(article.hasAttribute("data-before-side-question")).toBe(false);

  render(
    <>
      {answer(null)}
      <article className="project-message user side-question" />
    </>,
  );
  await flush();
  expect(article.hasAttribute("data-before-side-question")).toBe(true);
});
