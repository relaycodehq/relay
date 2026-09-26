const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
// The protocol and crypto the desktop uses too; see ../shared/remote*.ts.
const shared = path.resolve(projectRoot, "../shared");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), shared];
const resolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Packages imported from ../shared come from the app's node_modules, never the desktop's.
  const bare = !moduleName.startsWith(".") && !path.isAbsolute(moduleName);
  const from =
    bare && context.originModulePath.startsWith(shared + path.sep)
      ? { ...context, originModulePath: path.join(projectRoot, "index.ts") }
      : context;
  return (resolve ?? context.resolveRequest)(from, moduleName, platform);
};

module.exports = config;
