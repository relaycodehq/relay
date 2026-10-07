import { z } from "zod";

/** Public feed written by the release workflow. */
export const releasesRepo = "relaycodehq/relay-releases";
export const updateFeed = `https://github.com/${releasesRepo}/releases/latest/download/latest.json`;
export const releasesPage = `https://github.com/${releasesRepo}/releases/latest`;
/**
 * Ed25519 public keys (raw 32 bytes, base64) Relay accepts for latest.json.sig,
 * the release build's signature over latest.json's exact bytes. More than one
 * so a new key can ship here before the build switches to signing with it.
 * scripts/sign-update-feed.mjs reads this list too; keep it a plain array of
 * string literals.
 */
export const updateKeys: readonly string[] = [
  "83EmHV/Q5V1spYrUP+1S8Kuke5rUt2gAPVQJ1r45YL4=",
];
/** The phone app, built with every release; the unversioned name always points at the newest. */
export const androidAppDownload = `https://github.com/${releasesRepo}/releases/latest/download/Relay-Android.apk`;

/** How the running copy was installed decides which download replaces it. */
export type UpdateTarget =
  | "mac-arm64"
  | "mac-x64"
  | "win-x64"
  | "linux-x64-appimage"
  | "linux-x64-omarchy";

const file = z.object({
  name: z.string().regex(/^[\w.-]+$/),
  // Plain HTTP only for a feed served on this machine while testing.
  url: z.url({ protocol: /^https?$/ }).refine((u) => {
    const { protocol, hostname } = new URL(u);
    return protocol === "https:" || hostname === "127.0.0.1";
  }),
  sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  size: z.number().int().positive(),
});
export const manifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  published: z.string().optional(),
  notes: z.string().max(4000).optional(),
  files: z.partialRecord(
    z.enum([
      "mac-arm64",
      "mac-x64",
      "win-x64",
      "linux-x64-appimage",
      "linux-x64-omarchy",
    ]),
    file,
  ),
});
export type UpdateManifest = z.infer<typeof manifestSchema>;
export type UpdateFile = z.infer<typeof file>;

export type UpdateState =
  /** Development builds and platforms without a download never show the button. */
  | { status: "off"; current: string }
  | { status: "idle"; current: string; checkedAt?: number }
  | { status: "checking"; current: string }
  | {
      status: "available";
      current: string;
      version: string;
      notes?: string;
      /** manual: this copy can't replace itself, so the button opens the download page. */
      install: "auto" | "manual";
      reason?: string;
    }
  | {
      status: "downloading";
      current: string;
      version: string;
      progress: number;
    }
  | { status: "ready"; current: string; version: string }
  /** Restart asked for, held until Claude's background work finishes. */
  | { status: "waiting"; current: string; version: string; tasks: number }
  | { status: "installing"; current: string; version: string }
  | { status: "error"; current: string; version?: string; message: string };

/** Every release's notes, newest first, for the changelog in About. */
export const releasesApi = `https://api.github.com/repos/${releasesRepo}/releases?per_page=100`;

export interface ReleaseNote {
  version: string;
  published: string;
  notes: string;
}

const githubRelease = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  published_at: z.string().nullable(),
  body: z.string().nullable(),
});

/** Published vX.Y.Z releases from GitHub's list, newest version first; CI logs and drafts drop out. */
export function releaseNotesFrom(data: unknown): ReleaseNote[] {
  return z
    .array(githubRelease)
    .parse(data)
    .flatMap((release) => {
      const version = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
      if (!version || release.draft || !release.published_at) return [];
      const notes = (release.body ?? "").trim();
      return [{ version, published: release.published_at, notes }];
    })
    .sort((a, b) =>
      newerVersion(a.version, b.version)
        ? -1
        : newerVersion(b.version, a.version)
          ? 1
          : 0,
    );
}

/** Numeric x.y.z comparison; release versions never carry prerelease tags. */
export function newerVersion(candidate: string, current: string) {
  const a = candidate.split(".").map(Number),
    b = current.split(/[.+-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0,
      y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
