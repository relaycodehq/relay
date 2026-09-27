// Checks TypeScript 7 projects through the native compiler's language server
// (`tsc --lsp`), since TypeScript 7 has no JavaScript server API. It never emits
// files; unsaved buffers reach the server as open documents.
//
// The server picks each file's project itself (nearest tsconfig), so a target
// config that no file defaults to is checked under the config that file uses.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect } from "./worker-lsp-rpc.mjs";
import {
  checkedFile,
  hash,
  projectPaths,
  report,
  send,
  sourceResult,
} from "./worker-shared.mjs";

// The language server reports these as warnings even when compiler options
// (noUnusedLocals, allowUnreachableCode: false, ...) make them errors that
// fail tsc. When the option is off they arrive as hints.
const unnecessary = new Set([
  6133, 6138, 6192, 6196, 6198, 6199, 6205, 7027, 7028,
]);
const languageId = (path) =>
  /\.[cm]?tsx?$/.test(path)
    ? path.endsWith("x")
      ? "typescriptreact"
      : "typescript"
    : /\.[cm]?jsx?$/.test(path)
      ? path.endsWith("x")
        ? "javascriptreact"
        : "javascript"
      : path.endsWith(".json")
        ? "json"
        : undefined;
const configName = /^(ts|js)config.*\.json$|^package\.json$/;
async function eachLimited(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/** Resolves once the server answers; throws (and cleans up) if it cannot start. */
export async function startLanguageServer({
  root,
  configFile,
  packageJson,
  paused,
}) {
  const { local, pathName } = projectPaths(root);
  const version = JSON.parse(readFileSync(packageJson, "utf8")).version;
  const { default: getExePath } = await import(
    pathToFileURL(join(dirname(packageJson), "lib", "getExePath.js")).href
  );
  const exe = getExePath(),
    engine = `Checked by the project’s TypeScript ${version} language server.`;
  const overlays = new Map(),
    documentVersions = new Map(),
    // Paths the last check covered; the server resolves case-insensitive
    // file systems to lowercase URIs, these map them back.
    known = new Map();
  let seq = 0,
    timer,
    started = false,
    closed = false,
    checking = false,
    again = false,
    pending = false,
    watcher;
  const uri = (path) => pathToFileURL(path).href;
  const text = (path) => {
    if (overlays.has(path)) return overlays.get(path);
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  };
  const server = connect(exe, ["--lsp", "--stdio"], root, (e) => {
    // Startup failures surface through the rejected requests instead.
    if (!started || closed) return;
    send({
      type: "failure",
      seq,
      message:
        `TypeScript ${version}’s language server stopped. ${e.message}`.slice(
          0,
          2000,
        ),
    });
    process.exit(1);
  });

  function listFiles() {
    return new Promise((done, reject) => {
      execFile(
        exe,
        ["-p", configFile, "--listFilesOnly", "--pretty", "false"],
        { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 60000 },
        (error, stdout) => {
          // Configuration errors exit non-zero but still list the files.
          if (error && typeof error.code !== "number") {
            reject(error);
            return;
          }
          const files = [],
            diagnostics = [];
          let blocking = false;
          for (const line of stdout.split(/\r?\n/)) {
            const d =
              /^(?:(.+)\((\d+),(\d+)\): )?(error|warning|message) TS(\d+): (.*)$/.exec(
                line,
              );
            if (d) {
              const file = d[1] && resolve(root, d[1]),
                severity = d[4] === "message" ? "info" : d[4];
              if (
                severity === "error" &&
                (d[5].startsWith("5") || file?.endsWith(".json"))
              )
                blocking = true;
              diagnostics.push({
                ...(file && local(file)
                  ? { path: pathName(file), line: +d[2], column: +d[3] }
                  : {}),
                severity,
                code: `TS${d[5]}`,
                message: d[6].slice(0, 8000),
              });
            } else if (/^\s/.test(line) && diagnostics.length) {
              const last = diagnostics.at(-1);
              last.message = `${last.message}\n${line.trim()}`.slice(0, 8000);
            } else if (isAbsolute(line.trim()))
              files.push(resolve(line.trim()));
          }
          done({ files, diagnostics, blocking });
        },
      );
    });
  }
  function convert(path, d) {
    const code = Number(d.code);
    return {
      path: pathName(path),
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      severity:
        (d.severity ?? 1) === 1 || (d.severity === 2 && unnecessary.has(code))
          ? "error"
          : d.severity === 2
            ? "warning"
            : "info",
      code: Number.isFinite(code) ? `TS${code}` : String(d.code).slice(0, 40),
      message: String(d.message).slice(0, 8000),
    };
  }
  function schedule() {
    if (closed) return;
    clearTimeout(timer);
    if (paused) {
      pending = true;
      return;
    }
    timer = setTimeout(check, 450);
  }
  async function check() {
    timer = undefined;
    if (closed) return;
    if (checking) {
      again = true;
      return;
    }
    checking = true;
    again = false;
    const at = seq;
    send({ type: "checking", seq: at });
    try {
      const list = await listFiles();
      const diagnostics = [...list.diagnostics],
        checked = list.blocking
          ? []
          : list.files.filter((p) => local(p) && checkedFile(p)),
        texts = new Map();
      known.clear();
      for (const path of list.files) known.set(path.toLowerCase(), path);
      await eachLimited(checked, 16, async (path) => {
        texts.set(path, text(path));
        const result = await server.request("textDocument/diagnostic", {
          textDocument: { uri: uri(path) },
        });
        for (const item of result?.items ?? [])
          diagnostics.push(convert(path, item));
      });
      if (closed || again) return;
      again = !report({
        seq: at,
        diagnostics,
        checked,
        pathName,
        current: (path) => texts.get(path),
        latest: text,
        configError: list.blocking,
        engine,
      });
    } catch (e) {
      if (!closed)
        send({
          type: "failure",
          seq: at,
          message: String(e?.message ?? e).slice(0, 2000),
        });
    } finally {
      checking = false;
      if (again && !closed) {
        again = false;
        send({ type: "invalidated", seq });
        schedule();
      }
    }
  }
  function changed(event, name) {
    if (closed || !name) return;
    const path = resolve(root, name),
      parts = name.split(/[\\/]/);
    if (parts.includes(".git")) return;
    const relevant =
      known.has(path.toLowerCase()) ||
      configName.test(basename(path)) ||
      (event === "rename" &&
        !parts.includes("node_modules") &&
        checkedFile(path));
    if (!relevant) return;
    const exists = existsSync(path);
    // The server watches files too; telling it directly avoids checking
    // before its own watcher has caught up.
    server.notify("workspace/didChangeWatchedFiles", {
      changes: [
        { uri: uri(path), type: !exists ? 3 : event === "rename" ? 1 : 2 },
      ],
    });
    if (checking) {
      again = true;
      return;
    }
    send({ type: "invalidated", seq });
    schedule();
  }
  function location(entry, cache) {
    const range = entry.targetSelectionRange ?? entry.range;
    let path = resolve(fileURLToPath(entry.targetUri ?? entry.uri));
    path = known.get(path.toLowerCase()) ?? path;
    if (!local(path)) return undefined;
    let cached = cache.get(path);
    if (!cached) {
      const content = text(path);
      if (content === undefined) return undefined;
      const lines = content.split("\n"),
        starts = [0];
      for (const line of lines) starts.push(starts.at(-1) + line.length + 1);
      cached = { content, lines, starts, hash: hash(content) };
      cache.set(path, cached);
    }
    const offset = ({ line, character }) =>
      Math.min(
        (cached.starts[line] ?? cached.content.length) + character,
        cached.content.length,
      );
    return {
      path: pathName(path),
      line: range.start.line + 1,
      column: range.start.character + 1,
      length: Math.max(0, offset(range.end) - offset(range.start)),
      preview:
        cached.lines[range.start.line]
          ?.replace(/\r$/, "")
          .trim()
          .slice(0, 300) ?? "",
      hash: cached.hash,
    };
  }
  function hoverText(hover) {
    const c = hover?.contents;
    const value =
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c
              .map((x) =>
                typeof x === "string" ? x : "```\n" + x.value + "\n```",
              )
              .join("\n\n")
          : (c?.value ?? "");
    const fence = /^\s*```[^\n]*\n([\s\S]*?)\n```\s*/.exec(value);
    return fence
      ? {
          display: fence[1],
          documentation: value.slice(fence[0].length).trim(),
        }
      : { display: "", documentation: value.trim() };
  }
  async function symbol(m) {
    try {
      const path = resolve(root, m.path),
        content = text(path);
      if (!local(path) || content === undefined || hash(content) !== m.hash)
        throw new Error(
          "The file changed. Wait for live checks to catch up, then retry.",
        );
      if (m.kind === "source") {
        sourceResult(m, content, seq);
        return;
      }
      if (m.line < 1 || m.line > content.split("\n").length)
        throw new Error("This line is no longer available.");
      const textDocument = { uri: uri(path) },
        position = { line: m.line - 1, character: m.column - 1 };
      const [hover, found] = await Promise.all([
        server.request("textDocument/hover", { textDocument, position }, 15000),
        m.kind === "definition"
          ? server.request(
              "textDocument/definition",
              { textDocument, position },
              15000,
            )
          : m.kind === "references"
            ? server.request(
                "textDocument/references",
                {
                  textDocument,
                  position,
                  context: { includeDeclaration: true },
                },
                15000,
              )
            : null,
      ]);
      const entries = found ? (Array.isArray(found) ? found : [found]) : [];
      const cache = new Map(),
        locations = new Map();
      let external = false,
        truncated = false;
      for (const entry of entries) {
        const value = location(entry, cache);
        if (!value) {
          external = true;
          continue;
        }
        const key = `${value.path}:${value.line}:${value.column}`;
        if (locations.has(key)) continue;
        if (locations.size >= 500) {
          truncated = true;
          break;
        }
        locations.set(key, value);
      }
      const { display, documentation } = hoverText(hover);
      send({
        type: "symbol",
        requestId: m.requestId,
        seq,
        result: {
          display: display.slice(0, 20000),
          documentation: documentation.slice(0, 50000),
          locations: [...locations.values()],
          truncated,
          external,
        },
      });
    } catch (e) {
      send({
        type: "symbol",
        requestId: m.requestId,
        seq,
        error: String(e?.message ?? e).slice(0, 1000),
      });
    }
  }
  function update(path, content) {
    const id = languageId(path);
    if (content === null) {
      overlays.delete(path);
      if (documentVersions.delete(path))
        server.notify("textDocument/didClose", {
          textDocument: { uri: uri(path) },
        });
      return;
    }
    overlays.set(path, content);
    if (!id) return;
    const next = (documentVersions.get(path) ?? 0) + 1;
    documentVersions.set(path, next);
    if (next === 1)
      server.notify("textDocument/didOpen", {
        textDocument: {
          uri: uri(path),
          languageId: id,
          version: next,
          text: content,
        },
      });
    else
      server.notify("textDocument/didChange", {
        textDocument: { uri: uri(path), version: next },
        contentChanges: [{ text: content }],
      });
  }

  try {
    const rootUri = uri(root);
    await server.request(
      "initialize",
      {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: basename(root) }],
        capabilities: {
          general: { positionEncodings: ["utf-16"] },
          textDocument: {
            diagnostic: {},
            hover: { contentFormat: ["markdown"] },
          },
          workspace: { configuration: true },
        },
      },
      30000,
    );
    server.notify("initialized", {});
    await listFiles();
    watcher = watch(root, { recursive: true }, changed);
    watcher.on("error", () => {});
  } catch (e) {
    server.close();
    watcher?.close();
    throw e;
  }
  started = true;
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const m = JSON.parse(line);
    if (typeof m.pause === "boolean") {
      paused = m.pause;
      if (paused && timer) {
        // A recheck was already queued; hold it until resume.
        clearTimeout(timer);
        timer = undefined;
        pending = true;
      } else if (!paused && pending) {
        pending = false;
        send({ type: "invalidated", seq });
        schedule();
      }
      return;
    }
    if (m.kind) {
      void symbol(m);
      return;
    }
    seq = m.seq;
    if (m.path) {
      const path = resolve(root, m.path);
      if (!local(path)) throw new Error("Invalid overlay path");
      update(path, m.text);
    }
    send({ type: "invalidated", seq });
    schedule();
  });
  input.on("close", () => {
    closed = true;
    clearTimeout(timer);
    watcher.close();
    server.close();
    process.exit(0);
  });
  if (paused) pending = true;
  else void check();
}
