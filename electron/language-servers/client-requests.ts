import { RpcError } from "./rpc";

export const workspaceFolder = (folderUri: string, root: string) => ({
  uri: folderUri,
  name: root.split(/[\\/]/).filter(Boolean).pop(),
});

/** Answers what a server asks of its editor. Relay supports none of it beyond saying no. */
export function answerServerRequest(
  method: string,
  params: unknown,
  folder: { uri: string; name: string | undefined },
): unknown {
  switch (method) {
    case "workspace/configuration": {
      // Relay sets none: every section is the server's own default.
      const items = (params as { items?: unknown[] } | null)?.items ?? [];
      return items.map(() => null);
    }
    case "workspace/workspaceFolders":
      return [folder];
    case "workspace/applyEdit":
      return {
        applied: false,
        failureReason: "Relay doesn't apply edits a server asks for",
      };
    case "window/showDocument":
      return { success: false };
    case "client/registerCapability":
    case "client/unregisterCapability":
    case "window/workDoneProgress/create":
    case "window/showMessageRequest":
      return null;
    default:
      // The refresh requests (semantic tokens, inlay hints, diagnostics) want nothing back.
      if (/\/refresh$/.test(method)) return null;
      throw new RpcError(`Method not found: ${method}`, -32601);
  }
}
