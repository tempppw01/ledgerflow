# 变更索引

> 这份文件由 `node scripts/generate-changelog.mjs` 从 `release-notes/` 生成,**不要手改**。
> 每条右侧链接指向该版本的完整说明。

## 0.52.x

| 版本 | 说明 |
| --- | --- |
| [v0.52.3](release-notes/RELEASE_NOTES_v0.52.3.md) | 同一个页面,名字在三个地方不再各说各话;死代码闸门补上两个洞 |
| [v0.52.2](release-notes/RELEASE_NOTES_v0.52.2.md) | 首屏少下 2.3 MB;投资页不再把同一轮行情打六遍 |
| [v0.52.1](release-notes/RELEASE_NOTES_v0.52.1.md) | 投资页两处「说的和做的不一致」:简报的结论、快讯的 AI 解读 |
| [v0.52.0](release-notes/RELEASE_NOTES_v0.52.0.md) | 新:关于页的「最近更新」—— 版本记录 + 中文说明 |

## 0.51.x

| 版本 | 说明 |
| --- | --- |
| [v0.51.0](release-notes/RELEASE_NOTES_v0.51.0.md) | 新:美股盘前 / 盘后 —— 标记 + 倒计时 |

## 0.50.x

| 版本 | 说明 |
| --- | --- |
| [v0.50.58](release-notes/RELEASE_NOTES_v0.50.58.md) | 修:两条"看着改了、其实一个字都没生效"的窄屏规则,以及键盘看不到的焦点 |
| [v0.50.57](release-notes/RELEASE_NOTES_v0.50.57.md) | 修:触摸端和"系统偏好"这一层,之前基本没管 |
| [v0.50.56](release-notes/RELEASE_NOTES_v0.50.56.md) | 修:一批"看着没事、实际坏了"的样式问题 |
| [v0.50.55](release-notes/RELEASE_NOTES_v0.50.55.md) | 修:6 处无障碍问题,其中两处是**功能坏了**,不只是"体验不好" |
| [v0.50.54](release-notes/RELEASE_NOTES_v0.50.54.md) | 修:备注里带换行的账单,整笔交易会**静默消失** |
| [v0.50.53](release-notes/RELEASE_NOTES_v0.50.53.md) | 修:「上传微信账单失败」还有一个漏网的情况 |
| [v0.50.52](release-notes/RELEASE_NOTES_v0.50.52.md) | 修:新用户想导入账单,**找不到入口** |
| [v0.50.51](release-notes/RELEASE_NOTES_v0.50.51.md) | 订阅生成支出:补上四条不变量,并修一处会误导人的提示 |
| [v0.50.50](release-notes/RELEASE_NOTES_v0.50.50.md) | 补上「再记一笔」的测试 —— 这条我当初明说没有单测 |
| [v0.50.49](release-notes/RELEASE_NOTES_v0.50.49.md) | 修:「主题色」被写死成琥珀 —— 六套配色只有一套生效 |
| [v0.50.48](release-notes/RELEASE_NOTES_v0.50.48.md) | 「分类学习」曾经是个空壳 —— 现在真的能用了 |
| [v0.50.47](release-notes/RELEASE_NOTES_v0.50.47.md) | 分类推断:补上真实商户名的关键词 |
| [v0.50.46](release-notes/RELEASE_NOTES_v0.50.46.md) | 修:导入的账单全部变成「餐饮」 |
| [v0.50.45](release-notes/RELEASE_NOTES_v0.50.45.md) | 修:余额变动页,备注过长会把界面撑开 |
| [v0.50.44](release-notes/RELEASE_NOTES_v0.50.44.md) | 修:「上传微信账单失败」——xlsx 里的日期是 Excel 序列号 |
| [v0.50.43](release-notes/RELEASE_NOTES_v0.50.43.md) | 修:「添加了个股,但是无法看到净值」 |
| [v0.50.42](release-notes/RELEASE_NOTES_v0.50.42.md) | 股票/指数行情加了故障转移:Yahoo 挂了自动换东财、新浪 |
| [v0.50.41](release-notes/RELEASE_NOTES_v0.50.41.md) | 记一笔:「再记一笔」 |
| [v0.50.40](release-notes/RELEASE_NOTES_v0.50.40.md) | 设置页新增两项:默认打开页面、本位币 |
| [v0.50.39](release-notes/RELEASE_NOTES_v0.50.39.md) | 美股:支持盘前 / 盘后实时显示 |
| [v0.50.38](release-notes/RELEASE_NOTES_v0.50.38.md) | 状态会影响钱,现在界面会告诉你 |
| [v0.50.37](release-notes/RELEASE_NOTES_v0.50.37.md) | 选「预算」时,表单会说明它到底算什么 |
| [v0.50.36](release-notes/RELEASE_NOTES_v0.50.36.md) | 「预算」型交易不再被算作支出 |
| [v0.50.35](release-notes/RELEASE_NOTES_v0.50.35.md) | 不再让「旧窗口的快照」覆盖掉别处已经保存的数据 |
| [v0.50.34](release-notes/RELEASE_NOTES_v0.50.34.md) | 不再允许「彻底删除还有交易的账户」 |
| [v0.50.33](release-notes/RELEASE_NOTES_v0.50.33.md) | 发给模型的账本合计,把退款又算成了一笔支出 |
| [v0.50.32](release-notes/RELEASE_NOTES_v0.50.32.md) | 从回收站恢复「生成支出」写出的流水时,续费日没有推回去 |
| [v0.50.31](release-notes/RELEASE_NOTES_v0.50.31.md) | 单条「彻底删除」一按就删,没有确认;账户还带着看不见的后果 |
| [v0.50.30](release-notes/RELEASE_NOTES_v0.50.30.md) | 服务端丢记录时不再静默 |
| [v0.50.29](release-notes/RELEASE_NOTES_v0.50.29.md) | 离线记的账,关掉页面就没了 —— 而且事后毫无痕迹 |
| [v0.50.28](release-notes/RELEASE_NOTES_v0.50.28.md) | 直接访问 /login 登录后,落在「这个页面不存在」 |
| [v0.50.27](release-notes/RELEASE_NOTES_v0.50.27.md) | 预算向导从写死的 ¥10,000 开始,无视你已登记的月收入 |
| [v0.50.26](release-notes/RELEASE_NOTES_v0.50.26.md) | 同一份账单,既被判成「是同一笔」,又被判成「有变化」 |
| [v0.50.25](release-notes/RELEASE_NOTES_v0.50.25.md) | 重复导入账单时,「同一天」被日期格式判成「有变化」 |
| [v0.50.24](release-notes/RELEASE_NOTES_v0.50.24.md) | 助手说「本周比上周多了 X%」时,其实是按行号切的 |
| [v0.50.23](release-notes/RELEASE_NOTES_v0.50.23.md) | 助手导入账单:分类说不清时,被悄悄归到「碰巧排第一」的分类上 |
| [v0.50.22](release-notes/RELEASE_NOTES_v0.50.22.md) | 预算为 0 的分类:显示「超支」,却写着「执行率 0.0%」 |
| [v0.50.21](release-notes/RELEASE_NOTES_v0.50.21.md) | 「本月可投资现金」有两份实现,两处都错、错法还不一样 |
| [v0.50.20](release-notes/RELEASE_NOTES_v0.50.20.md) | 助手说「这个月花了多少钱」时,把退款当成了又花一笔 |
| [v0.50.19](release-notes/RELEASE_NOTES_v0.50.19.md) | 信用草稿的金额不取整,会带着三位小数落库 |
| [v0.50.18](release-notes/RELEASE_NOTES_v0.50.18.md) | 删掉订阅生成的那笔支出,续费日不退 —— 再生成就整整跳过一期 |
| [v0.50.17](release-notes/RELEASE_NOTES_v0.50.17.md) | 恢复一笔「已退款」的支出,退款单却留在回收站里 —— 账上凭空少一笔 |
| [v0.50.16](release-notes/RELEASE_NOTES_v0.50.16.md) | 助手导入的账单,状态列显示成「-」,却能被「已完成」筛出来 |
| [v0.50.15](release-notes/RELEASE_NOTES_v0.50.15.md) | 助手里的金额取整,和全项目不是同一套算法 |
| [v0.50.14](release-notes/RELEASE_NOTES_v0.50.14.md) | 助手把账单记到了一个不存在的账户上 + 口径统一(5 个提交) |
| [v0.50.13](release-notes/RELEASE_NOTES_v0.50.13.md) | 财务分析:资金动态看板把退款算成了「又花一笔钱」 |
| [v0.50.12](release-notes/RELEASE_NOTES_v0.50.12.md) | 恢复一份备份,会把用户教给 App 的分类纠正整批清空 |
| [v0.50.11](release-notes/RELEASE_NOTES_v0.50.11.md) | 「变动后余额」这一列,在列表里根本接不上 |
| [v0.50.10](release-notes/RELEASE_NOTES_v0.50.10.md) | 重复点「生成支出」,人会被丢进已有那笔交易的编辑页 |
| [v0.50.9](release-notes/RELEASE_NOTES_v0.50.9.md) | 两个「结清」做的事不一样,其中一个还是无确认的一键清零 |
| [v0.50.8](release-notes/RELEASE_NOTES_v0.50.8.md) | 撤销 AI 助手登记的还款,本金会凭空多出一笔 |
| [v0.50.7](release-notes/RELEASE_NOTES_v0.50.7.md) | 删除有退款的支出,会凭空多出钱 |
| [v0.50.6](release-notes/RELEASE_NOTES_v0.50.6.md) | 健康度接上节奏预测:11 月 23 日就用完整月预算,不再叫「节奏可控」 |
| [v0.50.5](release-notes/RELEASE_NOTES_v0.50.5.md) | 三处「界面给出的结论和事实对不上」 |
| [v0.50.4](release-notes/RELEASE_NOTES_v0.50.4.md) | 刚性与灵活:住房不再从「灵活预算」里分 ¥200 |
| [v0.50.3](release-notes/RELEASE_NOTES_v0.50.3.md) | 分类重名:两个「什么都没发生」的坑一起补掉 |
| [v0.50.2](release-notes/RELEASE_NOTES_v0.50.2.md) | 「简单录入」的负债刷新后内容全丢:三个字段从来没进过库 |
| [v0.50.1](release-notes/RELEASE_NOTES_v0.50.1.md) | 电子钱包账户消失了:一份写在前、类型补在后的白名单 |
| [v0.50.0](release-notes/RELEASE_NOTES_v0.50.0.md) | 分类终于能「两级」用了 —— 点开、原地加,而且真的存下来了 |

