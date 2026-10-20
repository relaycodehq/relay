const { basename, relative, isAbsolute, resolve, sep } = require("node:path");
const { fileURLToPath } = require("node:url");
const { constants } = require("node:fs");

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
      !allowed.some((root) => {
        const sub = relative(root, file);
        return (
          sub === "" ||
          (!isAbsolute(sub) && sub !== ".." && !sub.startsWith(`..${sep}`))
        );
      })
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
