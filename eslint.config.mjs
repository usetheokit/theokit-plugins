import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.tsup/**',
      '**/coverage/**',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  // The gate scripts (#168). Plain `.mjs` outside every tsconfig, so the type-aware program cannot
  // parse them — `projectService` answers "not found by the project service" for all eleven, which
  // is why they were simply left out of `pnpm lint` and ended up the only code in this repository
  // that nothing checked.
  //
  // This block comes LAST so it wins, disables the type-aware rules for exactly those paths, and
  // keeps the recommended set. That set is the point: `no-dupe-keys` lives there, and a duplicate
  // key in `PEER_WITHOUT_USE_EXEMPT` silently dropped a triage entry — an object literal where a
  // missing entry means "nobody looked" reads as "somebody looked".
  {
    files: ['scripts/**/*.mjs', 'tools/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: false },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        fetch: 'readonly',
      },
    },
  },
)
