import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage', '.audit', '.playwright-cli', '.husky/_', '.tmp*'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, eslintConfigPrettier],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  /*
   * server/ 与 scripts/ 的 .js / .mjs 也要 lint。
   *
   * 上面那条只匹配 TS/TSX,于是这两处**完全没有静态检查** —— 而 tsconfig 也只 include 了 src,
   * 所以它们连 tsc 都不走。2026-11-25 给它们套上 JS 规则后,no-undef 立刻报出
   * `server/relationalDatabase.js` 里一个**用了却没定义也没 import** 的 `toMysqlDate`:
   * 那行走在 MySQL 迁移路径上,任何 MySQL 用户首次建库/升级都会 ReferenceError 后回滚。
   *
   * 规则里加了"下划线开头视为刻意忽略"(解构时丢掉的字段),与 TS 侧 noUnusedLocals 的写法一致;
   * globals 同时给 node 与 browser —— scripts/ 里既有纯 Node 脚本,也有跑浏览器的审计脚本。
   */
  {
    extends: [js.configs.recommended, eslintConfigPrettier],
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
);