## 0.49.x

| 版本 | 说明 |
| --- | --- |
| [v0.49.3](release-notes/RELEASE_NOTES_v0.49.3.md) | 两个「用户看得见,但没人报告」的缺口:断网时的英文串、保存后的沉默 |
| [v0.49.2](release-notes/RELEASE_NOTES_v0.49.2.md) | 新用户的第一个画面:先是「没数据」,然后才是「记第一笔」 |
| [v0.49.1](release-notes/RELEASE_NOTES_v0.49.1.md) | 卸载之后还在跑的定时器:一个让 CI「测试全过却红」的真实缺陷 |
| [v0.49.0](release-notes/RELEASE_NOTES_v0.49.0.md) | 概览页的「门面」,以及一个再也别靠肉眼找问题的体检工具 |

## 0.48.x

| 版本 | 说明 |
| --- | --- |
| [v0.48.0](release-notes/RELEASE_NOTES_v0.48.0.md) | 数据出入口与移动端:四处「看起来正常,其实不工作」的毛病 |

## 0.47.x

| 版本 | 说明 |
| --- | --- |
| [v0.47.0](release-notes/RELEASE_NOTES_v0.47.0.md) | 数据完整性:备份里的东西终于齐了 |

## 0.46.x

| 版本 | 说明 |
| --- | --- |
| [v0.46.0](release-notes/RELEASE_NOTES_v0.46.0.md) | 明细页可用性、金额一致性、以及一批性能优化 |

