// Adapted from T3's ComposerPendingUserInputPanel (MIT); see THIRD_PARTY_NOTICES.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { AgentQuestion, AgentResponse } from "../../shared/agent-modes";

export function AgentQuestionForm({
  questions,
  busy,
  onRespond,
}: {
  questions: AgentQuestion[];
  busy: boolean;
  onRespond: (response: AgentResponse) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [index, setIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const question = questions[index];
  const advance = (next: Record<string, string[]>) => {
    if (index < questions.length - 1) {
      setIndex(index + 1);
      setCollapsed(false);
    } else void onRespond({ kind: "question", answers: next });
  };
  const select = (label: string) => {
    if (busy || !question) return;
    const current = answers[question.id] ?? [];
    const next = {
      ...answers,
      [question.id]: question.multiple
        ? current.includes(label)
          ? current.filter((v) => v !== label)
          : [...current, label]
        : [label],
    };
    setAnswers(next);
    clearTimeout(timer.current);
    if (!question.multiple)
      timer.current = setTimeout(() => advance(next), 200);
  };
  useEffect(() => {
    if (!question || busy || collapsed) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input,textarea,[contenteditable="true"]'))
      )
        return;
      const option = question.options?.[Number(event.key) - 1];
      if (/^[1-9]$/.test(event.key) && option) {
        event.preventDefault();
        select(option.label);
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  });
  if (!question) return null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        clearTimeout(timer.current);
        advance(answers);
      }}
    >
      <button
        type="button"
        className="agent-question-heading"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span>{question.header || "Question"}</span>
        {questions.length > 1 && (
          <small>
            {index + 1}/{questions.length}
          </small>
        )}
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>
      {!collapsed && (
        <fieldset disabled={busy}>
          <legend>{question.question}</legend>
          <div className="agent-question-options">
            {question.options?.map((option, i) => {
              const checked =
                answers[question.id]?.includes(option.label) ?? false;
              return (
                <button
                  type="button"
                  className="agent-question-option"
                  key={option.label}
                  aria-pressed={checked}
                  onClick={() => select(option.label)}
                >
                  <span>
                    {option.label}
                    {option.description && <small>{option.description}</small>}
                  </span>
                  {checked ? (
                    <Check size={14} />
                  ) : i < 9 ? (
                    <kbd>{i + 1}</kbd>
                  ) : null}
                </button>
              );
            })}
          </div>
          <input
            type={question.isSecret ? "password" : "text"}
            maxLength={16000}
            aria-label={question.question}
            placeholder={
              question.options?.length
                ? "Or write your own answer…"
                : "Your answer…"
            }
            value={(answers[question.id] ?? [])
              .filter((a) => !question.options?.some((o) => o.label === a))
              .join(", ")}
            onChange={(event) => {
              clearTimeout(timer.current);
              setAnswers((old) => ({
                ...old,
                [question.id]: [event.target.value],
              }));
            }}
          />
          <footer>
            {index > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearTimeout(timer.current);
                  setIndex(index - 1);
                }}
              >
                Back
              </button>
            )}
            <button
              type="submit"
              className="primary"
              disabled={busy || !answers[question.id]?.some((a) => a.trim())}
            >
              {index < questions.length - 1 ? "Next" : "Continue"}
            </button>
          </footer>
        </fieldset>
      )}
    </form>
  );
}
