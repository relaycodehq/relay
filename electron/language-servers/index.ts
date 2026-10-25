import { ServerInstaller } from "./install";
import {
  findNpm,
  resolvePlatform,
  probe,
  runProgram,
  spawnServer,
} from "./platform";
import { resolveServer } from "./resolve";
import { LanguageServers, type LanguageServersDeps } from "./service";

export { LanguageServers } from "./service";

export interface LanguageServersOptions extends Pick<
  LanguageServersDeps,
  "root" | "status" | "diagnostics" | "version" | "log"
> {
  /** `<userData>/language-servers`: where downloaded servers live. */
  dir: string;
  fetch: typeof fetch;
}

/** Language servers as the app runs them: found on PATH, else fetched into `dir`. */
export function createLanguageServers(options: LanguageServersOptions) {
  const installer = new ServerInstaller({
    dir: options.dir,
    fetch: options.fetch,
    platform: process.platform,
    arch: process.arch,
    npm: findNpm,
    run: runProgram,
    probe,
  });
  return new LanguageServers({
    root: options.root,
    status: options.status,
    diagnostics: options.diagnostics,
    version: options.version,
    log: options.log,
    resolve: (spec, hooks) =>
      resolveServer(spec, { ...resolvePlatform, installer }, hooks),
    spawn: (launch, cwd) =>
      spawnServer(launch.command, launch.args, cwd, launch.env),
  });
}
