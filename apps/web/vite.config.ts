import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 3001,
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
