/**
 * jsdom 的最小类型声明。
 *
 * 只在 `billImport.xlsxFixture.test.ts` 里用到:那条测试要用**真实的 xlsx** 跑解析链路,
 * 而 xlsx 解码需要两样浏览器 API —— Node 自带的 `Blob`(有 `.stream()`,用来解 zip)和
 * `DOMParser`(用来读 sheet XML)。jsdom 的 Blob 没有 `.stream()`,所以只能用它的 DOMParser,
 * 于是要在 node 环境里 import 它。
 *
 * 项目没有装 `@types/jsdom`,但这里只需要一个构造器与 `.window`,不值得为它加依赖。
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    window: {
      DOMParser: unknown;
      [key: string]: unknown;
    };
  }
}