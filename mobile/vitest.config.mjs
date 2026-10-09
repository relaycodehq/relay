import { fileURLToPath } from "node:url";

export default {
  root: fileURLToPath(new URL("..", import.meta.url)),
  tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  test: { include: ["mobile/src/**/*.test.ts"] },
};
