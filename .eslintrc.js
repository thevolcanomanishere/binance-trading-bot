module.exports = {
  env: {
    commonjs: true,
    es6: true,
    node: true,
  },
  extends: [
    'airbnb',
  ],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly',
  },
  parserOptions: {
    ecmaVersion: 2018,
  },
  rules: {
    "no-console": 0,
    'import/newline-after-import': 0,
    'func-names': 0,
    'max-len': 0,
    'no-underscore-dangle': 0,
    'no-console': 0,
    'camelcase': 0,
    'no-param-reassign': 0,
    'no-restricted-syntax': 0,
    'space-before-function-paren': 0,
    'no-multi-spaces': 0,
    'no-await-in-loop': 0,
    'no-use-before-define': 0,
    'no-plusplus': ["error", { "allowForLoopAfterthoughts": true }]
  },
  "overrides": [
    {
      "files": [ "**/*.js" ],
      "excludedFiles": "**/*.ejs"
    }
  ]
};
