# 依赖兼容性审计

> 起因:PDF 导出功能 100% 失败,根因是两个库之间的**运行时 API 契约断层**,
> 而这类问题包管理器根本发现不了。本文件记录审计范围与结论,供后续升级参考。

## 一、这次踩到的坑(pdf-lib ↔ fontkit)

| | 情况 |
| --- | --- |
| 装的是 | `pdf-lib@1.17.1`(2021 年发布,也是该库最后一个版本)+ `fontkit@2.0.4` |
| 现象 | 导出 PDF 必失败,toast 显示 `_this.subset.encodeStream is not a function` |
| 真实原因 | pdf-lib 1.17 做字体子集化时要求 `subset.encodeStream()` 返回**可 pipe 的 Node 流**(要 `.on`),而 fontkit v2 把这套接口去掉了,只留 `encode()`(返回字节) |
| 为什么包管理器没报 | 两者**没有**互相声明 peerDependency,是隐式的运行时契约,`npm ls` / peer 校验都看不见 |
| 为什么 try/catch 兜不住 | 异常在 `pdfDoc.save()` 阶段抛出,不在 `embedFont()` 里 |
| 当前处理 | `embedFont(fontBytes, { subset: false })`,导出可用;代价是内嵌整套中文字体,PDF 约 6 MB |
| 更优解 | 把 `fontkit` 降到 1.x,或改用官方配套的 `@pdf-lib/fontkit`(本机 npm registry 不可达,暂无法安装) |

**教训**:凡是「A 库把数据交给 B 库处理」的链路,都要有一个真正跑一遍的测试。
单测里若把这类依赖 mock 掉,就永远发现不了。

## 二、本次审计做了什么

审计方式(离线可跑,不依赖 registry):

1. **声明 vs 实际安装**:逐个比对 `package.json` 的范围与 `node_modules` 里的真实版本
   - 结果:**38 个依赖全部安装且落在声明范围内,0 处不符**
2. **peerDependency 满足性**:读取每个包声明的 `peerDependencies`,用支持
   `||` 多分支、`^` / `~` / `>=` 的比较器逐个校验
   - 结果:**0 处不满足**
   - 注:第一版比较器只取 `||` 的第一个分支,误报了 5 条(如
     `react@18.3.1` 其实满足 `^16.8.0 || ^17 || ^18 || ^19`);
     修正比较器后归零 —— **这类脚本自身也要验证,否则会造假警报**。

未做(受环境限制):`npm audit`(需联网)、过期/弃用包在线查询。

## 三、已知的长期风险点

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| `pdf-lib@1.17.1` 已停更 | 2021 年最后一次发布,后续 fontkit 演进会和它持续脱节 | 评估迁移到维护中的 PDF 库,或锁死 `fontkit@1.x` |
| PDF 体积 | 关闭子集化后每次导出约 6 MB | 恢复子集化(降 fontkit)或换子集化字体 |
| 中文字体 10.5 MB | 每次导出都要前端拉全量 | 用子集化字体,或按需裁字 |
| 前端直接依赖 `node:sqlite`? | 仅服务端使用;Node 版本需满足内置模块要求 | 保持 CI 与本地 Node 版本一致 |

## 四、建议固化的检查

- [x] `npm run check:r2-fetch` —— 禁止 `fetch()` 直连 R2 公共域名(CORS)
- [ ] 依赖契约冒烟测试:对「A 库产出交给 B 库消费」的链路(如 PDF 导出、
  xlsx 导出)至少保留一条不打 mock 的端到端用例
- [ ] CI 里加 `tsc` / `eslint` / `vitest` / 上述 check 脚本,作为合并前门禁

## 五、尝试用 jsdom 单测守这条链路 —— 不可行(已验证)

想法:写一条不 mock pdf-lib / fontkit 的单测,喂真实 TTF,断言产出合法 PDF。
实测结论是**这条路走不通**,原因值得记下来:

| 环境 | `pdf-lib@1.17.1` + `fontkit@2.0.4` |
| --- | --- |
| 浏览器(生产) | **可用** —— 实际导出 6.13 MB 合法 PDF 并触发下载 |
| 纯 Node | **失败**:`Cannot read properties of undefined (reading 'tables')` |
| vitest(jsdom) | **失败**:同上 |

同一套代码在浏览器能跑、在 Node 跑不了,说明 fontkit v2 在不同构建入口
(Node/browser)下的行为不一致,pdf-lib 1.17 只与浏览器那套对得上。
因此**任何 jsdom 单测都无法忠实复现这条链路** —— 写出来是红用例,而且红得
没有产品意义。

顺带还踩到一个坑:该模块用**模块级缓存**保存字体字节
(`cachedFontBytesPromise`),同一测试文件里的多条用例会互相污染
(前一条成功了,后一条就走不到 fetch)。真要写多用例,得配合
`vi.resetModules()`。

**推荐的正确做法**:用仓库已有的 `playwright.config.ts` 写一条真浏览器
E2E —— 打开交易页、勾选、点导出、断言下载事件 + PDF 文件头。这才是能
抓住这类断层的手段。

## 六、PDF 体积的后续

当前 `subset: false` 让导出可用但偏大(约 6 MB)。要恢复小体积需要
`fontkit@1.x` 或 `@pdf-lib/fontkit`,都需要能访问 npm registry —— 本次
环境不可达,故未做。恢复子集化后,请重跑一次真实浏览器导出验证。

## 七、生产构建在受限环境下的一个坑(已解决)

现象:`npm run build` 失败,报

```
[vite:esbuild-transpile] remove C:\Users\<user>\AppData\Local\Temp\esbuild-...: Access is denied.
```

注意失败点在**很靠后**:vite 已经打出 `✓ 537 modules transformed`、PWA 也
生成了,然后才在 esbuild 清理临时目录时炸掉。所以它看着像构建挂了,实际
代码是好的。

原因:esbuild 会在系统临时目录里建工作目录再删掉,而当前沙箱对
`%LOCALAPPDATA%\Temp` 下的删除操作受限。清空历史遗留的 `esbuild-*` 目录
**没用**(新的照样删不掉)。

解决办法:把临时目录指到工作区内(工作区可写可删):

```bash
mkdir -p .tmp-build
TEMP="$PWD/.tmp-build" TMP="$PWD/.tmp-build" TMPDIR="$PWD/.tmp-build" npm run build
```

结果:`✓ built in 3.36s`,PWA precache 45 entries(3749.51 KiB)。

顺带记录构建产物规模,便于日后观察劣化:

| chunk | 体积 | gzip |
| --- | --- | --- |
| vendor | 428.16 KB | 234.14 KB |
| vendor-pdf | 466.96 KB | 127.88 KB |
| index | 470.65 KB | 155.98 KB |

`vendor-pdf` 是 pdf-lib + fontkit,动态导入,只在导出时才加载 —— 这个拆分是
对的,不要把导出相关依赖打进主包。

注意:`.tmp-build` 与 `dist` 都不该入库(`dist` 已在 `.gitignore`)。