## 0.45.x

| 版本 | 说明 |
| --- | --- |
| [v0.45.0](release-notes/RELEASE_NOTES_v0.45.0.md) | 性能与「让防护真正生效」 |

## 0.44.x

| 版本 | 说明 |
| --- | --- |
| [v0.44.0](release-notes/RELEASE_NOTES_v0.44.0.md) | 一致性:日期归属、跨页选择、跨实体引用 |

## 0.43.x

| 版本 | 说明 |
| --- | --- |
| [v0.43.0](release-notes/RELEASE_NOTES_v0.43.0.md) | 状态一致性:日期归属、跨实体引用、随机扫描 |

## 0.42.x

| 版本 | 说明 |
| --- | --- |
| [v0.42.0](release-notes/RELEASE_NOTES_v0.42.0.md) | 口语输入的正确性 |

## 0.41.x

| 版本 | 说明 |
| --- | --- |
| [v0.41.0](release-notes/RELEASE_NOTES_v0.41.0.md) | 账单导入与金额的正确性 |

## 0.40.x

| 版本 | 说明 |
| --- | --- |
| [v0.40.0](release-notes/RELEASE_NOTES_v0.40.0.md) | 分类身份只用 id |

## 0.39.x

| 版本 | 说明 |
| --- | --- |
| [v0.39.0](release-notes/RELEASE_NOTES_v0.39.0.md) | 状态与退款的「单一事实来源」 |

