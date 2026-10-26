import { blameQuerySchema, refSchema } from "../../shared/validation";
import { workspaceIdSchema } from "../../shared/workspaces";
import { fileAuthorsQuerySchema } from "../../shared/file-authors";
import { fileAuthors } from "../git/file-authors";
import { takes, type ApiContext, type Handlers } from "./context";

/** Who wrote each line and file, in a project's folders and in linked pull requests. */
export function lineHistoryHandlers(ctx: ApiContext) {
  const { blame, placeRoot, requireFolder, requireServer } = ctx;
  return {
    localBlame: takes(
      [workspaceIdSchema, blameQuerySchema],
      async (where, query) =>
        blame.read(await placeRoot(where), null, null, query),
    ),
    localFileAuthors: takes(
      [workspaceIdSchema, fileAuthorsQuerySchema],
      async (where, query) => fileAuthors(await placeRoot(where), query),
    ),
    blame: takes([refSchema, blameQuerySchema], (r, query) => {
      const dir = requireFolder(
        r,
        "Link this repository to a local folder to see line history.",
      );
      return blame.read(dir, requireServer(r), r, query);
    }),
  } satisfies Handlers;
}
