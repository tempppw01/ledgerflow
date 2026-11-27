/**
 * 关于页「最近更新」用的数据 —— **由脚本生成,不要手改**。
 *
 * 生成:node scripts/generate-release-history.mjs
 * 核对:node scripts/check-release-history.mjs(CI 里跑;与 release-notes 不一致就非 0 退出)
 *
 * 为什么是生成的文件、而不是运行时去读或去请求:
 *   · `release-notes/` 被 .dockerignore 排除,镜像里没有这些 markdown,前端 import 不到;
 *   · 运行时请求 GitHub API 会引入网络依赖与限流(关于页的"检查更新"是用户主动点的,
 *     这里不该变成每次打开页面都打一次外部接口)。
 * 抽取规则与取舍写在 scripts/lib/releaseHistory.mjs 的头部注释里。
 */

export interface ReleaseHistoryEntry {
  /** 版本号,与 package.json 的 version、tag 去掉 `v` 之后一致 */
  readonly version: string;
  /** 该版本的发布日期(YYYY-MM-DD);取不到时是 null */
  readonly publishedOn: string | null;
  /** 发布说明标题(第一个 `## ` 行) */
  readonly title: string;
  /** 发布说明正文的第一段,超过 150 字按整句截断 */
  readonly summary: string;
}

/** 数据里保留的版本数,兜底测试与文档引用它。 */
export const RELEASE_HISTORY_LIMIT = 10;

/**
 * 最近的 10 个版本,新的在前。
 *
 * prettier-ignore:这一段是生成出来的,逐字节就是提交进仓库的内容
 * (check-release-history.mjs 按原文比对),所以不要让格式化器改动它。
 */
// prettier-ignore
export const RELEASE_HISTORY: readonly ReleaseHistoryEntry[] = [
  {
    version: '0.51.0',
    publishedOn: '2026-11-27',
    title: '新:美股盘前 / 盘后 —— 标记 + 倒计时',
    summary: '行情卡片上早就有「盘前 / 盘后」这两个字,但没有时间感:看不出这一段还有多久结束、下一段什么时候开始、现在是周五晚上所以要等到下周一。这一版把它补齐。'
  },
  {
    version: '0.50.58',
    publishedOn: '2026-11-27',
    title: '修:两条"看着改了、其实一个字都没生效"的窄屏规则,以及键盘看不到的焦点',
    summary: '上一批修的是"该有的响应没有"(触摸端的悬停守卫、系统偏好)。这一批是同一层里更难看见的一类:声明写了,浏览器不执行,而且不报错 —— 以及一个键盘用户 Tab 过去什么都看不到的按钮。两条都是"读代码觉得没问题、量了才发现"的,所以这一批的重点也在怎么让它们以后自动被抓出来。'
  },
  {
    version: '0.50.57',
    publishedOn: '2026-11-27',
    title: '修:触摸端和"系统偏好"这一层,之前基本没管',
    summary: '上一批发的是"界面到底有没有按设计渲染出来"。这一批往下一层:前端的规范文档(Apple 的流体界面/可访问性那套、WCAG 的判据)里明确要求、而这个项目一处都没响应的地方。'
  },
  {
    version: '0.50.56',
    publishedOn: '2026-11-27',
    title: '修:一批"看着没事、实际坏了"的样式问题',
    summary: '这一轮的主题不是加功能,而是把界面到底有没有按设计渲染出来这件事量一遍。一共 39 个提交,没有一个是靠"读代码觉得不对"改的 —— 每一条都有截图、计算样式或浏览器实测数据支撑。有三条属于用户能直接踩到的问题,先说这三条。'
  },
  {
    version: '0.50.55',
    publishedOn: '2026-11-25',
    title: '修:6 处无障碍问题,其中两处是功能坏了,不只是"体验不好"',
    summary: '这一轮不再修账务逻辑,而是对照 W3C WCAG 2.2 逐条实测"这个界面到底能不能用"。一共修了 6 项,但真正值得先说清楚的是其中两条 —— 它们不是"少个标签",而是功能对特定用户完全不可用。'
  },
  {
    version: '0.50.54',
    publishedOn: '2026-11-25',
    title: '修:备注里带换行的账单,整笔交易会静默消失',
    summary: '继续用"造真实形状的输入去撞"的办法。这轮撞的是 CSV 的几个脏情况…'
  },
  {
    version: '0.50.53',
    publishedOn: '2026-11-25',
    title: '修:「上传微信账单失败」还有一个漏网的情况',
    summary: '上次修完「wps 里日期是 Excel 序列号 → 解析 0 条」(v0.50.44),我验证用的是你发来的那份微信账单,它能正常导入。这轮我想做一次端到端验证,于是自己造了一份同结构的 xlsx(openpyxl 生成):前置 17 行、表头、6 条数据(含 1 笔中性交易)、日期同样是序列号。'
  },
  {
    version: '0.50.52',
    publishedOn: '2026-11-25',
    title: '修:新用户想导入账单,找不到入口',
    summary: '本来想做「导入链路」的端到端验证:把一个新账号打开交易页看看。结果发现空状态的文案写着…'
  },
  {
    version: '0.50.51',
    publishedOn: '2026-11-25',
    title: '订阅生成支出:补上四条不变量,并修一处会误导人的提示',
    summary: '「订阅 → 生成支出」这个函数有四个不变量,一条测试都没有(features/subscriptions/model 里测的是品牌图标与状态,不是它)…'
  },
  {
    version: '0.50.50',
    publishedOn: '2026-11-25',
    title: '补上「再记一笔」的测试 —— 这条我当初明说没有单测',
    summary: 'v0.50.41 上线「再记一笔」时,我在发布说明里写了一句实话:只有浏览器+数据库验证,没有单测。这轮把它补上,做法不是硬测页面,而是把与界面无关的逻辑抽出来…'
  }
];
