// A language server just big enough for Relay's tests: LSP over stdio, with
// canned answers. Its behaviour is set by environment variables:
//   FAKE_LSP_LOG          append every message it receives, as JSON lines
//   FAKE_LSP_STARTS       a file counting how many times it has started
//   FAKE_LSP_CRASH_STARTS exit shortly after `initialized` for the first N starts
//   FAKE_LSP_PROGRESS     report a progress that ends after this many ms
//   FAKE_LSP_REPORTS      send this many progress reports at once (never ended)
//   FAKE_LSP_BAD_INIT     answer `initialize` with an error
//   FAKE_LSP_REAL         name files by their real path, as clangd does through a symlink
//   FAKE_LSP_HOVER        answer every hover with this Markdown
//   FAKE_LSP_SLOW_DEFINITION  answer definitions this many ms late
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const log = (entry) =>
  process.env.FAKE_LSP_LOG &&
  appendFileSync(process.env.FAKE_LSP_LOG, JSON.stringify(entry) + "\n");

let starts = 1;
if (process.env.FAKE_LSP_STARTS) {
  const file = process.env.FAKE_LSP_STARTS;
  starts = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;
  writeFileSync(file, String(starts));
}

const send = (message) => {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};

const texts = new Map();
let nextRequest = 1000;

const diagnose = (uri) => {
  const lines = (texts.get(uri) ?? "").split("\n");
  const diagnostics = lines.flatMap((line, i) =>
    line.includes("ERROR")
      ? [
          {
            range: {
              start: { line: i, character: line.indexOf("ERROR") },
              end: { line: i, character: line.indexOf("ERROR") + 5 },
            },
            severity: 1,
            message: "found ERROR",
            source: "fake",
            code: { value: "E1", target: "x" },
          },
        ]
      : [],
  );
  send({ method: "textDocument/publishDiagnostics", params: { uri: named(uri), diagnostics } });
};

// The URI a server names a file by: with FAKE_LSP_REAL, through any symlinks.
const named = (uri) => {
  if (!process.env.FAKE_LSP_REAL) return uri;
  const file = fileURLToPath(uri);
  return pathToFileURL(realpathSync(dirname(file)) + "/" + basename(file)).href;
};
const sibling = (uri, name) => named(uri.replace(/[^/]*$/, name));
const here = (line, character) => ({
  start: { line, character },
  end: { line, character: character + 3 },
});

// A request at line 999 is one the server can't answer.
const failAt = (position) => {
  if (position.line === 999) throw new Error("bad position");
};

const handlers = {
  initialize(params) {
    if (process.env.FAKE_LSP_BAD_INIT) throw new Error("no thanks");
    log({ initialize: { pid: process.pid, rootUri: params.rootUri, folders: params.workspaceFolders } });
    return { capabilities: { textDocumentSync: 1, hoverProvider: true } };
  },
  shutdown: () => null,
  "textDocument/hover": ({ position }) => {
    failAt(position);
    return {
      contents: {
        kind: "markdown",
        value: process.env.FAKE_LSP_HOVER ?? `hover ${position.line}:${position.character}`,
      },
      range: here(position.line, position.character),
    };
  },
  "textDocument/definition": ({ textDocument }) => [
    { uri: sibling(textDocument.uri, "other.txt"), range: here(2, 4) },
    {
      targetUri: process.env.FAKE_LSP_OUTSIDE,
      targetRange: here(0, 0),
      targetSelectionRange: here(7, 1),
    },
  ],
  "textDocument/references": ({ textDocument }) => [
    { uri: named(textDocument.uri), range: here(0, 0) },
    { uri: sibling(textDocument.uri, "other.txt"), range: here(1, 1) },
  ],
  "textDocument/completion": () => ({
    isIncomplete: false,
    items: [
      { label: "beta", kind: 3, sortText: "b", insertText: "beta()", detail: "fn()" },
      { label: "alpha", kind: 6, sortText: "a", documentation: { kind: "markdown", value: "**a**" } },
    ],
  }),
  "textDocument/documentSymbol": () => [
    {
      name: "Outer",
      kind: 5,
      range: { start: { line: 0, character: 0 }, end: { line: 9, character: 1 } },
      selectionRange: here(0, 6),
      children: [
        {
          name: "inner",
          kind: 6,
          range: { start: { line: 1, character: 2 }, end: { line: 3, character: 3 } },
          selectionRange: here(1, 5),
        },
      ],
    },
  ],
  "workspace/symbol": ({ query }) => [
    { name: query + "Thing", kind: 12, location: { uri: process.env.FAKE_LSP_OUTSIDE, range: here(4, 0) } },
  ],
  "textDocument/rename": ({ textDocument, position, newName }) => {
    failAt(position);
    return {
      changes: {
        [named(textDocument.uri)]: [{ range: here(0, 0), newText: newName }],
        [sibling(textDocument.uri, "other.txt")]: [{ range: here(1, 1), newText: newName }],
      },
    };
  },
  "textDocument/formatting": ({ options }) => [
    { range: here(0, 0), newText: `fmt${options.tabSize}${options.insertSpaces}` },
  ],
};

