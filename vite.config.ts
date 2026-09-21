import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5177, strictPort: true },
  build: { target: "es2022", reportCompressedSize: false },
  worker: { format: "es" },
});