## 0.38.x

| 版本 | 说明 |
| --- | --- |
| [v0.38.0](release-notes/RELEASE_NOTES_v0.38.0.md) | 数据正确性一批:日期、统计口径、备份、退款、导入 |

## 0.37.x

| 版本 | 说明 |
| --- | --- |
| [v0.37.0](release-notes/RELEASE_NOTES_v0.37.0.md) | 订阅「已逾期」判定改成按本地日历日,不再随经度漂移 |

## 0.36.x

| 版本 | 说明 |
| --- | --- |
| [v0.36.0](release-notes/RELEASE_NOTES_v0.36.0.md) | 修正订阅续费日期在负时区下跳月(UTC-5 会把 1月31日 推到 3月1日) |

## 0.35.x

| 版本 | 说明 |
| --- | --- |
| [v0.35.0](release-notes/RELEASE_NOTES_v0.35.0.md) | 全局焦点环:键盘用户终于能看见焦点在哪 |

## 0.34.x

| 版本 | 说明 |
| --- | --- |
| [v0.34.0](release-notes/RELEASE_NOTES_v0.34.0.md) | 主按钮对比度 2.15 → 8.14 |

## 0.33.x

| 版本 | 说明 |
| --- | --- |
| [v0.33.0](release-notes/RELEASE_NOTES_v0.33.0.md) | 表格表头补 `scope="col"` 与 `aria-sort` |

## 0.32.x

| 版本 | 说明 |
| --- | --- |
| [v0.32.0](release-notes/RELEASE_NOTES_v0.32.0.md) | 助手「今日待办」文案收进资源,并说明这类为什么不做全局闸门 |

## 0.31.x

| 版本 | 说明 |
| --- | --- |
| [v0.31.0](release-notes/RELEASE_NOTES_v0.31.0.md) | JSX 文本节点硬编码中文清零(120 → 0),闸门进 CI |

## 0.30.x

| 版本 | 说明 |
| --- | --- |
| [v0.30.0](release-notes/RELEASE_NOTES_v0.30.0.md) | 删除零引用的工作台展示层与 TagsPage |

## 0.29.x

| 版本 | 说明 |
| --- | --- |
| [v0.29.0](release-notes/RELEASE_NOTES_v0.29.0.md) | 异步错误与状态文案接入 live region |

## 0.28.x

| 版本 | 说明 |
| --- | --- |
| [v0.28.0](release-notes/RELEASE_NOTES_v0.28.0.md) | 投资页定投模拟面板文案收进资源(173 → 154) |

