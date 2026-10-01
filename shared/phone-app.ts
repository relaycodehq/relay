/** What a phone's app runs, as it tells its desktop on connecting and as an update moves on. */
export interface PhoneAppReport {
  /** The version whose code runs. */
  version: string;
  /** That code came from a desktop rather than with the APK. */
  updated: boolean;
  /** The version the APK was installed with. */
  apk: string;
  /** False in development builds, which never fetch a desktop's code. */
  updates: boolean;
  /** Where fetching the desktop's version stands, once one is under way. */
  update?: { kind: "downloading" | "ready" | "apk"; version: string };
  /** A version that never reached its first screen; the phone won't fetch it again. */
  failed?: string;
}

/** a > b, for x.y.z versions. */
export const newerVersion = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

/** Where a phone's app stands against `offered`, the version its desktop hands out. */
export function phoneAppStatus(app: PhoneAppReport, offered?: string): string {
  const { update } = app;
  if (update?.kind === "downloading") return `Downloading ${update.version}`;
  if (update?.kind === "ready")
    return `${update.version} downloaded, runs once the app restarts`;
  if (update?.kind === "apk")
    return `${update.version} needs a new APK; the phone offers to install it`;
  if (!offered) return "This Relay has no phone update to hand out";
  if (app.version === offered) return "Up to date";
  if (newerVersion(app.version, offered))
    return `Newer than the ${offered} this Relay hands out`;
  if (!app.updates) return `A development build; it won't fetch ${offered}`;
  if (app.failed === offered)
    return `${offered} didn't start, so it stays on ${app.version}`;
  return `${offered} not fetched yet`;
}
