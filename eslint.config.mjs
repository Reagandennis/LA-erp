import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-plugin-react-hooks 7.1 (via eslint-config-next 16.4) promotes its
    // React Compiler rules from off to error. The codebase predates them, so
    // keep them visible as warnings until the flagged effects are refactored.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    // Orphan macOS-style "kept both" duplicates committed in the past; not part of the live tree.
    "**/* 2.ts",
    "**/* 2.tsx",
    "**/* 2.js",
    "**/* 2.mjs",
    "**/* 2.d.ts",
  ]),
]);

export default eslintConfig;
