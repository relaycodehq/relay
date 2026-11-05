// Colours and cursor moves (CSI), window titles and links (OSC, ended by BEL
// or ESC \), and two-byte escapes like ESC 7 or ESC ( B.
const terminalCodes =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[ -/]*[0-~])/g;

/**
 * What a command printed, as plain text: no terminal codes, and a line it
 * redrew with \r, like a progress bar, keeps only its last state.
 */
export function terminalText(output: string) {
  if (!/[\x1b\r]/.test(output)) return output;
  return output
    .replace(terminalCodes, "")
    .split("\n")
    .map((line) => line.split("\r").filter(Boolean).at(-1) ?? "")
    .join("\n");
}
