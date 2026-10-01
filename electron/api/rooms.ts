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
import type { SyncWorkspace } from "../live-sync";
import { validateRepo } from "../working-tree";
import type { ApiContext, Handlers } from "./context";

/** Shared pull-request rooms, their hosting, and live file sync with them. */
export function roomHandlers(ctx: ApiContext) {
  const {
    store,
    projects,
    projectChats,
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
  const room = (args: unknown[]) => roomOf(refSchema.parse(args[0]));

  function syncTarget(where: unknown) {
    const target = z
      .union([z.object({ chatId: idSchema }).strict(), refSchema])
      .parse(where);
    const key = "chatId" in target ? "chat:" + target.chatId : prKey(target);
    return { target, key, sync: liveSyncs.get(key) };
  }
  function activeSync(where: unknown) {
    const { sync } = syncTarget(where);
    if (!sync?.status().active)
      throw new Error("Resume live sync before resolving files.");
    return sync;
  }

  return {
    roomHosting: () => rooms.hostingStatus(),
    saveRoomHosting: (args) =>
      rooms.saveHosting(roomHostingSchema.nullable().parse(args[0])),
    roomAcceptInvitation: async (args) => {
      const invitation = parseRoomInvitation(
        z.string().max(16384).parse(args[0]),
      );
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
    },
    roomAccessInfo: async (args) => ({
      server: await rooms.projectServer(room(args)),
    }),
    allowRoomAccess: (args) =>
      rooms.allowAccess(
        room(args),
        roomHostingSchema.shape.server.parse(args[1]),
      ),
    roomConnect: (args) =>
      rooms.connect(room(args), connectRoomSchema.parse(args[1])),
    roomState: (args) => rooms.state(room(args)),
    roomDisconnect: async (args) => {
      const context = room(args);
      // PR keys extend this repository's key: [account, owner, name, number].
      await liveSyncs.stopWhere((key) =>
        key.startsWith(context.key.slice(0, -1) + ","),
      );
      return rooms.disconnect(context);
    },
    roomPoll: (args) =>
      rooms.poll(
        room(args),
        z.number().int().nonnegative().parse(args[1]),
        args[2] === undefined
          ? undefined
          : z.number().int().nonnegative().parse(args[2]),
      ),
    roomSend: (args) => rooms.send(room(args), sendRoomSchema.parse(args[1])),
    roomCancel: (args) => rooms.cancel(room(args), idSchema.parse(args[1])),
    roomPresence: (args) =>
      rooms.presence(room(args), presenceSchema.nullable().parse(args[1])),
    roomInvite: (args) => rooms.invite(room(args)),
    roomMembers: (args) => rooms.members(room(args)),
    roomRevoke: (args) => rooms.revoke(room(args), idSchema.parse(args[1])),
    liveSyncState: (args) => syncTarget(args[0]).sync?.status() ?? idleSync,
    liveSyncStop: async (args) => {
      await syncTarget(args[0]).sync?.stop();
    },
    liveSyncStart: async (args) => {
      const { target, key, sync } = syncTarget(args[0]);
      if (sync?.status().active) return sync.status();
      let workspace: SyncWorkspace;
      if ("chatId" in target)
        workspace = await projectChats.workspace(target.chatId);
      else {
        const client = requireClient();
        const root = await validateRepo(
          requireFolder(target),
          client.account.server,
          target,
        );
        workspace = {
          ...(await rooms.workspace({
            client,
            ref: target,
            key: repoKey(target),
            dir: root,
          })),
          root,
          validate: () => validateRepo(root, client.account.server, target),
        };
      }
      for (const project of store.get().projects ?? [])
        if (project.path === workspace.root)
          projects.assertCheckoutAvailable(project.id);
      return liveSyncs.start(key, workspace);
    },
    liveSyncConflict: (args) =>
      activeSync(args[0]).conflict(workingPathSchema.parse(args[1])),
    liveSyncResolve: (args) =>
      activeSync(args[0]).resolve(
        workingPathSchema.parse(args[1]),
        z.enum(["local", "shared"]).parse(args[2]),
        z.number().int().positive().parse(args[3]),
        digestSchema.nullable().parse(args[4]),
      ),
  } satisfies Handlers;
}
