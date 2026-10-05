import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A worktree thread's dev server moves up by its offset, beside the checkout's.
const port = 5177 + (Number(process.env.RELAY_PORT_OFFSET) || 0);

export default defineConfig({
  base: "./",
  // Out of node_modules: a worktree links the checkout's, and two servers
  // sharing one dep cache rewrite each other's.
  cacheDir: ".vite",
  plugins: [
    react(),
    {
      name: "dev-port-csp",
      apply: "serve",
      transformIndexHtml: (html) =>
        html.replace("ws://127.0.0.1:5177", `ws://127.0.0.1:${port}`),
    },
  ],
  server: { host: "127.0.0.1", port, strictPort: true },
  build: { target: "es2022", reportCompressedSize: false },
  worker: { format: "es" },
});
