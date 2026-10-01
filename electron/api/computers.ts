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
    bringBackThread: takes([idSchema], (chatId) =>
      handoffs().sender.bringBack(chatId),
    ),
    keepThreadHere: takes([idSchema], (chatId) =>
      handoffs().sender.keepHere(chatId),
    ),
    updateComputer: takes([idSchema], (id) => handoffs().sender.update(id)),
  } satisfies Handlers;
}
