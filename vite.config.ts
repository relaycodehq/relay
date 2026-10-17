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
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    // previews/ stays watched: this server serves them, and an ignored file
    // keeps its first transform until restart.
    watch: {
      ignored: [
        "**/.claude/**",
        "**/t3code/**",
        "**/android/**",
        "**/ios/**",
        "**/dist-*/**",
        "**/release/**",
        "**/build/**",
      ],
    },
  },
  // By default the dep scan crawls every .html under the root, worktrees in
  // .claude/ included. Previews stay in so opening one doesn't re-bundle deps
  // and reload every page, the app's too.
  optimizeDeps: { entries: ["index.html", "previews/**/index.html"] },
  build: {
    target: "es2022",
    // Electron's own Chromium. An older target makes LightningCSS polyfill
    // light-dark() with prefers-color-scheme, which follows the OS instead of
    // the color-scheme Relay's theme sets on <html>.
    cssTarget: "chrome152",
    reportCompressedSize: false,
  },
  worker: { format: "es" },
});
