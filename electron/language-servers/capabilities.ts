const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/**
 * What Relay's editor can use, told to every server. Snippets are off so
 * completions arrive as plain text; files are never created, moved or
 * deleted on a server's say.
 */
export const clientCapabilities = {
  general: { positionEncodings: ["utf-16"] },
  window: { workDoneProgress: true },
  workspace: {
    workspaceFolders: true,
    configuration: true,
    applyEdit: false,
    workspaceEdit: { documentChanges: true, resourceOperations: [] },
    symbol: { symbolKind: { valueSet: range(26) } },
    didChangeConfiguration: { dynamicRegistration: false },
    didChangeWatchedFiles: { dynamicRegistration: false },
  },
  textDocument: {
    synchronization: {
      dynamicRegistration: false,
      willSave: false,
      didSave: true,
    },
    hover: { contentFormat: ["markdown", "plaintext"] },
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: false,
        documentationFormat: ["markdown", "plaintext"],
        deprecatedSupport: true,
        tagSupport: { valueSet: [1] },
        labelDetailsSupport: true,
        insertReplaceSupport: true,
      },
      completionItemKind: { valueSet: range(25) },
    },
    definition: { linkSupport: true },
    references: {},
    rename: { prepareSupport: false },
    formatting: {},
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: { valueSet: range(26) },
    },
    publishDiagnostics: {
      relatedInformation: false,
      versionSupport: false,
      tagSupport: { valueSet: [1, 2] },
    },
  },
  // rust-analyzer's "quiescent" flag, which says when it has finished loading.
  experimental: { serverStatusNotification: true },
};
