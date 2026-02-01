import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./", // Use relative paths for Electron
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@assets": path.resolve(__dirname, "assets")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
