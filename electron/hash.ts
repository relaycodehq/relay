import { createHash } from "node:crypto";
/** Content hash used for file versions, cache keys and checkout revisions. */
export const digest = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
