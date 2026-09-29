import { z } from "zod";
import { symbolQuerySchema } from "../../shared/checks";
import {
  blameQuerySchema,
  filePathSchema,
  refSchema,
  shaSchema,
  textSchema,
} from "../../shared/validation";
import { workingPathSchema } from "../../shared/working-tree";
import { workspaceIdSchema } from "../../shared/workspaces";
import { detectProject } from "../checks/detect";
import type { ApiContext, Handlers } from "./context";

/** Diagnostics, symbols and line history, in a project's folders and in linked pull requests. */
export function checkHandlers(ctx: ApiContext) {
  const {
    projectChecks,
    blame,
    placeRoot,
    prKey,
    linkedFolder,
    requireFolder,
    requireClient,
  } = ctx;
  return {
    localCheckInfo: async (args) => detectProject(await placeRoot(args[0])),
    localCheckState: (args) =>
      projectChecks.state(
        "project:" + workspaceIdSchema.parse(args[0]),
        shaSchema.parse(args[1]),
      ),
    startLocalChecks: async (args) => {
      const id = workspaceIdSchema.parse(args[0]);
      return projectChecks.start(
        "project:" + id,
        await placeRoot(id),
        null,
        null,
        shaSchema.parse(args[1]),
        z.string().max(4096).parse(args[2]),
      );
    },
    stopLocalChecks: (args) => {
      projectChecks.stop("project:" + workspaceIdSchema.parse(args[0]));
    },
    pauseLocalChecks: (args) => {
      projectChecks.pause(
        "project:" + workspaceIdSchema.parse(args[0]),
        z.boolean().parse(args[1]),
      );
    },
    updateLocalCheckBuffer: (args) =>
      projectChecks.update(
        "project:" + workspaceIdSchema.parse(args[0]),
        shaSchema.parse(args[1]),
        workingPathSchema.parse(args[2]),
        textSchema.nullable().parse(args[3]),
      ),
    inspectLocalSymbol: (args) =>
      projectChecks.symbol(
        "project:" + workspaceIdSchema.parse(args[0]),
        shaSchema.parse(args[1]),
        symbolQuerySchema.parse(args[2]),
      ),
    localBlame: async (args) =>
      blame.read(
        await placeRoot(args[0]),
        null,
        null,
        blameQuerySchema.parse(args[1]),
      ),
    inspectSymbol: (args) =>
      projectChecks.symbol(
        prKey(refSchema.parse(args[0])),
        shaSchema.parse(args[1]),
        symbolQuerySchema.parse(args[2]),
      ),
    projectCheckInfo: (args) => {
      const dir = linkedFolder(refSchema.parse(args[0]));
      return dir ? detectProject(dir) : null;
    },
    projectCheckState: (args) =>
      projectChecks.state(
        prKey(refSchema.parse(args[0])),
        shaSchema.parse(args[1]),
      ),
    stopProjectChecks: (args) => {
      projectChecks.stop(prKey(refSchema.parse(args[0])));
    },
    pauseProjectChecks: (args) => {
      projectChecks.pause(
        prKey(refSchema.parse(args[0])),
        z.boolean().parse(args[1]),
      );
    },
    startProjectChecks: (args) => {
      const r = refSchema.parse(args[0]),
        head = shaSchema.parse(args[1]);
      return projectChecks.start(
        prKey(r),
        requireFolder(r),
        requireClient().account.server,
        r,
        head,
        z.string().max(4096).parse(args[2]),
      );
    },
    updateCheckBuffer: (args) =>
      projectChecks.update(
        prKey(refSchema.parse(args[0])),
        shaSchema.parse(args[1]),
        filePathSchema.parse(args[2]),
        textSchema.nullable().parse(args[3]),
      ),
    blame: (args) => {
      const r = refSchema.parse(args[0]),
        query = blameQuerySchema.parse(args[1]),
        dir = requireFolder(
          r,
          "Link this repository to a local folder to see line history.",
        );
      return blame.read(dir, requireClient().account.server, r, query);
    },
  } satisfies Handlers;
}
