/** An MCP tool result. */
export interface ToolResult {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[];
  isError?: boolean;
}

/** The result's text, its pictures left out. */
export const resultText = (result: ToolResult) =>
  result.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
export const toolText = (text: string, isError = false): ToolResult => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});
