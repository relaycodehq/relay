import type { AgentTool, AgentToolState } from "../../../shared/agent-tools";

export function filterAgentTools(
  items: readonly AgentTool[],
  query: string,
  state: AgentToolState | "all",
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const text =
      `${item.name} ${item.description} ${item.summary ?? ""} ${item.path ?? ""}`.toLocaleLowerCase();
    return (
      (state === "all" || item.state === state) &&
      words.every((word) => text.includes(word))
    );
  });
}
