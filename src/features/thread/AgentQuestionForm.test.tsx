// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AgentQuestionForm } from "./AgentQuestionForm";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const question = {
  id: "q",
  question: "Scores or agent?",
  options: [{ label: "Scores" }, { label: "Agent" }],
};

function mount({ deferred = true } = {}) {
  const onRespond = vi.fn(async () => {});
  const host = document.createElement("div");
  document.body.append(host);
  act(() =>
    createRoot(host).render(
      <AgentQuestionForm
        questions={[question]}
        busy={false}
        onRespond={onRespond}
        deferred={deferred}
      />,
    ),
  );
  const option = (label: string) =>
    [
      ...host.querySelectorAll<HTMLButtonElement>(".agent-question-option"),
    ].find((b) => b.textContent?.includes(label))!;
  const input = host.querySelector("input")!;
  const type = (value: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const send = () => act(() => host.querySelector("form")!.requestSubmit());
  const skip = () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Skip");
  return { option, input, type, send, skip, onRespond };
}

it("clicking a picked option again unpicks it", () => {
  const { option } = mount();
  act(() => option("Scores").click());
  expect(option("Scores").getAttribute("aria-pressed")).toBe("true");
  act(() => option("Scores").click());
  expect(option("Scores").getAttribute("aria-pressed")).toBe("false");
});

it("writing your own answer replaces the picked option", () => {
  const { option, type, send, onRespond } = mount();
  act(() => option("Scores").click());
  type("Both, honestly");
  expect(option("Scores").getAttribute("aria-pressed")).toBe("false");
  send();
  expect(onRespond).toHaveBeenCalledWith({
    kind: "question",
    answers: { q: ["Both, honestly"] },
  });
});

it("skips a waiting question without answers, but not one the agent isn't waiting on", () => {
  const waiting = mount({ deferred: false });
  act(() => waiting.option("Scores").click());
  act(() => waiting.skip()!.click());
  expect(waiting.onRespond).toHaveBeenCalledWith({
    kind: "question",
    answers: null,
  });
  expect(mount({ deferred: true }).skip()).toBeUndefined();
});

it("shows only offered native choices and submits their stable ids, even when labels repeat", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onRespond = vi.fn(async () => {});
  act(() =>
    root.render(
      <AgentQuestionForm
        questions={[
          {
            id: "native",
            question: "Pick a target.",
            allowCustomAnswer: false,
            options: [
              { label: "Same", value: "first" },
              { label: "Same", value: "second" },
            ],
          },
        ]}
        busy={false}
        deferred
        onRespond={onRespond}
      />,
    ),
  );
  expect(host.querySelector("input")).toBeNull();
  act(() =>
    host
      .querySelectorAll<HTMLButtonElement>(".agent-question-option")[1]!
      .click(),
  );
  act(() => host.querySelector("form")!.requestSubmit());
  expect(onRespond).toHaveBeenCalledWith({
    kind: "question",
    answers: { native: ["second"] },
  });
  act(() => root.unmount());
});