## 0.27.x

| 版本 | 说明 |
| --- | --- |
| [v0.27.0](release-notes/RELEASE_NOTES_v0.27.0.md) | JSX 文本节点硬编码盘点(226 → 173),并发现 13 个没人渲染的组件 |

## 0.26.x

| 版本 | 说明 |
| --- | --- |
| [v0.26.0](release-notes/RELEASE_NOTES_v0.26.0.md) | 属性里的硬编码中文清零 + 闸门 |

## 0.10.x

| 版本 | 说明 |
| --- | --- |
| [v0.10.0](release-notes/RELEASE_NOTES_v0.10.0.md) | Highlights |

## 0.8.x

| 版本 | 说明 |
| --- | --- |
| [v0.8.9](release-notes/RELEASE_NOTES_v0.8.9.md) | Highlights |
| [v0.8.8](release-notes/RELEASE_NOTES_v0.8.8.md) | Highlights |
| [v0.8.7](release-notes/RELEASE_NOTES_v0.8.7.md) | Highlights |
| [v0.8.6](release-notes/RELEASE_NOTES_v0.8.6.md) | Highlights |
| [v0.8.5](release-notes/RELEASE_NOTES_v0.8.5.md) | Highlights |
| [v0.8.4](release-notes/RELEASE_NOTES_v0.8.4.md) | Highlights |
| [v0.8.3](release-notes/RELEASE_NOTES_v0.8.3.md) | Highlights |
| [v0.8.2](release-notes/RELEASE_NOTES_v0.8.2.md) | Highlights |
| [v0.8.1](release-notes/RELEASE_NOTES_v0.8.1.md) | Highlights |
| [v0.8.0](release-notes/RELEASE_NOTES_v0.8.0.md) | Highlights |

## 0.7.x

| 版本 | 说明 |
| --- | --- |
| [v0.7.1](release-notes/RELEASE_NOTES_v0.7.1.md) | Highlights |
| [v0.7.0](release-notes/RELEASE_NOTES_v0.7.0.md) | Highlights |

## 0.6.x

| 版本 | 说明 |
| --- | --- |
| [v0.6.6](release-notes/RELEASE_NOTES_v0.6.6.md) | Highlights |
| [v0.6.5](release-notes/RELEASE_NOTES_v0.6.5.md) | Highlights |
| [v0.6.4](release-notes/RELEASE_NOTES_v0.6.4.md) | 大盘历史与定投模拟 |
| [v0.6.3](release-notes/RELEASE_NOTES_v0.6.3.md) | 数据库与多账号 |

## 0.5.x

| 版本 | 说明 |
| --- | --- |
| [v0.5.6](release-notes/RELEASE_NOTES_v0.5.6.md) | ✨ Highlights |
| [v0.5.5](release-notes/RELEASE_NOTES_v0.5.5.md) | ✨ Highlights |
| [v0.5.1](release-notes/RELEASE_NOTES_v0.5.1.md) | ✨ Highlights |
| [v0.5.0](release-notes/RELEASE_NOTES_v0.5.0.md) | ✨ Highlights |

## 0.4.x

| 版本 | 说明 |
| --- | --- |
| [v0.4.9](release-notes/RELEASE_NOTES_v0.4.9.md) | 发布日期 |
| [v0.4.8](release-notes/RELEASE_NOTES_v0.4.8.md) | 发布日期 |
| [v0.4.7](release-notes/RELEASE_NOTES_v0.4.7.md) | 发布日期 |
| [v0.4.6](release-notes/RELEASE_NOTES_v0.4.6.md) | 版本定位 |
| [v0.4.5](release-notes/RELEASE_NOTES_v0.4.5.md) | 版本定位 |
| [v0.4.4](release-notes/RELEASE_NOTES_v0.4.4.md) | 本版重点 |
| [v0.4.3](release-notes/RELEASE_NOTES_v0.4.3.md) | 版本定位 |
| [v0.4.2](release-notes/RELEASE_NOTES_v0.4.2.md) | 亮点更新 |
