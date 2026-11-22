## JSX 文本节点硬编码中文清零(120 → 0),闸门进 CI

- 收编 `AssistantPage` 信贷识别流程 119 处 + 收尾 14 处
- 顺带把模块级 helper `renderCreditCardSkeleton` 改成真组件 `CreditCardSkeleton`,
  它返回 JSX 却拿不到 hook,里面的文案无法翻译
- 扫描器跳过外层 `aria-hidden="true"` 的装饰性文字(品牌字标)
- 新增 `npm run i18n:check-jsx`(有存量即 exit 1)

两个反复踩到的坑:全角标点(`下一步:` 的冒号)+ 行号偏移(按行替换一度覆盖结构行)。
可靠做法是从文件取原文、按提取顺序定位。
