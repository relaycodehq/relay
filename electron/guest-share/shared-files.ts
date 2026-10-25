import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  normalize,
  relative,
  sep,
} from "node:path";
import { isImagePath } from "../../shared/answer-images";
import { readTurn } from "../../shared/agent-trace";
import type { ChatMessage } from "../../shared/projects";
import { redacted } from "../../shared/redact-secrets";

export const MAX_SHARED_FILES = 20;
export const MAX_SHARED_BYTES = 15 * 1024 * 1024;

export interface SharedFile {
  id: string;
  /** As the guest reads it: relative to the thread's folder, or under another repository's name. */
  path: string;
  absolute: string;
  /** Where `absolute` leads once links are followed: the file that is read. */
  real: string;
  bytes: number;
  changed: boolean;
}

/** A place the thread's agents worked in; files outside every one stay private. */
interface Place {
  root: string;
  /** Prefix for paths under it on the guest page; empty for the thread's own folder. */
  label: string;
}

/**
 * The files a guest can read: those the agents changed, newest turn first,
 * then those they read, until 20 files or 15MB. Only text files inside the
 * thread's folder or another repository the agents edited count, and never
 * ones that usually hold keys, like `.env` or `id_rsa`.
 */
export async function sharedFiles(
  messages: ChatMessage[],
  root: string | null,
): Promise<SharedFile[]> {
  const places = workPlaces(messages, root);
  const realRoots = await Promise.all(
    places.map((p) => realpath(p.root).catch(() => undefined)),
  );
  const picked: SharedFile[] = [];
  const seen = new Set<string>();
  /** Files already picked, by where their paths lead. */
  const pickedReal = new Set<string>();
  let bytes = 0;
  for (const { absolute, changed } of candidates(messages, root)) {
    if (picked.length >= MAX_SHARED_FILES) break;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    const place = places.find((p) => inside(p.root, absolute));
    if (!place || mayHoldSecrets(absolute)) continue;
    // A link's own name and folder say nothing of the file it leads to.
    const real = await realpath(absolute).catch(() => undefined);
    if (!real || pickedReal.has(real) || mayHoldSecrets(real)) continue;
    if (!realRoots.some((r) => r && inside(r, real))) continue;
    pickedReal.add(real);
    const size = await textFileSize(real);
    if (size === undefined || bytes + size > MAX_SHARED_BYTES) continue;
    bytes += size;
    const path = relative(place.root, absolute).split(sep).join("/");
    picked.push({
      id: fileId(absolute),
      path: place.label ? `${place.label}/${path}` : path,
      absolute,
      real,
      bytes: size,
      changed,
    });
  }
  return picked;
}

/** A shared file's text as the guest reads it, with secrets redacted. */
export async function sharedFileText(file: SharedFile) {
  // The checked file, unless a link has been put in its way since.
  if ((await realpath(file.absolute)) !== file.real)
    throw new Error("The shared file moved.");
  // Read only as far as the limit: the file may have grown since it was picked.
  const handle = await open(file.real, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(size, MAX_SHARED_BYTES));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return redacted(head.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await handle.close();
  }
}

function* candidates(messages: ChatMessage[], root: string | null) {
  const newest = [...messages].reverse();
  for (const m of newest) {
    if (root)
      for (const c of m.changes ?? [])
        if (!c.revertedBy && !c.binary)
          yield { absolute: join(root, c.path), changed: true };
    for (const e of m.elsewhere ?? [])
      for (const p of e.paths)
        yield { absolute: join(e.root, p), changed: true };
  }
  for (const m of newest) {
    const turn = readTurn(m);
    const activities = [...turn.activity, ...[...turn.calls.values()].flat()];
    for (const a of activities) {
      if (a.kind !== "read" || a.status !== "complete" || isImagePath(a.label))
        continue;
      const path = a.label.trim();
      if (isAbsolute(path)) yield { absolute: normalize(path), changed: false };
      else if (root) yield { absolute: join(root, path), changed: false };
    }
  }
}

function workPlaces(messages: ChatMessage[], root: string | null): Place[] {
  const others = [
    ...new Set(messages.flatMap((m) => (m.elsewhere ?? []).map((e) => e.root))),
  ];
  return [
    ...(root ? [{ root, label: "" }] : []),
    ...others.map((other) => ({ root: other, label: basename(other) })),
  ];
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  const above = rel === ".." || rel.startsWith(`..${sep}`);
  return !!rel && !above && !isAbsolute(rel);
};

const SECRET_FOLDERS = new Set([
  ".git",
  ".ssh",
  ".aws",
  ".gnupg",
  ".docker",
  ".kube",
]);

const SECRET_NAMES =
  /^(\.env(?!\.(example|sample|template|dist)$)(\..+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials(\.\w+)?|secrets?(\.\w+)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?)$/i;
const SECRET_EXTENSIONS = /\.(pem|key|p12|pfx|keystore|jks|der|crt|cer|kdbx)$/i;

/** Files that usually hold keys or passwords, which redaction alone shouldn't be trusted with. */
export function mayHoldSecrets(path: string) {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1) ?? "";
  return (
    parts.some((part) => SECRET_FOLDERS.has(part)) ||
    SECRET_NAMES.test(name) ||
    SECRET_EXTENSIONS.test(name)
  );
}

/**
 * Whether a tool call's line names such a file: a read of `.env`, or a
 * command like `cat ~/.ssh/config`. Its output then stays off the guest page.
 */
export function touchesSecrets(label: string) {
  return label
    .split(/\s+/)
    .map((word) => word.replace(/^[<>|&;'"`(]+|[;,'"`)|&]+$/g, ""))
    .some((word) => word && mayHoldSecrets(word));
}

/** The size of a regular text file; undefined for anything else or anything gone. */
async function textFileSize(path: string) {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return undefined;
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return undefined;
  try {
    const head = Buffer.alloc(Math.min(8192, info.size));
    await handle.read(head, 0, head.length, 0);
    return head.includes(0) ? undefined : info.size;
  } finally {
    await handle.close();
  }
}

export const fileId = (absolute: string) =>
  createHash("sha256").update(absolute).digest("base64url").slice(0, 16);
