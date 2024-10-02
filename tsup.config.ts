import { defineConfig } from "tsup";

export default defineConfig({
  target: "node20",
  format: ["esm"],
  entry: ["src/plainjob.ts"],
  external: [],
  dts: true,
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
});
