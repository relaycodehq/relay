import { idSchema } from "../../shared/validation";
import { scheduleInputSchema } from "../../shared/schedules";
import { takes, type ApiContext, type Handlers } from "./context";

/** The Schedules page: prompts Relay sends on its own. */
export function scheduleHandlers(ctx: ApiContext) {
  return {
    schedules: async () => ctx.schedules.list(),
    saveSchedule: takes([idSchema.nullable(), scheduleInputSchema], (id, input) =>
      ctx.schedules.save(id, input),
    ),
    deleteSchedule: takes([idSchema], (id) => ctx.schedules.remove(id)),
    testSchedule: takes([idSchema], (id) => ctx.schedules.test(id)),
  } satisfies Handlers;
}
