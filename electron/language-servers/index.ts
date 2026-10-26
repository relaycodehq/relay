import { excludeLocally } from "../git/local-exclude";
import { ServerInstaller } from "./install";
import {
  findNpm,
  resolvePlatform,
  probe,
  runProgram,
  spawnServer,
} from "./platform";
import type { RelayEvents } from "../../shared/events";
import { resolveServer } from "./resolve";
import { LanguageServers, type LanguageServersDeps } from "./service";

export { LanguageServers } from "./service";

type LspEvents = Pick<
  RelayEvents,
  "relay:lsp-status" | "relay:lsp-diagnostics" | "relay:lsp-inactive-lines"
>;

/** A channel and what it carries. */
type LspEvent = {
  [C in keyof LspEvents]: [channel: C, event: LspEvents[C]];
}[keyof LspEvents];

export interface LanguageServersOptions extends Pick<
  LanguageServersDeps,
  "root" | "version" | "log"
> {
  /** Pushes what the servers report to the windows. */
  send(...event: LspEvent): void;
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
    status: (event) => options.send("relay:lsp-status", event),
    diagnostics: (event) => options.send("relay:lsp-diagnostics", event),
    inactiveLines: (event) => options.send("relay:lsp-inactive-lines", event),
    version: options.version,
    log: options.log,
    excludeLocally,
    resolve: (spec, hooks) =>
      resolveServer(spec, { ...resolvePlatform, installer }, hooks),
    spawn: (launch, cwd) =>
      spawnServer(launch.command, launch.args, cwd, launch.env),
  });
}
