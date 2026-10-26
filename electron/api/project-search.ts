import {
  projectSearchQuerySchema,
  replacementSchema,
  replaceFilesSchema,
  searchSlotSchema,
} from "../../shared/project-search";
import { workspaceIdSchema } from "../../shared/workspaces";
import {
  replaceProjectText,
  searchProjectText,
  SearchSlots,
} from "../project-search";
import { takes, type ApiContext } from "./context";

/** Find in files and replace in files, which window's page asks decides what a new search cancels. */
export function projectSearchHandlers(ctx: ApiContext) {
  const slots = new SearchSlots();
  const keyOf = (slot: string) => `${ctx.window.caller()?.id ?? 0}:${slot}`;
  return {
    searchProjectText: takes(
      [workspaceIdSchema, projectSearchQuerySchema, searchSlotSchema],
      async (where, query, slot) => {
        const key = keyOf(slot);
        // Before the folder is looked up, so a newer search cancels this one even then.
        const signal = slots.start(key);
        try {
          const place = await ctx.place(where);
          return await searchProjectText(
            {
              root: place.root,
              plain: place.plain,
              files: () => ctx.projects.files(place),
            },
            query,
            signal,
          );
        } finally {
          slots.finish(key, signal);
        }
      },
    ),
    cancelProjectSearch: takes([searchSlotSchema], (slot) =>
      slots.cancel(keyOf(slot)),
    ),
    replaceProjectText: takes(
      [
        workspaceIdSchema,
        projectSearchQuerySchema,
        replacementSchema,
        replaceFilesSchema,
      ],
      async (where, query, replacement, files) =>
        replaceProjectText(
          (await ctx.place(where)).root,
          query,
          replacement,
          files,
        ),
    ),
  };
}
