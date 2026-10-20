import { z } from "zod";
import { idSchema } from "../../shared/validation";
import { computerRouteSchema } from "../../shared/handoff";
import { checkRoute, wslDistros } from "../handoff/pipe-route";
import { sshHosts } from "../handoff/ssh-hosts";
import { installOutput, installRelayOver } from "../handoff/install-over";
import { projectChatSendSchema } from "../../shared/projects";
import { takes, type ApiContext, type Handlers } from "./context";

/** Settings → Computers, and handing threads to them. */
export function computerHandlers(ctx: ApiContext) {
  const handoffs = () => {
    const services = ctx.handoffs();
    if (!services) throw new Error("Relay is still starting.");
    return services;
  };
  return {
    pairedComputers: () => handoffs().computers.list(),
    computersOverview: () => handoffs().sender.overview(),
    pairComputer: takes([z.string().max(2000)], (link) =>
      handoffs().computers.pair(link),
    ),
    checkComputer: takes([computerRouteSchema], (route) => checkRoute(route)),
    connectComputer: takes([computerRouteSchema], (route) =>
      handoffs().computers.pairOver(route),
    ),
    wslDistros: () => wslDistros(),
    sshHosts: () => sshHosts(),
    installRelayOver: takes([computerRouteSchema], (route) =>
      installRelayOver(route),
    ),
    relayInstallOutput: takes([computerRouteSchema], (route) =>
      installOutput(route),
    ),
    wakeComputer: takes([idSchema], (id) => handoffs().computers.wake(id)),
    forgetComputer: takes([idSchema], (id) => handoffs().computers.forget(id)),
    handoffTargets: takes([idSchema], (chatId) =>
      handoffs().sender.targets(chatId),
    ),
    handOffThread: takes([idSchema, idSchema], (chatId, computerId) =>
      handoffs().sender.handOff(chatId, computerId),
    ),
    computerFolders: takes(
      [idSchema, z.string().trim().min(1).max(4096)],
      (computerId, dir) => handoffs().remote.folders(computerId, dir),
    ),
    addRemoteProject: takes(
      [idSchema, z.string().trim().min(1).max(4096)],
      (computerId, path) => handoffs().remote.add(computerId, path),
    ),
    startTargets: takes([idSchema], (projectId) =>
      handoffs().sender.startTargets(projectId),
    ),
    setupFolder: takes([idSchema, z.string().trim().min(1).max(4096)], (chatId, folder) =>
      handoffs().sender.setupFolder(chatId, folder),
    ),
    startThreadHere: takes([idSchema], (chatId) =>
      handoffs().sender.startHere(chatId),
    ),
    startProjectChatOn: takes(
      [idSchema, projectChatSendSchema, idSchema],
      async (chatId, input, computerId) => {
        const { sender } = handoffs();
        // Its project's own computer: a send starts it there, or holds it for later.
        const { projectId } = await ctx.projectChats.get(chatId);
        if (ctx.projects.get(projectId).computer?.id === computerId) {
          await ctx.projectChats.send(chatId, input);
          return;
        }
        await ctx.projectChats.firstMessageOnly(chatId, input);
        await sender.handOff(chatId, computerId);
      },
    ),
    retryHandoff: takes([idSchema], (chatId) =>
      handoffs().sender.retry(chatId),
    ),
    handoffView: takes([idSchema], (chatId) => handoffs().sender.view(chatId)),
    handoffViews: () => handoffs().sender.views(),
    bringBackThread: takes([idSchema, z.boolean().optional()], (chatId, park) =>
      handoffs().sender.bringBack(chatId, park),
    ),
    keepThreadHere: takes([idSchema], (chatId) =>
      handoffs().sender.keepHere(chatId),
    ),
    abandonHandoff: takes([idSchema], (chatId) =>
      handoffs().sender.abandon(chatId),
    ),
    runThreadHere: takes([idSchema], (chatId) =>
      handoffs().sender.runHere(chatId),
    ),
    dropHeldSend: takes([idSchema, idSchema], (chatId, sendId) =>
      handoffs().sender.dropHeld(chatId, sendId),
    ),
    updateComputer: takes([idSchema], (id) => handoffs().sender.update(id)),
  } satisfies Handlers;
}
