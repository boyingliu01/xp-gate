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
    files: ["src/**/__tests__/**/*.ts", "src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // #581: `.stryker-tmp/` holds Stryker's sandbox copies of `src/`. It is
    // already gitignored (.gitignore:119) but was not ignored here, so any
    // machine that had run mutation testing linted the copies too: 73 problems
    // locally (64 errors, all inside the sandbox) versus 8 warnings in CI for
    // the same commit. A lint result that depends on whether you ran Stryker is
    // a result nobody can trust.
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      "src/npm-package/coverage/",
      ".stryker-tmp/",
      // #581, same reasoning: Delphi review artifacts under `.delphi-work/` are
      // gitignored working copies, not source. Leaving them in scope let a stray
      // probe script add warnings that exist on one machine only.
      ".delphi-work/",
      "eslint.config.js",
      "githooks/",
      ".github/",
    ],
  },
];
