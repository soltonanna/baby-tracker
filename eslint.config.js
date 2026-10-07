import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Flat ESLint config for the whole monorepo.
 *
 * Type-aware linting is intentionally NOT enabled: it roughly triples lint time
 * and `tsc --noEmit` (npm run typecheck) already catches type errors. Revisit if
 * we start needing rules like no-floating-promises.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      // Generated from WHO source data by scripts/generate-who-tables.mjs.
      'packages/shared/src/growth/whoTables.ts',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Node-side code
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts', 'scripts/**/*.mjs', '*.js', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Browser-side code
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Run by mongosh, not by Node: its globals are the shell's, and it is a plain
  // script rather than a module.
  {
    files: ['scripts/mongo-init-replset.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        db: 'readonly',
        print: 'readonly',
        quit: 'readonly',
        rs: 'readonly',
        sleep: 'readonly',
      },
    },
  },

  // Shared rules
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  // Must come after the shared rules: flat config is last-match-wins, and the
  // shared block sets `no-console` for every file. The test harness and the setup
  // script talk to the developer on purpose; that is not stray debug output.
  {
    files: ['apps/api/src/test/**/*.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },

  prettier,
);
