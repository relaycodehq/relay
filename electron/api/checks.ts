import { z } from "zod";
import { CHECKS_MEMORY_MB, symbolQuerySchema } from "../../shared/checks";
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
import type { CheckLimits } from "../checks/service";
import { takes, type ApiContext, type Handlers } from "./context";

const targetSchema = z.string().max(4096);
/** A window's hold on a checker it shares with other windows. */
const holderSchema = z.string().max(64);

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
    place,
    store,
  } = ctx;
  const local = (where: string) => "project:" + where;
  const limits = (projectId?: string): CheckLimits => ({
    projectId,
    memoryMb:
      (projectId &&
        store.get().projects?.find((p) => p.id === projectId)?.settings
          ?.checksMemoryMb) ||
      CHECKS_MEMORY_MB,
  });
  /** A PR's linked folder takes the limit of the project at that folder. */
  const folderProject = (dir: string) =>
    store.get().projects?.find((p) => !p.removed && p.path === dir)?.id;
  return {
    localCheckInfo: takes([workspaceIdSchema], async (where) =>
      detectProject(await placeRoot(where)),
    ),
    localCheckState: takes([workspaceIdSchema, shaSchema], (where, head) =>
      projectChecks.state(local(where), head),
    ),
    startLocalChecks: takes(
      [workspaceIdSchema, shaSchema, targetSchema, holderSchema, z.boolean()],
      async (where, head, target, holder, paused) => {
        const { root, projectId } = await place(where);
        return projectChecks.start(
          local(where),
          root,
          null,
          null,
          head,
          target,
          limits(projectId),
          { holder, paused },
        );
      },
    ),
    stopLocalChecks: takes(
      [workspaceIdSchema, holderSchema],
      (where, holder) => {
        projectChecks.stop(local(where), holder);
      },
    ),
    pauseLocalChecks: takes(
      [workspaceIdSchema, z.boolean(), holderSchema],
      (where, paused, holder) => {
        projectChecks.pause(local(where), paused, holder);
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
    stopProjectChecks: takes([refSchema, holderSchema], (r, holder) => {
      projectChecks.stop(prKey(r), holder);
    }),
    pauseProjectChecks: takes(
      [refSchema, z.boolean(), holderSchema],
      (r, paused, holder) => {
        projectChecks.pause(prKey(r), paused, holder);
      },
    ),
    startProjectChecks: takes(
      [refSchema, shaSchema, targetSchema, holderSchema, z.boolean()],
      (r, head, target, holder, paused) => {
        const dir = requireFolder(r);
        return projectChecks.start(
          prKey(r),
          dir,
          requireServer(r),
          r,
          head,
          target,
          limits(folderProject(dir)),
          { holder, paused },
        );
      },
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
