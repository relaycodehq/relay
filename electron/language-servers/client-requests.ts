import { RpcError } from "./rpc";

export const workspaceFolder = (folderUri: string, root: string) => ({
  uri: folderUri,
  name: root.split(/[\\/]/).filter(Boolean).pop(),
});

/**
 * The part of `settings` a dotted section names ("typescript.inlayHints"), all
 * of them for no section (vtsls asks for ""); null for the server's default.
 */
function sectionOf(settings: Record<string, unknown> | undefined, section: unknown) {
  if (!settings) return null;
  if (typeof section !== "string" || !section) return settings;
  let value: unknown = settings;
  for (const key of section.split(".")) {
    if (typeof value !== "object" || value === null) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value ?? null;
}

/** Answers what a server asks of its editor: its settings, and no to the rest. */
export function answerServerRequest(
  method: string,
  params: unknown,
  folder: { uri: string; name: string | undefined },
  settings?: Record<string, unknown>,
): unknown {
  switch (method) {
    case "workspace/configuration": {
      const items = (params as { items?: { section?: unknown }[] } | null)?.items ?? [];
      return items.map((item) => sectionOf(settings, item?.section));
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
