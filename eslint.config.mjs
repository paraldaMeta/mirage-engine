// Mirage original code. ESLint for bugs, not for style: `npm run lint` (part of `npm test`).
// The house style is dense (several statements on a line, comma expressions, short names) and is not this file's
// business: there is no formatting rule here and there must never be one. Every rule below reports something that
// is wrong at run time or dead: an undefined name, a duplicate key, a self-assignment, a comparison with NaN, an
// import or a variable nobody reads. Shader strings, generated bundles and vendored declarations are not linted.
import js from '@eslint/js';
import globals from 'globals';

const BUGS = {
  ...js.configs.recommended.rules,
  // style-flavoured members of "recommended" the house style deliberately breaks
  'no-empty': 'off',                    // `catch {}` and empty loop bodies carry a comment where they matter
  'no-cond-assign': ['error', 'except-parens'],
  'no-sparse-arrays': 'off',            // `[, a]` destructuring-style tables
  'no-control-regex': 'off',            // the wire and PNG code match control bytes on purpose
  'no-prototype-builtins': 'off',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-useless-assignment': 'off',       // dense accumulators (`let a = 0, b = 0;` then both set in a branch)
  'preserve-caught-error': 'off',
  // dead names are bugs waiting (a renamed helper still imported, a result never read). Arguments and destructured
  // siblings stay: callbacks name what they are handed.
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '.' }],
  // more real-bug rules outside "recommended"
  'no-constructor-return': 'error',
  'no-promise-executor-return': 'off',  // `new Promise((r) => setTimeout(r, 300))` everywhere
  'no-self-compare': 'off',             // `x !== x` is the NaN test in the hot paths
  'no-template-curly-in-string': 'off', // GLSL chunks and written-out fixture sources hold `${` on purpose
  'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipComments: true, skipRegExps: true }],
  'no-unreachable-loop': 'error',
  'array-callback-return': ['error', { allowImplicit: true }],
  'no-await-in-loop': 'off',
  'eqeqeq': ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'no-implicit-globals': 'error',
  'no-new-wrappers': 'error',
  'no-throw-literal': 'error',
  'radix': 'off',
};

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/coverage/**', 'site/**', '_site/**', 'packages/game/types/**', 'docs/types/**', 'docs/acceptance/**', '**/*.min.js',
  'agent/mirage-module/references/module-template.js' /* a template with <placeholders>, not a module */] },
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: BUGS },
  // workers
  { files: ['**/*.worker.js'], languageOptions: { globals: { ...globals.worker } } },
];
