import swc from "unplugin-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { decoratorMetadata: true },
        target: "es2022",
      },
      module: { type: "es6" },
    }),
    tsconfigPaths(),
  ],
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["reflect-metadata"],
    include: ["src/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
