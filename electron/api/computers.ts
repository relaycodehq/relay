import { z } from "zod";
import { idSchema } from "../../shared/rooms";
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
    forgetComputer: takes([idSchema], (id) => handoffs().computers.forget(id)),
    handoffTargets: takes([idSchema], (chatId) =>
      handoffs().sender.targets(chatId),
    ),
    handOffThread: takes([idSchema, idSchema], (chatId, computerId) =>
      handoffs().sender.handOff(chatId, computerId),
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
    updateComputer: takes([idSchema], (id) => handoffs().sender.update(id)),
  } satisfies Handlers;
}
