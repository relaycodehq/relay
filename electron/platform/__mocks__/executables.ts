// `vi.mock(".../platform/executables")` with no factory: the real module,
// except no agent CLI is found, so a test never runs one installed here.
import { vi } from "vitest";

export * from "../executables";
export const findExecutable = vi.fn();
