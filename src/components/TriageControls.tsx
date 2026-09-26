import { useAISettings } from "../lib/useAISettings";
import { choiceLabel } from "../../shared/settings";
import { Layers3, RotateCcw, Pause, Play } from "lucide-react";
import { Spinner } from "./ui";
import { isAnalyzing, type TriageState } from "../../shared/triage";
import { agentName } from "../../shared/agents";
interface Props {
  state?: TriageState | null;
  busy: boolean;
  error: unknown;
  onStart: () => void;
  onCancel: () => void;
  plain: boolean;
  onToggle: () => void;
  individualReason?: string;
  incomplete?: boolean;
}
export function TriageControls({
  state,
  busy,
  error,
  onStart,
  onCancel,
  plain,
  onToggle,
  individualReason,
  incomplete,
}: Props) {
  const settings = useAISettings();
  const activeChoice =
    state?.model && (isAnalyzing(state) || state.resume)
      ? {
          model: state.model,
          fast: state.fast ?? false,
          reasoningEffort: state.reasoningEffort ?? "medium",
          provider: state.provider ?? "codex",
        }
      : settings.data && {
          ...settings.data.grouping,
          provider: settings.data.groupingProvider,
        };
  const agent = agentName(activeChoice?.provider ?? "codex");
  const running = isAnalyzing(state),
    result = state?.result,
    resume = state?.resume;
  return (
    <div className="triage-controls">
      <div className="triage-actions">
        <button
          className="triage-start"
          disabled={busy || running || !settings.data}
          onClick={onStart}
          title={`Find repeated whole-file changes. Analyzes this PR in small batches with ${activeChoice ? choiceLabel(activeChoice, activeChoice.provider) : agent}. Source changes are sent to your signed-in ${agent} account.`}
        >
          {running ? (
            <Spinner size={14} />
          ) : resume ? (
            <Play size={14} />
          ) : result ? (
            <RotateCcw size={14} />
          ) : (
            <Layers3 size={14} />
          )}{" "}
          {running
            ? "Grouping changes…"
            : resume
              ? "Resume analysis"
              : result
                ? "Analyze again"
                : "Group changes"}
        </button>
        {running ? (
          <button
            className="icon-button"
            aria-label="Pause analysis"
            onClick={onCancel}
          >
            <Pause size={14} />
          </button>
        ) : result?.groups.length ? (
          <button className="triage-view" onClick={onToggle}>
            {plain ? "Show groups" : "Show all files"}
          </button>
        ) : null}
      </div>
      {activeChoice && (running || resume) && (
        <small className="triage-model">
          {choiceLabel(activeChoice, activeChoice.provider)}
          {resume ? " · saved checkpoint" : ""}
        </small>
      )}
      {settings.error && (
        <p className="triage-error" role="alert">
          {settings.error.message}
        </p>
      )}
      <div className="triage-status" role="status" aria-live="polite">
        {running
          ? state?.status === "scanning"
            ? `Reading files · ${state.scanned}/${state.total || "…"}`
            : `${state?.status === "matching" ? "Checking discovered patterns" : "Discovering patterns"} · ${state?.checked}/${state?.candidates} files`
          : result
            ? `${resume ? `Paused · ${resume.remaining} remaining · ` : ""}${result.groups.length} ${result.groups.length === 1 ? "group" : "groups"} · ${result.groups.reduce((n, g) => n + g.paths.length, 0)} files${result.usage.inputTokens ? ` · ${(result.usage.inputTokens / 1000).toFixed(1)}k input tokens` : ""}`
            : state?.error
              ? "Analysis stopped · files remain available"
              : ""}
      </div>
      {(error || state?.error) && (
        <p className="triage-error" role="alert">
          {error instanceof Error
            ? error.message
            : (state?.error ?? String(error))}
        </p>
      )}
      {result?.notice && <p className="triage-error">{result.notice}</p>}
      {!running && individualReason && (
        <details className="triage-explanation" key={individualReason}>
          <summary>
            {incomplete
              ? "Analysis incomplete for this file"
              : "Why this file is individual"}
          </summary>
          <p>{individualReason}</p>
        </details>
      )}
    </div>
  );
}
