import {
  lspCharacterSchema,
  lspFormatOptionsSchema,
  lspLineSchema,
  lspNewNameSchema,
  lspPathSchema,
  lspQuerySchema,
} from "../../shared/language-servers";
import { textSchema } from "../../shared/validation";
import { workspaceIdSchema } from "../../shared/workspaces";
import { takes, type ApiContext, type Handlers } from "./context";

/** Hover, go to definition, completion and the rest, from the language servers Relay runs per folder. */
export function languageServerHandlers(ctx: ApiContext) {
  const lsp = ctx.languageServers;
  // Files are open per window, so one window closing a file leaves it open for another.
  const owner = () => ctx.window.caller() ?? undefined;
  const at = [
    workspaceIdSchema,
    lspPathSchema,
    lspLineSchema,
    lspCharacterSchema,
  ] as const;
  return {
    lspOpen: takes(
      [workspaceIdSchema, lspPathSchema, textSchema],
      (where, path, text) => lsp.lspOpen(where, path, text, owner()),
    ),
    lspChange: takes([workspaceIdSchema, lspPathSchema, textSchema], (...a) =>
      lsp.lspChange(...a),
    ),
    lspSave: takes([workspaceIdSchema, lspPathSchema], (...a) =>
      lsp.lspSave(...a),
    ),
    lspClose: takes([workspaceIdSchema, lspPathSchema], (where, path) =>
      lsp.lspClose(where, path, owner()),
    ),
    lspHover: takes(at, (...a) => lsp.lspHover(...a)),
    lspDefinition: takes(at, (...a) => lsp.lspDefinition(...a)),
    lspReferences: takes(at, (...a) => lsp.lspReferences(...a)),
    lspCompletion: takes(at, (...a) => lsp.lspCompletion(...a)),
    lspRename: takes([...at, lspNewNameSchema], (...a) => lsp.lspRename(...a)),
    lspFormat: takes(
      [workspaceIdSchema, lspPathSchema, lspFormatOptionsSchema.optional()],
      (...a) => lsp.lspFormat(...a),
    ),
    lspDocumentSymbols: takes([workspaceIdSchema, lspPathSchema], (...a) =>
      lsp.lspDocumentSymbols(...a),
    ),
    lspInlayHints: takes(
      [workspaceIdSchema, lspPathSchema, lspLineSchema, lspLineSchema],
      (...a) => lsp.lspInlayHints(...a),
    ),
    lspWorkspaceSymbols: takes([workspaceIdSchema, lspQuerySchema], (...a) =>
      lsp.lspWorkspaceSymbols(...a),
    ),
    lspReadFile: takes([workspaceIdSchema, lspPathSchema], (...a) =>
      lsp.lspReadFile(...a),
    ),
    lspStatus: takes([workspaceIdSchema], (where) => lsp.lspStatus(where)),
  } satisfies Handlers;
}
