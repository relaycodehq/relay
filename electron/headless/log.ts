import { dirname, join } from "node:path";
import { fileLog } from "../util/file-log";

/**
 * Sends everything Relay says about itself to `file`, timestamped; past
 * 5 MB the file moves to `relay.old.log` and starts over. `echo` also keeps
 * it on the terminal, for `relay run` in the foreground.
 */
export function logTo(file: string, { echo }: { echo: boolean }) {
  fileLog(file, {
    previous: join(dirname(file), "relay.old.log"),
    limit: 5 << 20,
    echo,
    privateFiles: true,
    levels: ["log", "info", "warn", "error"],
  });
}
