import { AlertCircle, ArrowDownToLine, Check } from "lucide-react";
import { useRecent } from "./useRecent";
import {
  updateAgent,
  useAgentUpdateChecks,
  useAgentVersions,
} from "./agent-updates";
import {
  isBehind,
  isUpdating,
  type AgentVersion,
} from "../../../shared/agent-updates";
import { agentInfo } from "../../../shared/agents";
import { Spinner } from "../../ui/ui";
import "./agent-updates.css";

const names = (list: AgentVersion[]) =>
  list.length === 1 ? agentInfo(list[0].provider).name : "agents";

/**
 * Sidebar footer control, hidden until an agent CLI has a newer release, or
 * for good when agent update checks are off. It updates the ones Relay can
 * update itself; the rest, and failures, open Settings, which says more.
 */
export function AgentUpdateButton({ onDetails }: { onDetails: () => void }) {
  const list = useAgentVersions()?.agents ?? [];
  const notices = useAgentUpdateChecks() === true;
  const updating = list.filter(isUpdating);
  const failed = list.filter((a) => a.update?.status === "failed");
  // Amp ships every few hours, so a newer release would always be showing.
  const behind = notices ? list.filter(isBehind) : [];
  const updatable = behind.filter((a) => a.command);
  const updatedAt = Math.max(
    0,
    ...list.map((a) => (a.update?.status === "updated" ? a.update.at : 0)),
  );
  const justUpdated = useRecent(updatedAt || undefined, 4000);

  if (updating.length)
    return (
      <button
        type="button"
        className="sb-agent-update busy"
        disabled
        title={`Updating ${updating.map((a) => agentInfo(a.provider).cli).join(" and ")}`}
      >
        <Spinner size={12} />
        <span>Updating…</span>
      </button>
    );
  if (failed.length)
    return (
      <button
        type="button"
        className="sb-agent-update failed"
        title={[
          ...failed.map(
            (a) => a.update?.status === "failed" && a.update.message,
          ),
          "Opens Settings.",
        ].join("\n")}
        onClick={onDetails}
      >
        <AlertCircle size={13} />
        <span>Update failed</span>
      </button>
    );
  if (behind.length)
    return (
      <button
        type="button"
        className="sb-agent-update"
        title={[
          ...behind.map(
            (a) =>
              `${agentInfo(a.provider).cli} ${a.latest} is available (you have ${a.current})${a.command ? "" : ", update it yourself"}`,
          ),
          updatable.length ? "" : "Opens Settings.",
        ]
          .join("\n")
          .trim()}
        onClick={() =>
          updatable.length
            ? updatable.forEach((a) => updateAgent(a.provider))
            : onDetails()
        }
      >
        <ArrowDownToLine size={13} />
        <span>Update {names(behind)}</span>
      </button>
    );
  if (justUpdated)
    return (
      <span className="sb-agent-update done" role="status">
        <Check size={13} />
        <span>Updated</span>
      </span>
    );
  return null;
}
