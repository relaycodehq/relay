import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Terminal } from "lucide-react";
import type { ChangedFile, LocalFolder, Pull } from "../../shared/types";
import { lineExcerpt, type QuestionTarget } from "../../shared/questions";
import { choiceLabel } from "../../shared/settings";
import { agentName, agents } from "../../shared/agents";
import { useAISettings } from "../lib/useAISettings";
import { api } from "../lib/api";
import { ErrorBox, Modal } from "./ui";

/** Opens the line-question agent in a terminal, about lines picked in a diff. */
export function AskAboutLines({
  pull,
  file,
  target,
  folder,
  onLink,
  onClose,
}: {
  pull: Pull;
  file: ChangedFile;
  target: QuestionTarget;
  folder?: LocalFolder | null;
  onLink: () => Promise<void>;
  onClose: () => void;
}) {
  const settings = useAISettings();
  const provider = settings.data?.questionsProvider ?? "codex";
  const name = agentName(provider),
    agent = agents[provider].cli;
  const [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const contents = useQuery({
    queryKey: [
      "contents",
      pull.owner,
      pull.name,
      pull.number,
      pull.head.sha,
      pull.merge_base,
      file.filename,
    ],
    queryFn: () => api.contents(pull, file, pull.head.sha, pull.merge_base),
    gcTime: 0,
    staleTime: Infinity,
  });
  const context = useMemo(() => {
    const source =
      target.side === "deletions" ? contents.data?.old : contents.data?.next;
    if (!source) return;
    try {
      return { lines: lineExcerpt(source.contents, target.start, target.end) };
    } catch (error) {
      return { error };
    }
  }, [contents.data, target]);
  const revision =
    target.side === "deletions" ? pull.merge_base : pull.head.sha;
  const sourcePath =
    target.side === "deletions"
      ? file.previous_filename || file.filename
      : file.filename;
  return (
    <Modal title={`Ask ${name}`} className="ask-codex-modal" onClose={onClose}>
      <div className="codex-target">
        <MessageSquare size={20} />
        <div>
          <strong>{sourcePath}</strong>
          <small>
            {target.start === target.end
              ? `Line ${target.start}`
              : `Lines ${target.start}–${target.end}`}{" "}
            · {target.side === "deletions" ? "Before this PR" : "PR head"} ·{" "}
            {revision.slice(0, 8)}
          </small>
        </div>
      </div>
      <label>
        Your question
        <textarea
          aria-label="Question about selected code"
          autoFocus
          rows={5}
          maxLength={12000}
          placeholder="Why does this work this way? What calls it? Is this change safe?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      {context?.lines && (
        <details className="question-context">
          <summary>
            Included code context · {context.lines.length} lines
          </summary>
          <pre>
            {context.lines
              .map((l) => `${l.selected ? ">" : " "} ${l.line}  ${l.text}`)
              .join("\n")}
          </pre>
        </details>
      )}
      <div className="question-session">
        <span>
          {settings.data
            ? choiceLabel(
                settings.data.questions,
                settings.data.questionsProvider,
              )
            : "Loading model…"}
        </span>
        <span>Read-only session</span>
      </div>
      <p className="field-note">
        Opens {agent} at your linked repository’s root. Includes these lines and
        nearby code from this PR revision; {agent} can inspect the project for
        more context. Ask follow-up questions in the terminal.
      </p>
      {folder && (
        <p className="question-folder" title={folder.path}>
          {folder.path}
        </p>
      )}
      {folder && (folder.dirty || folder.head !== pull.head.sha) && (
        <p className="field-note">
          Your checkout differs from the PR snapshot. {name} receives the exact
          PR code and a note about the local version.
        </p>
      )}
      {!!(error || settings.error || contents.error || context?.error) && (
        <ErrorBox
          error={error || settings.error || contents.error || context?.error}
        />
      )}
      <div className="modal-actions">
        {!folder ? (
          <button
            className="primary"
            onClick={() => void onLink().catch(setError)}
          >
            Link a repository first
          </button>
        ) : (
          <button
            className="primary"
            disabled={
              busy || !question.trim() || !context?.lines || !settings.data
            }
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await api.askAboutLines(pull, {
                  ...target,
                  head: pull.head.sha,
                  base: pull.merge_base,
                  question,
                });
                onClose();
              } catch (error) {
                setError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Terminal size={15} />
            {busy ? "Opening terminal…" : `Ask in ${name}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
