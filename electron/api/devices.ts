import { z } from "zod";
import { takes, type ApiContext } from "./context";

const boundsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().min(0).max(20_000),
    height: z.number().min(0).max(20_000),
  })
  .strict();

/** Simulators and emulators in the panel, through the device hub. */
export function deviceHandlers(ctx: ApiContext) {
  const devices = () => {
    if (!ctx.devices)
      throw new Error("Devices aren't available on a headless Relay.");
    return ctx.devices;
  };
  return {
    deviceHub: takes([], () => devices().state()),
    startDeviceHub: takes([], () => devices().start()),
    placeDeviceView: takes([boundsSchema.nullable()], (bounds) =>
      devices().place(bounds),
    ),
    closeDeviceView: takes([], () => devices().close()),
  };
}
