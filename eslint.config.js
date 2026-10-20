// Lint for bugs, not style. `vite build` passes even when a page references a
// function or component that no longer exists — the page just crashes for
// customers. These rules catch that class of mistake before it ships.
// Runs in CI (npm run lint) alongside the tests.
import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'ds-bundle/**', 'functions/node_modules/**', 'coverage/**'] },
  // The codebase marks deliberate exhaustive-deps choices with disable comments;
  // that rule is off here, so don't report those comments as unused.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },

  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },

  // Site (browser, React)
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-no-undef':     'error',   // <Component> that isn't imported or defined
      'react/jsx-uses-vars':    'error',   // count JSX usage so imports aren't flagged unused
      'react/jsx-key':          'error',   // list items without key
      'react/no-direct-mutation-state': 'error',
      'react-hooks/rules-of-hooks': 'error', // hooks called conditionally → state bugs
    },
  },

  // Cloud Functions (Node, CommonJS)
  {
    files: ['functions/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['functions/**/*.mjs', 'scripts/**/*.mjs', 'tests/**/*.js', '*.config.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
]
