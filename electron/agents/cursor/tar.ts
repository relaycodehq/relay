/** A regular file of an npm tarball, with its path inside the package. */
export interface TarFile {
  path: string;
  data: Buffer;
  /** Executable or not, the way npm installs it. */
  mode: number;
}

const block = 512;

const text = (header: Buffer, from: number, to: number) => {
  const field = header.subarray(from, to);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
};

function octal(header: Buffer, from: number, to: number) {
  // A leading high bit means base-256, for sizes no package has.
  if (header[from] & 0x80) throw new Error("The download has a file too big.");
  const value = parseInt(text(header, from, to).trim() || "0", 8);
  if (!Number.isFinite(value)) throw new Error("The download isn't a package.");
  return value;
}

/** `26 path=package/a.js\n` records, where the number counts the whole record. */
function pax(data: Buffer) {
  const fields: Record<string, string> = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const length = Number(data.subarray(at, space).toString());
    if (space < 0 || !(length > 0)) break;
    const [key, ...value] = data
      .subarray(space + 1, at + length - 1)
      .toString("utf8")
      .split("=");
    fields[key] = value.join("=");
    at += length;
  }
  return fields;
}

/** Drops npm's `package/` folder, and refuses any path that leaves the package. */
function inside(name: string) {
  const parts = name.split("/").slice(1);
  if (parts.some((p) => p === ".." || /[\\:\0]/.test(p)))
    throw new Error(`The download has an unsafe path: ${name}`);
  const path = parts.filter((p) => p && p !== ".").join("/");
  if (!path) throw new Error(`The download has an odd path: ${name}`);
  return path;
}

/**
 * The files of an uncompressed npm tarball. Only regular files and folders
 * are allowed: a link could point anywhere once installed.
 */
export function* tarFiles(tar: Buffer): Generator<TarFile> {
  let at = 0;
  let next: { path?: string } = {};
  while (at + block <= tar.length) {
    const header = tar.subarray(at, at + block);
    if (header.every((byte) => byte === 0)) return;
    const size = octal(header, 124, 136);
    const kind = String.fromCharCode(header[156] || 0x30);
    const prefix = text(header, 345, 500);
    const start = at + block;
    const data = tar.subarray(start, start + size);
    if (data.length < size) throw new Error("The download was cut short.");
    at = start + Math.ceil(size / block) * block;

    if (kind === "x") next = pax(data);
    else if (kind === "g") continue;
    else if (kind === "L") next = { path: text(data, 0, data.length) };
    else if (kind === "5") next = {};
    else if (kind === "0") {
      const name =
        next.path ?? (prefix ? `${prefix}/` : "") + text(header, 0, 100);
      next = {};
      yield {
        path: inside(name),
        data: Buffer.from(data),
        mode: octal(header, 100, 108) & 0o111 ? 0o755 : 0o644,
      };
    } else
      throw new Error(
        `The download has a link or device, which isn't allowed.`,
      );
  }
}
