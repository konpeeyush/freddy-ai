import js from "@eslint/js"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  globalIgnores(["dist", "*.db", "*.db-*"]),
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      // Reads the filesystem and opens SQLite — Node-only, never runs in the
      // widget bundle. Globals listed rather than pulled from `globals` for
      // the same reason as in `@workspace/api`.
      globals: {
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
        TextDecoder: "readonly",
      },
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
])
