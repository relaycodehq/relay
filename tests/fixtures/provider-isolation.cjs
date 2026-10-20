const { basename, relative, isAbsolute, resolve, sep } = require("node:path");
const { fileURLToPath } = require("node:url");
const { constants } = require("node:fs");
const { join } = require("node:path");
const { promisify } = require("node:util");

const within = (file, roots) =>
  roots.some((root) => {
    const sub = relative(root, resolve(file));
    return (
      sub === "" ||
      (!isAbsolute(sub) && sub !== ".." && !sub.startsWith(`..${sep}`))
    );
  });

/**
 * Executable discovery also looks outside PATH (mise, ~/.local/bin, and so on).
 * Hide only provider command candidates outside this test's fixture folders,
 * before Relay can run their version probes. Repository/config access and
 * ordinary tools such as git keep their real filesystem behavior.
 */
module.exports = function isolateProviderExecutables(
  roots,
  commands,
  platform = process.platform,
) {
  const fs = require("node:fs/promises");
  const access = fs.access;
  const allowed = roots.map((root) => resolve(root));
  const names = new Set(commands.map((name) => name.toLowerCase()));
  fs.access = async (path, mode) => {
    const file = resolve(
      path instanceof URL ? fileURLToPath(path) : String(path),
    );
    const name = basename(file)
      .replace(/\.(?:exe|cmd|bat|cjs|mjs|js)$/i, "")
      .toLowerCase();
    if (
      (mode === constants.X_OK ||
        (platform === "win32" &&
          mode === constants.F_OK &&
          /\.(?:exe|cmd|bat)$/i.test(file))) &&
      names.has(name) &&
      !within(file, allowed)
    )
      throw Object.assign(new Error(`No test provider executable: ${file}`), {
        code: "ENOENT",
      });
    return access(path, mode);
  };
  require("node:module").syncBuiltinESMExports();
  return () => {
    fs.access = access;
    require("node:module").syncBuiltinESMExports();
  };
};

/** Personal skill/config paths that do not have provider-specific env overrides. */
module.exports.isolateProviderHome = function (data, roots) {
  const fs = require("node:fs");
  let state;
  try {
    state = JSON.parse(fs.readFileSync(join(data, "state.json"), "utf8"));
  } catch {
    /* Missing or corrupt sample state is handled by Relay itself. */
  }
  for (const file of Object.values(state?.agentPaths ?? {}))
    if (typeof file === "string" && !within(file, roots))
      throw new Error(
        `Linked test providers must live in fixture folders: ${file}`,
      );
  const home = join(data, "home");
  fs.mkdirSync(home, { recursive: true });
  const os = require("node:os");
  const original = os.homedir;
  os.homedir = () => home;
  require("node:module").syncBuiltinESMExports();
  return () => {
    os.homedir = original;
    require("node:module").syncBuiltinESMExports();
  };
};

/** Provider Keychain access is separate from Electron's encrypted storage. */
module.exports.isolateProviderKeychain = function (
  native,
  childProcess = require("node:child_process"),
) {
  if (native) return () => {};
  const execFile = childProcess.execFile;
  const blocked = (file, args) => {
    if (basename(String(file)) !== "security" || !Array.isArray(args))
      return false;
    const service = args[args.indexOf("-s") + 1];
    return (
      [
        "find-generic-password",
        "add-generic-password",
        "delete-generic-password",
      ].includes(args[0]) &&
      (service === "Codex Auth" ||
        /^Claude Code-credentials(?:-[a-f0-9]+)?$/.test(service ?? ""))
    );
  };
  const refusal = () =>
    Object.assign(new Error("No provider Keychain credentials in this test"), {
      code: 44,
    });
  childProcess.execFile = function (file, args, ...rest) {
    if (!blocked(file, args)) return execFile.call(this, file, args, ...rest);
    const done = rest.find((value) => typeof value === "function");
    setImmediate(() => done?.(refusal(), "", ""));
  };
  childProcess.execFile[promisify.custom] = (file, args, ...rest) =>
    blocked(file, args)
      ? Promise.reject(refusal())
      : execFile[promisify.custom](file, args, ...rest);
  require("node:module").syncBuiltinESMExports();
  return () => {
    childProcess.execFile = execFile;
    require("node:module").syncBuiltinESMExports();
  };
};
