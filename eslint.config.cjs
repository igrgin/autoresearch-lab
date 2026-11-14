const js = require('@eslint/js');
const ts = require('typescript-eslint');
const globals = require('globals');
module.exports = ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.cjs'], languageOptions: { globals: globals.node }, rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { files: ['scripts/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['src/**/*.{ts,tsx}'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
