import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { procListening } from "./process-lookups";

let proc: string;

afterEach(() => rm(proc, { recursive: true, force: true }));

const header =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";

it("reads the ports a process listens on from /proc, where lsof often isn't installed", async () => {
  proc = await mkdtemp(join(tmpdir(), "relay-proc-"));
  await mkdir(join(proc, "net"));
  await mkdir(join(proc, "41", "fd"), { recursive: true });
  await mkdir(join(proc, "42", "fd"), { recursive: true });
  await symlink("socket:[9001]", join(proc, "41", "fd", "3"));
  await symlink("socket:[9002]", join(proc, "41", "fd", "4"));
  await symlink("/dev/null", join(proc, "41", "fd", "0"));
  await symlink("socket:[9003]", join(proc, "42", "fd", "5"));
  await writeFile(
    join(proc, "net", "tcp"),
    header +
      // 0.0.0.0:5173, listening (0A)
      "   0: 00000000:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 9001 1 0 100 0 0 10 0\n" +
      // A connection out of the same process, not listening (01)
      "   1: 0100007F:C350 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 9002 1 0 20 4 30 10 -1\n",
  );
  await writeFile(
    join(proc, "net", "tcp6"),
    header +
      // [::]:3000, listening
      "   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 9003 1 0 100 0 0 10 0\n",
  );
  const ports = await procListening([41, 42, 43], proc);
  expect(Object.fromEntries(ports)).toEqual({ 41: [5173], 42: [3000] });
});
