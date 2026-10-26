import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { AgentQuestion, AgentResponse } from "../../../shared/agent-modes";
import { isTypingTarget, popupOpen } from "../../lib/shortcuts";

export function AgentQuestionForm({
  questions,
  busy,
  onRespond,
  deferred = false,
}: {
  questions: AgentQuestion[];
  busy: boolean;
  onRespond: (response: AgentResponse) => Promise<void>;
  deferred?: boolean;
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
    const unpick = current.includes(label);
    const next = {
      ...answers,
      [question.id]: question.multiple
        ? unpick
          ? current.filter((v) => v !== label)
          : [...current, label]
        : unpick
          ? []
          : [label],
    };
    setAnswers(next);
    clearTimeout(timer.current);
    if (!question.multiple && !deferred && !unpick)
      timer.current = setTimeout(() => advance(next), 200);
  };
  const pick = useRef(select);
  pick.current = select;
  useEffect(() => {
    if (!question || busy || collapsed || deferred) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event) ||
        popupOpen()
      )
        return;
      const option = question.options?.[Number(event.key) - 1];
      if (/^[1-9]$/.test(event.key) && option) {
        event.preventDefault();
        pick.current(option.value ?? option.label);
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [question, busy, collapsed, deferred]);
  if (!question) return null;
  const place = `Question ${index + 1} of ${questions.length}`;
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
        <span className="agent-question-topic">
          {question.header || (questions.length > 1 ? place : "Question")}
        </span>
        {question.header && questions.length > 1 && <small>{place}</small>}
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>
      {!collapsed && (
        <fieldset disabled={busy}>
          <legend>{question.question}</legend>
          {question.options?.length ? (
            <div
              className="agent-question-options"
              role={question.multiple ? "group" : "radiogroup"}
            >
              {question.options.map((option, i) => {
                const checked =
                  answers[question.id]?.includes(
                    option.value ?? option.label,
                  ) ?? false;
                return (
                  <button
                    type="button"
                    className="agent-question-option"
                    key={option.value ?? option.label}
                    aria-pressed={checked}
                    onClick={() => select(option.value ?? option.label)}
                  >
                    <span className="agent-question-option-key" aria-hidden>
                      {checked ? (
                        <Check size={13} strokeWidth={2.5} />
                      ) : i < 9 && !deferred ? (
                        <kbd>{i + 1}</kbd>
                      ) : null}
                    </span>
                    <span className="agent-question-option-text">
                      {option.label}
                      {option.description && (
                        <small>{option.description}</small>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {question.allowCustomAnswer !== false && (
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
                .filter(
                  (a) =>
                    !question.options?.some((o) => (o.value ?? o.label) === a),
                )
                .join(", ")}
              onChange={(event) => {
                clearTimeout(timer.current);
                setAnswers((old) => ({
                  ...old,
                  [question.id]: [event.target.value],
                }));
              }}
            />
          )}
          <QuestionFooter
            question={question}
            deferred={deferred}
            submitLabel={
              index < questions.length - 1
                ? "Next"
                : deferred
                  ? "Send answer"
                  : "Continue"
            }
            canSubmit={!busy && !!answers[question.id]?.some((a) => a.trim())}
            onSkip={() => {
              clearTimeout(timer.current);
              void onRespond({ kind: "question", answers: null });
            }}
            onBack={
              index > 0
                ? () => {
                    clearTimeout(timer.current);
                    setIndex(index - 1);
                  }
                : undefined
            }
          />
        </fieldset>
      )}
    </form>
  );
}

function QuestionFooter({
  question,
  deferred,
  submitLabel,
  canSubmit,
  onSkip,
  onBack,
}: {
  question: AgentQuestion;
  deferred: boolean;
  submitLabel: string;
  canSubmit: boolean;
  onSkip: () => void;
  /** Missing on the first question. */
  onBack?: () => void;
}) {
  return (
    <footer>
      {question.options?.length && !deferred ? (
        <span className="agent-question-hint">
          {question.multiple
            ? "Pick any that apply"
            : `Press 1–${Math.min(question.options.length, 9)} to pick`}
        </span>
      ) : null}
      {/* A question the agent isn't waiting on has Dismiss instead. */}
      {!deferred && (
        <button
          type="button"
          title="Let the agent decide on its own"
          onClick={onSkip}
        >
          Skip
        </button>
      )}
      {onBack && (
        <button type="button" onClick={onBack}>
          Back
        </button>
      )}
      <button type="submit" className="primary" disabled={!canSubmit}>
        {submitLabel}
      </button>
    </footer>
  );
}
