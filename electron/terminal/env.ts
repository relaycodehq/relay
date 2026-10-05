/**
 * Relay's own environment minus what only concerns Relay: started through
 * `npm run`, it carries npm's settings (nvm refuses to load with them) and
 * RELAY_DEV_URL, which would point a Relay run from the terminal at this
 * window's renderer.
 */
export function inheritedEnv() {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (
      value !== undefined &&
      !/^(npm_|RELAY_|ELECTRON_)/i.test(name) &&
      name !== "INIT_CWD"
    )
      env[name] = value;
  return env;
}

/** The user's shell; a login one reads the profile that sets PATH, which apps started from the Dock lack. */
export function userShell(): [string, string[]] {
  if (process.platform === "win32") return ["powershell.exe", ["-NoLogo"]];
  const fallback = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  return [process.env.SHELL || fallback, ["-l"]];
}
