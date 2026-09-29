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
import type { SyncWorkspace } from "../live-sync";
import { validateRepo } from "../working-tree";
import type { ApiContext, Handlers } from "./context";

type RoomMethod =
  | "roomAccessInfo"
  | "allowRoomAccess"
  | "roomConnect"
  | "roomState"
  | "roomDisconnect"
  | "roomPoll"
  | "roomSend"
  | "roomCancel"
  | "roomPresence"
  | "roomInvite"
  | "roomMembers"
  | "roomRevoke";

type LiveSyncMethod =
  | "liveSyncState"
  | "liveSyncStart"
  | "liveSyncStop"
  | "liveSyncConflict"
  | "liveSyncResolve";

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

  async function room(args: unknown[], method: RoomMethod) {
    const ref = refSchema.parse(args[0]);
    const context = {
      client: requireClient(),
      ref,
      key: repoKey(ref),
      dir: linkedFolder(ref),
    };
    if (method === "roomAccessInfo")
      return { server: await rooms.projectServer(context) };
    if (method === "allowRoomAccess")
      return rooms.allowAccess(
        context,
        roomHostingSchema.shape.server.parse(args[1]),
      );
    if (method === "roomConnect")
      return rooms.connect(context, connectRoomSchema.parse(args[1]));
    if (method === "roomState") return rooms.state(context);
    if (method === "roomDisconnect") {
      // PR keys extend this repository's key: [account, owner, name, number].
      await liveSyncs.stopWhere((key) =>
        key.startsWith(repoKey(ref).slice(0, -1) + ","),
      );
      return rooms.disconnect(context);
    }
    if (method === "roomPoll")
      return rooms.poll(
        context,
        z.number().int().nonnegative().parse(args[1]),
        args[2] === undefined
          ? undefined
          : z.number().int().nonnegative().parse(args[2]),
      );
    if (method === "roomSend")
      return rooms.send(context, sendRoomSchema.parse(args[1]));
    if (method === "roomCancel")
      return rooms.cancel(context, idSchema.parse(args[1]));
    if (method === "roomPresence")
      return rooms.presence(context, presenceSchema.nullable().parse(args[1]));
    if (method === "roomInvite") return rooms.invite(context);
    if (method === "roomMembers") return rooms.members(context);
    return rooms.revoke(context, idSchema.parse(args[1]));
  }

  async function liveSync(args: unknown[], method: LiveSyncMethod) {
    const target = z
      .union([z.object({ chatId: idSchema }).strict(), refSchema])
      .parse(args[0]);
    const key = "chatId" in target ? "chat:" + target.chatId : prKey(target);
    const sync = liveSyncs.get(key);
    if (method === "liveSyncState") return sync?.status() ?? idleSync;
    if (method === "liveSyncStop") {
      await sync?.stop();
      return;
    }
    if (method === "liveSyncStart") {
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
    }
    if (!sync?.status().active)
      throw new Error("Resume live sync before resolving files.");
    const path = workingPathSchema.parse(args[1]);
    if (method === "liveSyncConflict") return sync.conflict(path);
    return sync.resolve(
      path,
      z.enum(["local", "shared"]).parse(args[2]),
      z.number().int().positive().parse(args[3]),
      digestSchema.nullable().parse(args[4]),
    );
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
      const context = {
        client: requireClient(),
        ref,
        key: repoKey(ref),
        dir: linkedFolder(ref),
      };
      await rooms.allowAccess(context, invitation.server);
      const state = await rooms.connect(context, {
        server: invitation.server,
        secret: invitation.secret,
        projectId: invitation.projectId,
      });
      return { ref, state };
    },
    roomAccessInfo: room,
    allowRoomAccess: room,
    roomConnect: room,
    roomState: room,
    roomDisconnect: room,
    roomPoll: room,
    roomSend: room,
    roomCancel: room,
    roomPresence: room,
    roomInvite: room,
    roomMembers: room,
    roomRevoke: room,
    liveSyncState: liveSync,
    liveSyncStart: liveSync,
    liveSyncStop: liveSync,
    liveSyncConflict: liveSync,
    liveSyncResolve: liveSync,
  } satisfies Handlers;
}
