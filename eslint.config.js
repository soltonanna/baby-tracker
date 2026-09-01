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
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Node-side code
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts', '*.js', '*.ts'],
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

  // The test harness reports which MongoDB it chose; that is its job.
  {
    files: ['apps/api/src/test/**/*.ts'],
    rules: { 'no-console': 'off' },
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

  prettier,
);
