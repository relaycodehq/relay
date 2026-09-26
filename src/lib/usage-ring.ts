import { localSwitch } from "./local-switch";

/** Whether the usage ring shows in the composer next to the context meter. */
const usageRing = localSwitch("relay-usage-ring");
export const useUsageRing = usageRing.use;
export const setUsageRing = usageRing.set;
