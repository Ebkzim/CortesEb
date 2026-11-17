import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '*.config.js',
      'src/generated/**',
      'web/**',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './remotion/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'no-console': 'error',
      'no-warning-comments': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unsafe-class-instance-assignment': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
);
