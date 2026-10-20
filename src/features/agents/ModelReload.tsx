import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCw, Square, TriangleAlert } from "lucide-react";
import { agentName, type AgentProvider } from "../../../shared/agents";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/error-message";
import { agentModelsQuery } from "./useAgentPicks";

/** Agents that read their model list once, as they start. */
export const reloadsModels = (provider: AgentProvider) =>
  provider === "opencode";

type State =
  | { kind: "idle" }
  | { kind: "confirm"; running: { id: string; title: string }[] }
  | { kind: "busy" }
  | { kind: "done"; added: number }
  | { kind: "failed"; error: string };

/**
 * The picker's footer for an agent whose list only changes when it restarts:
 * says so, and asks before stopping the threads running on it.
 */
export function ModelReload({
  provider,
  computer,
}: {
  provider: AgentProvider;
  /** A project on a paired computer: that computer's copy restarts. */
  computer?: { id: string; name: string };
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<State>({ kind: "idle" });
  const name = agentName(provider);

  async function reload(stopRunning: boolean) {
    const before = new Set(
      qc
        .getQueryData<{ id: string }[]>(
          agentModelsQuery(provider, computer?.id).queryKey,
        )
        ?.map((m) => m.id) ?? [],
    );
    setState({ kind: "busy" });
    try {
      const { running } = await api.reloadAgentModels(
        provider,
        stopRunning,
        computer?.id,
      );
      if (running.length) return setState({ kind: "confirm", running });
      const models = await qc.query({
        ...agentModelsQuery(provider, computer?.id),
        staleTime: 0,
      });
      setState({
        kind: "done",
        added: models.filter((m) => !before.has(m.id)).length,
      });
    } catch (error) {
      setState({ kind: "failed", error: errorMessage(error) });
    }
  }

  const running = state.kind === "confirm" ? state.running : [];
  return (
    <div className="model-reload">
      {running.length ? (
        <>
          <button
            type="button"
            className="model-reload-button"
            onClick={() => void reload(true)}
          >
            <Square size={10} aria-hidden />
            Stop and restart
          </button>
          <button
            type="button"
            className="model-reload-button"
            onClick={() => setState({ kind: "idle" })}
          >
            Cancel
          </button>
          <span role="alert" className="model-reload-warning">
            <TriangleAlert size={12} aria-hidden />
            Interrupts {running.map((c) => `“${c.title}”`).join(", ")};{" "}
            {running.length === 1 ? "it carries" : "they carry"} on after
          </span>
        </>
      ) : (
        <>
          <button
            type="button"
            className="model-reload-button"
            disabled={state.kind === "busy"}
            onClick={() => void reload(false)}
          >
            <RotateCw size={12} aria-hidden />
            {state.kind === "busy" ? "Refreshing…" : "Refresh models"}
          </button>
          <span role="status">
            {state.kind === "done"
              ? state.added
                ? `${state.added} new model${state.added === 1 ? "" : "s"}`
                : "Up to date"
              : state.kind === "failed"
                ? state.error
                : computer
                  ? `Restarts ${name} on ${computer.name}`
                  : `Restarts ${name}`}
          </span>
        </>
      )}
    </div>
  );
}
