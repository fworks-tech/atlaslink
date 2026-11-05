// Mirrors AGENTS.md: the same rules run in .githooks/commit-msg and in CI.
const VAGUE_SUBJECTS = [
  'wip',
  'fix stuff',
  'update',
  'update stuff',
  'changes',
  'misc',
  'asdf',
  'temp',
  'cleanup',
  'test123',
]

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-vague-subject': ({ subject }: { subject?: string | null }) => {
          const s = (subject ?? '').trim().toLowerCase()
          return [
            !VAGUE_SUBJECTS.includes(s),
            `subject '${s}' is vague — use a descriptive imperative phrase`,
          ]
        },
      },
    },
  ],
  rules: {
    'no-vague-subject': [2, 'always'],
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'test', 'refactor', 'ci', 'chore', 'revert'],
    ],
    'type-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 150],
    'subject-max-length': [2, 'always', 150],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'body-max-line-length': [2, 'always', 150],
    'body-leading-blank': [1, 'always'],
    'footer-leading-blank': [1, 'always'],
  },
}
