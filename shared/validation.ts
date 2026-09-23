import { z } from "zod";
export const name = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (v) => !/[\/\\\x00-\x1f]/.test(v) && v !== "." && v !== "..",
    "Invalid repository name",
  );
export const repoSchema = z.object({ owner: name, name });
export const refSchema = repoSchema.extend({
  number: z.number().int().positive(),
});
export const filePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (v) =>
      !v.startsWith("/") &&
      !v.includes("\0") &&
      !v.split("/").some((s) => s === ".." || s === "."),
    "Invalid file path",
  );
export const shaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
/** A SHA-256 of file contents, as `digest` makes for versions and checks. */
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** File text small enough to edit, check or sync (2 MiB). */
export const textSchema = z.string().max(2 * 1024 * 1024);
export const blameQuerySchema = z
  .object({
    revision: shaSchema,
    path: filePathSchema,
    line: z.number().int().min(1).max(2000000),
  })
  .strict();
export const workspaceSchema = z.object({
  pull: refSchema.nullable(),
  file: filePathSchema.nullable(),
  filter: z.enum(["review_requested", "assigned", "created", "all"]),
  query: z.string().max(500),
  state: z.enum(["open", "closed", "all"]),
});
export const sideSchema = z.enum(["additions", "deletions"]);
export const bodySchema = z.string().min(1).max(65536);
export const draftSchema = z.object({
  id: z.string().max(100),
  path: filePathSchema,
  line: z.number().int().positive(),
  side: sideSchema,
  body: z.string().max(65536),
  revision: z.string().max(150),
  createdAt: z.string().max(50),
});
export const progressSchema = z.object({
  reviewBody: z.string().max(65536).optional(),
  read: z.record(z.string().max(4096), z.string().max(150)),
  drafts: z.array(draftSchema).max(1000),
  marks: z
    .array(
      z.object({
        id: z.string().max(100),
        path: filePathSchema,
        start: z.number().int().positive(),
        end: z.number().int().positive(),
        side: sideSchema,
        revision: z.string().max(150),
      }),
    )
    .max(5000),
});
export function normalizeServer(input: string): string {
  const u = new URL(input.trim());
  if (
    u.protocol !== "https:" &&
    !(
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
  )
    throw new Error("Use HTTPS for your Gitea server.");
  if (u.username || u.password || u.search || u.hash)
    throw new Error("Enter just the server URL, including its Gitea subpath.");
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.origin}${path}`;
}
export function parsePullUrl(input: string, server: string) {
  let u = new URL(input);
  if (u.protocol === "reviewrelay:")
    u = new URL(u.searchParams.get("url") ?? "");
  const root = new URL(server);
  const base = root.pathname.replace(/\/$/, "");
  if (u.origin !== root.origin || !u.pathname.startsWith(`${base}/`))
    throw new Error(
      "This PR belongs to a different Gitea server. Connect that server first.",
    );
  const parts = u.pathname
    .slice(base.length + 1)
    .split("/")
    .filter(Boolean);
  if (!["pulls", "pull"].includes(parts[2]) || !/^\d+$/.test(parts[3] ?? ""))
    throw new Error("Paste a Gitea pull request URL.");
  return refSchema.parse({
    owner: decodeURIComponent(parts[0]),
    name: decodeURIComponent(parts[1]),
    number: Number(parts[3]),
  });
}
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
