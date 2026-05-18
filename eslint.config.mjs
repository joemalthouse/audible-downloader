import js from "@eslint/js";
import globals from "globals";

const browserModule = {
  languageOptions: {
    globals: { ...globals.browser },
    ecmaVersion: "latest",
    sourceType: "module",
  },
};

const workerModule = {
  languageOptions: {
    globals: { ...globals.serviceworker, crypto: "readonly", btoa: "readonly", atob: "readonly", fetch: "readonly", Response: "readonly", Headers: "readonly", URL: "readonly", URLSearchParams: "readonly", TextEncoder: "readonly", TextDecoder: "readonly", console: "readonly" },
    ecmaVersion: "latest",
    sourceType: "module",
  },
};

const nodeModule = {
  languageOptions: {
    globals: { ...globals.node, crypto: "readonly" },
    ecmaVersion: "latest",
    sourceType: "module",
  },
};

export default [
  js.configs.recommended,
  { ignores: ["dist/**", "build/**", "node_modules/**", "vendor/**", ".wrangler/**", "scripts/debug-*.mjs"] },
  { files: ["app.js"], ...browserModule },
  { files: ["auth/callback/finish.js"], ...browserModule },
  {
    files: ["sw.js"],
    languageOptions: {
      globals: { ...globals.serviceworker, fetch: "readonly", URL: "readonly", Response: "readonly", caches: "readonly" },
      ecmaVersion: "latest",
      sourceType: "script",
    },
  },
  { files: ["lib/**/*.js"], ...workerModule },
  { files: ["functions/**/*.js"], ...workerModule },
  { files: ["helper-server.mjs", "scripts/**/*.mjs"], ...nodeModule },
  { files: ["test/**/*.test.mjs"], ...nodeModule },
  {
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-condition": ["warn", { checkLoops: false }],
    },
  },
];
