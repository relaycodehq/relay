import { CornerDownRight, MessageCircleQuestion } from "lucide-react";
import type { AskedQuestion } from "../../../shared/asked-questions";
import "./answered-questions.css";

/** The same saved question/answer row for native calls and async cards. */
export function AnsweredQuestions({
  questions,
  label = `Asked you ${questions.length} ${questions.length === 1 ? "question" : "questions"}`,
  status,
}: {
  questions: AskedQuestion[];
  label?: string;
  status?: string;
}) {
  return (
    <details className="answered-questions" open>
      <summary className="answered-questions-heading">
        <MessageCircleQuestion size={14} aria-hidden />
        <span>{label}</span>
        {status && <span role="status">{status}</span>}
      </summary>
      <div className="answered-questions-body">
        {questions.map((q, i) => (
          <div key={i}>
            <div>{q.question}</div>
            <div className="answered-question-answer">
              <CornerDownRight size={12} aria-hidden />
              <span>{q.answer}</span>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
