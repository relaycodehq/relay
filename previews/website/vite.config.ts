// Builds the website on its own, with its page at the site's root:
//   npx vite build --config previews/website/vite.config.ts --outDir <folder> --emptyOutDir
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  plugins: [react()],
  publicDir: false,
  build: { target: "es2022", reportCompressedSize: false },
  worker: { format: "es" },
});