const notifications = {
  initialized() {
    send({ id: nextRequest++, method: "workspace/configuration", params: { items: [{ section: "a" }, { section: "b" }] } });
    send({ id: nextRequest++, method: "client/registerCapability", params: { registrations: [] } });
    send({ id: nextRequest++, method: "window/workDoneProgress/create", params: { token: "t1" } });
    send({ id: nextRequest++, method: "made/up", params: {} });
    if (process.env.FAKE_LSP_REPORTS) {
      send({ method: "$/progress", params: { token: "t2", value: { kind: "begin", title: "Counting", percentage: 0 } } });
      for (let i = 1; i <= Number(process.env.FAKE_LSP_REPORTS); i++)
        send({ method: "$/progress", params: { token: "t2", value: { kind: "report", message: `file ${i}`, percentage: i } } });
    }
    if (process.env.FAKE_LSP_PROGRESS) {
      send({ method: "$/progress", params: { token: "t1", value: { kind: "begin", title: "Indexing", percentage: 10 } } });
      setTimeout(
        () => send({ method: "$/progress", params: { token: "t1", value: { kind: "end" } } }),
        Number(process.env.FAKE_LSP_PROGRESS),
      );
    }
    if (starts <= Number(process.env.FAKE_LSP_CRASH_STARTS ?? 0))
      setTimeout(() => process.exit(3), 20);
  },
  "textDocument/didOpen"({ textDocument }) {
    texts.set(textDocument.uri, textDocument.text);
    diagnose(textDocument.uri);
  },
  "textDocument/didChange"({ textDocument, contentChanges }) {
    texts.set(textDocument.uri, contentChanges.at(-1).text);
    diagnose(textDocument.uri);
  },
  "textDocument/didClose"({ textDocument }) {
    texts.delete(textDocument.uri);
  },
  exit: () => process.exit(0),
};

const receive = (message) => {
  log(message);
  if (message.method === undefined) return; // a reply to one of ours
  if (message.id === undefined) return notifications[message.method]?.(message.params);
  try {
    const handler = handlers[message.method];
    if (!handler) throw new Error(`no ${message.method}`);
    const result = handler(message.params);
    const late = message.method === "textDocument/definition" ? Number(process.env.FAKE_LSP_SLOW_DEFINITION ?? 0) : 0;
    if (late) setTimeout(() => send({ id: message.id, result }), late);
    else send({ id: message.id, result });
  } catch (e) {
    send({ id: message.id, error: { code: -32603, message: e.message } });
  }
};

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const body = buffer.subarray(end + 4, end + 4 + length).toString();
    buffer = buffer.subarray(end + 4 + length);
    receive(JSON.parse(body));
  }
});
