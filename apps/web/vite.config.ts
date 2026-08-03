import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 3001,
    // Do not silently start another dev server against the same optimizer
    // cache. Two Vite processes can leave an open page with modules from
    // different dependency graphs, which React reports as an invalid hook
    // call.
    strictPort: true,
  },
  // pnpm's isolated dependency layout can expose React through more than one
  // resolved path. Keep the renderer, TanStack Router, and application hooks
  // on one React module instance in both development and production builds.
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    viteTsConfigPaths(),
    // The React plugin must run after the TanStack Start plugin.
    viteReact(),
  ],
});
