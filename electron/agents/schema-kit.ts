import { z } from "zod";

/** A field an agent may leave out or null, or send as something this Relay can't use: the same as absent. */
export const lenient = <T extends z.ZodType>(schema: T) =>
  schema.nullish().catch(undefined);

/** An issue as `path: message`, without the first `skip` steps of the path. */
export const named = (issue: z.core.$ZodIssue, skip = 0) => {
  const path = issue.path.slice(skip).join(".");
  return `${path ? `${path}: ` : ""}${issue.message}`;
};
