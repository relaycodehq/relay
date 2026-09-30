import { z } from "zod";
import { idSchema } from "../../shared/rooms";
import type { ApiContext, Handlers } from "./context";

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
    pairComputer: (args) =>
      handoffs().computers.pair(z.string().max(2000).parse(args[0])),
    forgetComputer: (args) =>
      handoffs().computers.forget(idSchema.parse(args[0])),
    handoffTargets: (args) =>
      handoffs().sender.targets(idSchema.parse(args[0])),
    handOffThread: (args) =>
      handoffs().sender.handOff(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
      ),
    retryHandoff: (args) => handoffs().sender.retry(idSchema.parse(args[0])),
    handoffView: (args) => handoffs().sender.view(idSchema.parse(args[0])),
    bringBackThread: (args) =>
      handoffs().sender.bringBack(idSchema.parse(args[0])),
    keepThreadHere: (args) =>
      handoffs().sender.keepHere(idSchema.parse(args[0])),
  } satisfies Handlers;
}
