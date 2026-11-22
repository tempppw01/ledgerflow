## 属性里的硬编码中文清零 + 闸门

`aria-label` / `title` / `placeholder` 三个属性里写死了 **59 处中文、43 种文案**,
集中在 AI 助手(33 处)与投资页(11 处)。这三个属性永远是界面文案、不可能是用户数据,
写死之后英文界面里就是中文,读屏器还会用中文念出来。

- 43 种文案各建共享 key,55 处替换成 `tf(key, '原文')`
- 6 个原本没有 i18n 助手的组件补上 `useTFallback`
- 顺手修一处脆弱写法:`querySelector('[aria-label="实际还款金额"]')` 改成按 id 查询
- `check-i18n-keys.mjs` 新增 `HARDCODED-ATTR` 闸门(命中即 exit 1),并用测试钉住
