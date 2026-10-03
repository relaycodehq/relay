import { localSwitch } from "../../lib/local-switch";

/**
 * Whether a screenshot also goes into the message as an `[Image #n]` pill.
 * Off, screenshots only sit above the message, as they did before pills.
 */
const pills = localSwitch("relay-image-pills");
export const useImagePills = pills.use;
export const setImagePills = pills.set;
