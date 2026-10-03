import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Reading a const above its own line is a dead zone, not a hoist. It took
      // the whole app down once — "Cannot access 'timeline' before
      // initialization" — and neither tsc nor the build objected, so the check
      // has to live here. Functions are exempt: they hoist, and components rely
      // on it to read as top-down.
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": ["error", {
        functions: false,
        classes: true,
        variables: true,
        enums: true,
        typedefs: false,
        ignoreTypeReferences: true,
      }],
    },
  },
);
