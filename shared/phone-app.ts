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
