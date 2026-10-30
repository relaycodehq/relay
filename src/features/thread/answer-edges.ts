import { useLayoutEffect, type RefObject } from "react";

/**
 * Marks each answer in the column with how it ends and what follows it, for
 * thread.css: `data-ends-in-text` when its text is right above its actions,
 * `data-before-side-question` when a side question comes next. This used to
 * be `:has()`, which made the browser restyle a streaming answer's whole
 * subtree on every update. The observer only watches direct children, so
 * text streaming inside an answer doesn't wake it.
 */
export function useAnswerEdges(column: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const list = column.current;
    if (!list) return;
    const mark = (answer: Element) => {
      answer.toggleAttribute(
        "data-ends-in-text",
        !!answer.querySelector(":scope > .markdown + .message-actions"),
      );
      answer.toggleAttribute(
        "data-before-side-question",
        !!answer.nextElementSibling?.classList.contains("side-question"),
      );
    };
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.target === list)) return markAll();
      for (const r of records) mark(r.target as Element);
    });
    const markAll = () => {
      for (const answer of list.querySelectorAll(
        ":scope > .project-message.assistant",
      )) {
        mark(answer);
        observer.observe(answer, { childList: true });
      }
    };
    markAll();
    observer.observe(list, { childList: true });
    return () => observer.disconnect();
  }, [column]);
}
