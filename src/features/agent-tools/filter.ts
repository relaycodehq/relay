import type {
  AgentTool,
  AgentToolSource,
  AgentToolState,
} from "../../../shared/agent-tools";

export function filterAgentTools(
  items: readonly AgentTool[],
  query: string,
  source: AgentToolSource | "all",
  state: AgentToolState | "all",
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const text =
      `${item.name} ${item.description} ${item.path ?? ""}`.toLocaleLowerCase();
    return (
      (source === "all" || item.source === source) &&
      (state === "all" || item.state === state) &&
      words.every((word) => text.includes(word))
    );
  });
}
