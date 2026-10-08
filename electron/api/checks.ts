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
import { takes, type ApiContext, type Handlers } from "./context";

const targetSchema = z.string().max(4096);

/** Diagnostics, symbols and line history, in a project's folders and in linked pull requests. */
export function checkHandlers(ctx: ApiContext) {
  const {
    projectChecks,
    blame,
    placeRoot,
    prKey,
    linkedFolder,
    requireFolder,
    requireServer,
  } = ctx;
  const local = (where: string) => "project:" + where;
  return {
    localCheckInfo: takes([workspaceIdSchema], async (where) =>
      detectProject(await placeRoot(where)),
    ),
    localCheckState: takes([workspaceIdSchema, shaSchema], (where, head) =>
      projectChecks.state(local(where), head),
    ),
    startLocalChecks: takes(
      [workspaceIdSchema, shaSchema, targetSchema],
      async (where, head, target) =>
        projectChecks.start(
          local(where),
          await placeRoot(where),
          null,
          null,
          head,
          target,
        ),
    ),
    stopLocalChecks: takes([workspaceIdSchema], (where) => {
      projectChecks.stop(local(where));
    }),
    pauseLocalChecks: takes(
      [workspaceIdSchema, z.boolean()],
      (where, paused) => {
        projectChecks.pause(local(where), paused);
      },
    ),
    updateLocalCheckBuffer: takes(
      [workspaceIdSchema, shaSchema, workingPathSchema, textSchema.nullable()],
      (where, head, path, text) =>
        projectChecks.update(local(where), head, path, text),
    ),
    inspectLocalSymbol: takes(
      [workspaceIdSchema, shaSchema, symbolQuerySchema],
      (where, head, query) => projectChecks.symbol(local(where), head, query),
    ),
    localBlame: takes(
      [workspaceIdSchema, blameQuerySchema],
      async (where, query) =>
        blame.read(await placeRoot(where), null, null, query),
    ),
    inspectSymbol: takes(
      [refSchema, shaSchema, symbolQuerySchema],
      (r, head, query) => projectChecks.symbol(prKey(r), head, query),
    ),
    projectCheckInfo: takes([refSchema], (r) => {
      const dir = linkedFolder(r);
      return dir ? detectProject(dir) : null;
    }),
    projectCheckState: takes([refSchema, shaSchema], (r, head) =>
      projectChecks.state(prKey(r), head),
    ),
    stopProjectChecks: takes([refSchema], (r) => {
      projectChecks.stop(prKey(r));
    }),
    pauseProjectChecks: takes([refSchema, z.boolean()], (r, paused) => {
      projectChecks.pause(prKey(r), paused);
    }),
    startProjectChecks: takes(
      [refSchema, shaSchema, targetSchema],
      (r, head, target) =>
        projectChecks.start(
          prKey(r),
          requireFolder(r),
          requireServer(r),
          r,
          head,
          target,
        ),
    ),
    updateCheckBuffer: takes(
      [refSchema, shaSchema, filePathSchema, textSchema.nullable()],
      (r, head, path, text) => projectChecks.update(prKey(r), head, path, text),
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
