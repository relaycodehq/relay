// A tool call as the agent made it, checked before it reaches the thread's tools.
import {
  relayToolSchemas,
  toolText,
  type RelayToolArgs,
  type RelayToolName,
  type ToolResult,
} from "../relay-mcp";

/** Keeps each validated tool name paired with its own schema output. */
export type ToolCall = {
  [N in RelayToolName]: { name: N; input: RelayToolArgs<N> };
}[RelayToolName];

/** The call with its arguments checked against the tool's schema, or why it can't be made. */
export function checkedCall(
  name: string,
  args: unknown,
): { call: ToolCall } | { refusal: ToolResult } {
  if (!Object.hasOwn(relayToolSchemas, name))
    return { refusal: toolText(`There is no tool ${name}.`, true) };
  const parsed = relayToolSchemas[name as RelayToolName].safeParse(args);
  if (!parsed.success)
    return {
      refusal: toolText(
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
          .join("\n"),
        true,
      ),
    };
  // The lookup and parse above establish this pairing; keep it together so
  // narrowing the tool name also narrows its arguments in every branch.
  return { call: { name, input: parsed.data } as ToolCall };
}
