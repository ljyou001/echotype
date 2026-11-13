/**
 * [INPUT]: 依赖 vite 的 defineConfig、@vitejs/plugin-react、node:path
 * [OUTPUT]: 渲染进程的 Vite 配置：React 插件、@ 与 @assets 别名、相对 base、开发服务器端口与文件访问白名单
 * [POS]: UI 层的构建入口。base 为 "./" 以便 Electron 用 file:// 加载；开发时放行仓库根目录，
 *        让 src/bridge/mockBridge 能直接读取 contracts/models.catalog.json（唯一模型数据源）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@assets": path.resolve(__dirname, "assets"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
