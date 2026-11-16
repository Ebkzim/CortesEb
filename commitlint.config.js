export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 72],
    'body-empty': [2, 'always'],
    'footer-empty': [2, 'always'],
    'subject-case': [2, 'always', 'lower-case'],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'refactor',
        'perf',
        'test',
        'docs',
        'build',
        'ci',
        'style',
        'revert',
      ],
    ],
  },
};
