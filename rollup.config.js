import { base64 } from "./util/import-base-64.ts";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";

const globals = {
  three: "THREE",
};

export default [
  {
    input: "./src/index.ts",
    treeshake: false,
    external: ["three"],
    output: [
      {
        name: "Gaussian Splats 3D",
        extend: true,
        format: "umd",
        file: "./build/gaussian-splats-3d.umd.cjs",
        globals: globals,
        sourcemap: true,
      },
      {
        name: "Gaussian Splats 3D",
        extend: true,
        format: "umd",
        file: "./build/gaussian-splats-3d.umd.min.cjs",
        globals: globals,
        sourcemap: true,
        plugins: [terser()],
      },
    ],
    plugins: [
      typescript({
        compilerOptions: {
          outDir: "./build",
          declaration: false,
        },
      }),
      base64({ include: "**/*.wasm" }),
    ],
  },
  {
    input: "./src/index.ts",
    treeshake: false,
    external: ["three"],
    output: [
      {
        name: "Gaussian Splats 3D",
        format: "esm",
        file: "./build/gaussian-splats-3d.module.js",
        sourcemap: true,
      },
      {
        name: "Gaussian Splats 3D",
        format: "esm",
        file: "./build/gaussian-splats-3d.module.min.js",
        sourcemap: true,
        plugins: [terser()],
      },
    ],
    plugins: [
      typescript({
        compilerOptions: {
          outDir: "./build",
          declaration: false,
        },
      }),
      base64({
        include: "**/*.wasm",
        sourceMap: false,
      }),
    ],
  },
];
