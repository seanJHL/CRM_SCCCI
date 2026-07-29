import { defineConfig } from "@tanstack/react-start/config";
import { tanstackRouter } from "@tanstack/router-plugin/rpc";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Deploy to Cloudflare Pages with SSR via Pages Functions
  preset: "cloudflare-pages",
  vite: {
    plugins: [
      tanstackRouter({
        autoCodeSplitting: true,
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
      }),
      viteTsConfigPaths(),
    ],
    server: {
      port: 3001,
    },
  },
});
