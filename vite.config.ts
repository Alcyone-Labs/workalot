import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { resolve } from "path";
import pkg from "./package.json";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "Workalot",
      fileName: "index",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
        /^node:.*/,
        // Add specific node built-ins if not caught by regex
        "worker_threads",
        "os",
        "events",
        "path",
        "fs",
        "util",
      ],
    },
    sourcemap: true,
    target: "esnext",
    minify: false,
  },
  plugins: [
    dts({
      rollupTypes: true,
    }),
  ],
});
