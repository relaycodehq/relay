/** The whole computer now. */
export interface MachineLoad {
  /** 0–100 with every core counted; missing until a second look. */
  cpu?: number;
  usedMb: number;
  totalMb: number;
}

export interface ProcessesApi {
  machineLoad(): Promise<MachineLoad>;
}

/** "1.4 GB", "380 MB". */
export function formatMemory(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(mb)} MB`;
}
