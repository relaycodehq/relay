// This disposable process owns TypeScript's project service and Angular's official plugin.
// It never emits files or runs build/package scripts. Open buffers stay in memory.
// TypeScript 7 has no JavaScript server API; its projects go to worker-lsp.mjs.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import {
  checkedFile,
  hash,
  projectPaths,
  report,
  send,
  sourceResult,
} from "./worker-shared.mjs";
import { startLanguageServer } from "./worker-lsp.mjs";
const root = process.argv[2],
  target = JSON.parse(process.argv[3]),
  configFile = resolve(root, target.config),
  // Relay's own TypeScript 5.9 for projects whose compiler has no server API.
  fallbackTypeScript = process.argv[5] || undefined;
const req = createRequire(configFile),
  { local, pathName } = projectPaths(root);
const configurationWatches = new Map(),
  overlays = new Map();
let seq = 0,
  timer,
  service,
  project,
  ts,
  ng,
  closed = false,
  checking = false,
  // While paused (an agent is editing, or the window is hidden) changes only
  // mark the results stale; one check runs on resume.
  paused = process.argv[4] === "paused",
  pending = false,
  configurationReads,
  configurationKey,
  engine;
function read(path) {
  path = resolve(path);
  configurationReads?.add(path);
  let text;
  try {
    text = overlays.has(path) ? overlays.get(path) : readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  return text;
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
function changed() {
  if (closed || checking) return;
  send({ type: "invalidated", seq });
  schedule();
}
function snapshot(path) {
  const info = service.getScriptInfo(path);
  const snap = info?.getSnapshot();
  return snap ? snap.getText(0, snap.getLength()) : read(path);
}
function configure() {
  let config;
  const paths = new Set([configFile]);
  configurationReads = paths;
  try {
    if (ng) config = ng.readConfiguration(configFile);
    else {
      const source = ts.readConfigFile(configFile, read);
      const parsed = ts.parseJsonConfigFileContent(
        source.config ?? {},
        { ...ts.sys, readFile: read },
        dirname(configFile),
        undefined,
        configFile,
      );
      config = {
        ...parsed,
        rootNames: parsed.fileNames,
        errors: [...(source.error ? [source.error] : []), ...parsed.errors],
      };
    }
  } finally {
    configurationReads = undefined;
    // External projects receive parsed options, so ProjectService does not watch
    // their tsconfig or its extends chain. Keep those options live ourselves.
    for (const [path, watcher] of configurationWatches)
      if (!paths.has(path)) {
        watcher.close();
        configurationWatches.delete(path);
      }
    for (const path of paths)
      if (!configurationWatches.has(path))
        configurationWatches.set(
          path,
          ts.sys.watchFile(path, changed, 250, {
            watchFile: ts.WatchFileKind.UseFsEvents,
          }),
        );
  }
  if (!config.errors.length) {
    const key = JSON.stringify({
      rootNames: config.rootNames,
      options: config.options,
    });
    if (configurationKey !== key) {
      if (project) service.closeExternalProject(configFile);
      service.openExternalProject({
        projectFileName: configFile,
        rootFiles: config.rootNames.map((fileName) => ({ fileName })),
        options: {
          ...config.options,
          configFilePath: configFile,
          noEmit: true,
        },
        typeAcquisition: { enable: false },
      });
      configurationKey = key;
    }
    project = service.externalProjects.find(
      (p) => p.getProjectName() === configFile,
    );
    if (!project)
      throw new Error(
        "The language service could not load this configuration.",
      );
    project.updateGraph();
  }
  return config.errors;
}
function serializeDiagnostic(d) {
  const file = d.file && resolve(d.file.fileName),
    path = file && local(file) ? pathName(file) : undefined;
  const start =
    d.file && d.start != null
      ? d.file.getLineAndCharacterOfPosition(d.start)
      : undefined;
  const end = start
    ? d.file.getLineAndCharacterOfPosition(
        Math.min(d.file.text.length, d.start + (d.length ?? 1)),
      )
    : undefined;
  return {
    ...(path ? { path } : {}),
    ...(start
      ? {
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
        }
      : {}),
    severity:
      d.category === 1 ? "error" : d.category === 0 ? "warning" : "info",
    code: d.code < 0 ? `NG${Math.abs(d.code) - 990000}` : `TS${d.code}`,
    message: ts
      .flattenDiagnosticMessageText(d.messageText, "\n")
      .slice(0, 8000),
  };
}
function check() {
  if (closed) return;
  timer = undefined;
  checking = true;
  send({ type: "checking", seq });
  try {
    const raw = [...configure()],
      configError = raw.length > 0;
    const checked = new Set();
    if (!configError) {
      const ls = project.getLanguageService();
      raw.push(...ls.getCompilerOptionsDiagnostics());
      // Angular's TS plugin includes external/inline template diagnostics for each component.
      for (const path of project.getFileNames(true, true)) {
        if (!local(path) || !checkedFile(path)) continue;
        checked.add(resolve(path));
        raw.push(
          ...ls.getSyntacticDiagnostics(path),
          ...ls.getSemanticDiagnostics(path),
          ...ls.getSuggestionDiagnostics(path),
        );
      }
      // The Angular plugin filters external-template diagnostics out of TS-file results.
      // Query each template explicitly after component analysis has registered its resources.
      if (ng)
        for (const path of project.getFileNames(true, true)) {
          if (local(path) && path.endsWith(".html")) {
            checked.add(resolve(path));
            raw.push(
              ...ls.getSemanticDiagnostics(path),
              ...ls.getSuggestionDiagnostics(path),
            );
          }
        }
    }
    const sent = report({
      seq,
      diagnostics: raw.map(serializeDiagnostic),
      checked,
      pathName,
      current: snapshot,
      latest: read,
      configError,
      engine,
    });
    if (!sent) schedule();
  } catch (e) {
    send({
      type: "failure",
      seq,
      message: String(e?.message ?? e).slice(0, 2000),
    });
  } finally {
    checking = false;
  }
}
function location(entry, cache) {
  const path = resolve(entry.fileName);
  if (!local(path)) return undefined;
  let cached = cache.get(path);
  if (!cached) {
    const text = snapshot(path);
    if (text === undefined) return undefined;
    cached = {
      text,
      source: ts.createSourceFile(path, text, ts.ScriptTarget.Latest),
      lines: text.split(/\r?\n/),
      hash: hash(text),
    };
    cache.set(path, cached);
  }
  const pos = cached.source.getLineAndCharacterOfPosition(
    Math.min(entry.textSpan.start, cached.text.length),
  );
  return {
    path: pathName(path),
    line: pos.line + 1,
    column: pos.character + 1,
    length: entry.textSpan.length,
    preview: cached.lines[pos.line]?.trim().slice(0, 300) ?? "",
    hash: cached.hash,
  };
}
function symbol(m) {
  try {
    const path = resolve(root, m.path),
      text = snapshot(path);
    if (!local(path) || text === undefined || hash(text) !== m.hash)
      throw new Error(
        "The file changed. Wait for live checks to catch up, then retry.",
      );
    if (m.kind === "source") {
      sourceResult(m, text, seq);
      return;
    }
    // Keep HTML in the selected Angular project; do not create another inferred project.
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest),
      starts = source.getLineStarts();
    if (m.line < 1 || m.line > starts.length)
      throw new Error("This line is no longer available.");
    const position = Math.min(starts[m.line - 1] + m.column - 1, text.length),
      ls = project.getLanguageService();
    const quick = ls.getQuickInfoAtPosition(path, position);
    const entries =
      m.kind === "definition"
        ? ls.getDefinitionAtPosition(path, position)
        : m.kind === "references"
          ? ls.getReferencesAtPosition(path, position)
          : [];
    const cache = new Map(),
      locations = new Map();
    let external = false,
      truncated = false;
    for (const entry of entries ?? []) {
      if (!local(resolve(entry.fileName))) {
        external = true;
        continue;
      }
      const key = `${entry.fileName}:${entry.textSpan.start}`;
      if (locations.has(key)) continue;
      if (locations.size >= 500) {
        truncated = true;
        break;
      }
      const value = location(entry, cache);
      if (value) locations.set(key, value);
    }
    send({
      type: "symbol",
      requestId: m.requestId,
      seq,
      result: {
        display: ts
          .displayPartsToString(quick?.displayParts ?? [])
          .slice(0, 20000),
        documentation: ts
          .displayPartsToString(quick?.documentation ?? [])
          .slice(0, 50000),
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
function loadTypeScript(fallbackReason) {
  const project = req("typescript");
  if (project.server?.ProjectService && !fallbackReason) {
    engine = `Checked by the project’s TypeScript ${project.version}.`;
    return project;
  }
  const reason =
    fallbackReason ??
    `TypeScript ${project.version ?? "unknown"} has no language service API`;
  if (!fallbackTypeScript || target.provider === "angular")
    throw new Error(
      `${reason}. Use a project with a compatible TypeScript language service (tested with 5.9).`,
    );
  const bundled = createRequire(fallbackTypeScript)(fallbackTypeScript);
  engine = `Checked by Relay’s bundled TypeScript ${bundled.version} because ${reason}. Results can differ slightly from the project’s compiler.`;
  return bundled;
}
async function startProjectService(fallbackReason) {
  ts = loadTypeScript(fallbackReason);
  let angularPlugin;
  if (target.provider === "angular") {
    ng = await import(pathToFileURL(req.resolve("@angular/compiler-cli")).href);
    const fs = new ng.NodeJSFileSystem();
    fs.readFile = (path) => {
      const text = read(path);
      if (text === undefined) throw new Error(`Cannot read ${path}`);
      return text;
    };
    ng.setFileSystem(fs);
    try {
      angularPlugin = req("@angular/language-service");
    } catch {
      angularPlugin = createRequire(req.resolve("@angular/language-server"))(
        "@angular/language-service",
      );
    }
  }
  const logger = {
    close() {},
    hasLevel() {
      return false;
    },
    loggingEnabled() {
      return false;
    },
    perftrc() {},
    info() {},
    msg() {},
    startGroup() {},
    endGroup() {},
    getLogFileName() {
      return undefined;
    },
  };
  const host = {
    ...ts.sys,
    readFile: read,
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate,
    writeFile() {
      throw new Error("Live checks cannot emit files.");
    },
    require: (_path, name) => {
      try {
        if (name !== "@angular/language-service" || !angularPlugin)
          throw new Error("Unsupported language plugin");
        return { module: angularPlugin };
      } catch (error) {
        return { error };
      }
    },
    watchFile: (path, callback, ...args) =>
      ts.sys.watchFile(
        path,
        (...event) => {
          callback(...event);
          changed();
        },
        ...args,
      ),
    watchDirectory: (path, callback, ...args) =>
      ts.sys.watchDirectory(
        path,
        (...event) => {
          callback(...event);
          changed();
        },
        ...args,
      ),
  };
  service = new ts.server.ProjectService({
    host,
    logger,
    cancellationToken: ts.server.nullCancellationToken,
    useSingleInferredProject: true,
    useInferredProjectPerProjectRoot: true,
    typingsInstaller: ts.server.nullTypingsInstaller,
    suppressDiagnosticEvents: true,
    globalPlugins: angularPlugin ? ["@angular/language-service"] : [],
    pluginProbeLocations: [root],
    allowLocalPluginLoads: false,
    session: undefined,
  });
  service.setHostConfiguration({
    extraFileExtensions: [
      {
        extension: ".html",
        isMixedContent: false,
        scriptKind: ts.ScriptKind.Unknown,
      },
    ],
    preferences: { includePackageJsonAutoImports: "off" },
    watchOptions: {
      watchFile: ts.WatchFileKind.UseFsEvents,
      watchDirectory: ts.WatchDirectoryKind.UseFsEvents,
    },
  });
  if (angularPlugin)
    service.configurePlugin({
      pluginName: "@angular/language-service",
      configuration: { angularOnly: false },
    });
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
      symbol(m);
      return;
    }
    seq = m.seq;
    if (m.path) {
      const path = resolve(root, m.path);
      if (!local(path)) throw new Error("Invalid overlay path");
      if (m.text === null) {
        overlays.delete(path);
        service.closeClientFile(path);
      } else {
        overlays.set(path, m.text);
        const info = service.getScriptInfo(path);
        if (info?.isScriptOpen())
          info.editContent(0, info.getSnapshot().getLength(), m.text);
        else
          service.openClientFile(
            path,
            m.text,
            path.endsWith(".html") ? ts.ScriptKind.Unknown : undefined,
            root,
          );
      }
    }
    send({ type: "invalidated", seq });
    schedule();
  });
  input.on("close", () => {
    closed = true;
    clearTimeout(timer);
    for (const watcher of configurationWatches.values()) watcher.close();
    process.exit(0);
  });
  if (paused) pending = true;
  else check();
}
try {
  const packageJson = req.resolve("typescript/package.json"),
    version = JSON.parse(readFileSync(packageJson, "utf8")).version;
  if (target.provider === "typescript" && parseInt(version) >= 7) {
    try {
      await startLanguageServer({ root, configFile, packageJson, paused });
    } catch (e) {
      await startProjectService(
        `TypeScript ${version}’s language server did not start (${String(e?.message ?? e).slice(0, 500)})`,
      );
    }
  } else await startProjectService();
} catch (e) {
  const missing = e?.code === "MODULE_NOT_FOUND";
  send({
    type: "failure",
    seq,
    message: `Could not start ${target.provider === "angular" ? "Angular" : "TypeScript"} language support.${missing ? ` Install the project’s dependencies${target.provider === "angular" ? " and a matching @angular/language-service (or @angular/language-server)" : ""}.` : ""} ${String(e?.message ?? e).slice(0, 1000)}`,
  });
  process.exit(1);
}
