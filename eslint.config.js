export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: await import("@typescript-eslint/parser"),
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": (await import("@typescript-eslint/eslint-plugin"))
        .default,
    },
    rules: {
      "no-console": ["warn", { allow: ["error", "log", "warn"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-function": "warn",
      "prefer-const": "warn",
      "no-var": "error",
    },
  },
  {
    ignores: ["node_modules/", "dist/", "coverage/", "eslint.config.js"],
  },
];
