import { z } from "zod";
import { idleSync } from "../../shared/live-sync";
import {
  connectRoomSchema,
  idSchema,
  parseRoomInvitation,
  presenceSchema,
  roomHostingSchema,
  sendRoomSchema,
} from "../../shared/rooms";
import {
  digestSchema,
  normalizeServer,
  refSchema,
} from "../../shared/validation";
import { workingPathSchema } from "../../shared/working-tree";
import type { PullRef } from "../../shared/types";
import type { SyncWorkspace } from "../projects/live-sync";
import { validateRepo } from "../git/working-tree";
import { takes, type ApiContext, type Handlers } from "./context";

/** Shared pull-request rooms, their hosting, and live file sync with them. */
export function roomHandlers(ctx: ApiContext) {
  const {
    store,
    projects,
    rooms,
    liveSyncs,
    requireClient,
    repoKey,
    prKey,
    linkedFolder,
    requireFolder,
  } = ctx;

  const roomOf = (ref: PullRef) => ({
    client: requireClient(),
    ref,
    key: repoKey(ref),
    dir: linkedFolder(ref),
  });

  function syncOf(target: PullRef) {
    const key = prKey(target);
    return { key, sync: liveSyncs.get(key) };
  }
  function activeSync(target: PullRef) {
    const { sync } = syncOf(target);
    if (!sync?.status().active)
      throw new Error("Resume live sync before resolving files.");
    return sync;
  }

  return {
    roomHosting: () => rooms.hostingStatus(),
    saveRoomHosting: takes([roomHostingSchema.nullable()], (input) =>
      rooms.saveHosting(input),
    ),
    roomAcceptInvitation: takes([z.string().max(16384)], async (url) => {
      const invitation = parseRoomInvitation(url);
      if (!invitation.project || !invitation.number)
        throw new Error(
          "This older invitation has no PR target. Open its repository and paste the invitation in the room.",
        );
      if (
        normalizeServer(invitation.project.server) !==
        normalizeServer(requireClient().account.server)
      )
        throw new Error(
          `Sign into ${invitation.project.server} in Settings to join this project.`,
        );
      const ref = refSchema.parse({
        ...invitation.project,
        number: invitation.number,
      });
      const context = roomOf(ref);
      await rooms.allowAccess(context, invitation.server);
      const state = await rooms.connect(context, {
        server: invitation.server,
        secret: invitation.secret,
        projectId: invitation.projectId,
      });
      return { ref, state };
    }),
    roomAccessInfo: takes([refSchema], async (ref) => ({
      server: await rooms.projectServer(roomOf(ref)),
    })),
    allowRoomAccess: takes(
      [refSchema, roomHostingSchema.shape.server],
      (ref, server) => rooms.allowAccess(roomOf(ref), server),
    ),
    roomConnect: takes([refSchema, connectRoomSchema], (ref, input) =>
      rooms.connect(roomOf(ref), input),
    ),
    roomState: takes([refSchema], (ref) => rooms.state(roomOf(ref))),
    roomDisconnect: takes([refSchema], async (ref) => {
      const context = roomOf(ref);
      // PR keys extend this repository's key: [account, owner, name, number].
      await liveSyncs.stopWhere((key) =>
        key.startsWith(context.key.slice(0, -1) + ","),
      );
      return rooms.disconnect(context);
    }),
    roomPoll: takes(
      [
        refSchema,
        z.number().int().nonnegative(),
        z.number().int().nonnegative().optional(),
      ],
      (ref, cursor, before) => rooms.poll(roomOf(ref), cursor, before),
    ),
    roomSend: takes([refSchema, sendRoomSchema], (ref, input) =>
      rooms.send(roomOf(ref), input),
    ),
    roomCancel: takes([refSchema, idSchema], (ref, id) =>
      rooms.cancel(roomOf(ref), id),
    ),
    roomPresence: takes(
      [refSchema, presenceSchema.nullable()],
      (ref, presence) => rooms.presence(roomOf(ref), presence),
    ),
    roomInvite: takes([refSchema], (ref) => rooms.invite(roomOf(ref))),
    roomMembers: takes([refSchema], (ref) => rooms.members(roomOf(ref))),
    roomRevoke: takes([refSchema, idSchema], (ref, id) =>
      rooms.revoke(roomOf(ref), id),
    ),
    liveSyncState: takes(
      [refSchema],
      (target) => syncOf(target).sync?.status() ?? idleSync,
    ),
    liveSyncStop: takes([refSchema], async (target) => {
      await syncOf(target).sync?.stop();
    }),
    liveSyncStart: takes([refSchema], async (target) => {
      const { key, sync } = syncOf(target);
      if (sync?.status().active) return sync.status();
      const client = requireClient();
      const root = await validateRepo(
        requireFolder(target),
        client.account.server,
        target,
      );
      const workspace: SyncWorkspace = {
        ...(await rooms.workspace({
          client,
          ref: target,
          key: repoKey(target),
          dir: root,
        })),
        root,
        validate: () => validateRepo(root, client.account.server, target),
      };
      for (const project of store.get().projects ?? [])
        if (project.path === workspace.root)
          projects.assertCheckoutAvailable(project.id);
      return liveSyncs.start(key, workspace);
    }),
    liveSyncConflict: takes([refSchema, workingPathSchema], (target, path) =>
      activeSync(target).conflict(path),
    ),
    liveSyncResolve: takes(
      [
        refSchema,
        workingPathSchema,
        z.enum(["local", "shared"]),
        z.number().int().positive(),
        digestSchema.nullable(),
      ],
      (target, path, choice, revision, localHash) =>
        activeSync(target).resolve(path, choice, revision, localHash),
    ),
  } satisfies Handlers;
}
