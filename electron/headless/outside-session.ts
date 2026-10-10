import { execFile } from "node:child_process";
import { join } from "node:path";

/**
 * Windows' OpenSSH server puts everything a session starts in a job that
 * ends with the connection, detached or not, so a Relay started over `ssh`
 * died as the user logged out. WMI creates processes outside that job.
 */
export const inSshSession = (env: NodeJS.ProcessEnv = process.env) =>
  process.platform === "win32" && !!(env.SSH_CONNECTION || env.SSH_CLIENT);

// Read as base64: PowerShell 5.1 decodes stdin with the console's code page.
const create = `
$in = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())) | ConvertFrom-Json
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; EnvironmentVariables = [string[]]$in.env }
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $in.command; CurrentDirectory = $in.cwd; ProcessStartupInformation = $startup }
if ($r.ReturnValue -ne 0) { [Console]::Error.WriteLine("Win32_Process.Create returned $($r.ReturnValue)"); exit 1 }
$r.ProcessId
`;

/**
 * Starts a Windows command line outside this SSH session, with `env` as its
 * whole environment less the session's SSH variables; resolves to its pid.
 */
export function startOutsideSession(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const variables = Object.entries(env)
    .filter(
      ([k, v]) =>
        v !== undefined && k && !k.startsWith("=") && !/^SSH_/i.test(k),
    )
    .map(([k, v]) => `${k}=${v}`);
  const powershell = join(
    env.SystemRoot ?? "C:\\Windows",
    "System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  return new Promise<number>((done, failed) => {
    const child = execFile(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        create,
      ],
      { windowsHide: true, timeout: 60_000 },
      (error, stdout, stderr) => {
        const pid = Number(stdout.trim());
        if (error || !Number.isInteger(pid) || pid <= 0)
          return failed(
            new Error(
              `Couldn't start Relay outside this SSH session: ${stderr.trim() || error?.message || stdout.trim()}`,
            ),
          );
        done(pid);
      },
    );
    child.stdin!.end(
      Buffer.from(JSON.stringify({ command, cwd, env: variables })).toString(
        "base64",
      ),
    );
  });
}
