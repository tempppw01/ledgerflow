import { Link } from 'react-router-dom';

const guideSections = [
  { number: '01', title: '从一笔流水开始', description: '先把真实发生的收支记下来，分类和账户不必一次填得完美。', steps: ['点击「记一笔」，填写金额、分类、账户和日期。', '账单较多时，可从交易流水导入微信或支付宝账单。', '记错的流水可以编辑、删除或移入回收站。'], to: '/transactions?quickAdd=1&entry=help', action: '新增一笔交易' },
  { number: '02', title: '让账户余额可信', description: '账户是现金、银行卡、支付账户的容器；分类则解释钱花在了哪里。', steps: ['在「账户与分类」中建立常用账户和支出分类。', '转账请使用转账类型，避免把同一笔钱算成两次支出。', '余额出现差异时，先到余额明细检查最近的变动记录。'], to: '/categories-accounts', action: '管理账户与分类' },
  { number: '03', title: '把未来支出放进计划', description: '预算和还款不是事后统计，而是帮你提前看见压力。', steps: ['用智能预算设定月度总额或分类额度，再根据实际支出调整。', '负债可先用简单录入登记下一次还款日期、项目和金额。', '需要时再补充期数、利率或逐期计划，走势会展示未来还款。'], to: '/repayment-management', action: '查看还款管理' },
  { number: '04', title: '备份、迁移与恢复', description: '业务数据以已选数据库为准；备份用于迁移和意外恢复。', steps: ['首次初始化选择 SQLite 或 MySQL 后，配置会写入持久化数据目录。', '在备份设置中导出 JSON 或配置 WebDAV、对象存储等远端备份。', '恢复前先创建一份新备份；恢复会覆盖对应范围内的数据。'], to: '/database-settings', action: '打开备份设置' }
];

export function HelpPage() {
  return <main className="help-page vi-page" aria-labelledby="help-title">
    <header className="help-header"><p className="help-eyebrow">LedgerFlow 使用指南</p><h1 id="help-title">从记清每一笔，到看懂自己的钱</h1><p>这里按实际使用顺序整理。先完成眼前的一步，其他信息随时可以再补。</p></header>
    <nav className="help-jump-nav" aria-label="帮助章节">{guideSections.map((section) => <a key={section.number} href={`#guide-${section.number}`}>{section.number} {section.title}</a>)}<a href="#help-faq">常见问题</a></nav>
    <section className="help-start-strip" aria-label="快速开始"><div><strong>刚开始使用？</strong><span>先记一笔，再确认账户余额和分类是否符合习惯。</span></div><Link to="/transactions?quickAdd=1&entry=help">开始记账</Link></section>
    <div className="help-guide-list">{guideSections.map((section) => <article id={`guide-${section.number}`} className="help-guide-section" key={section.number}><span className="help-guide-number">{section.number}</span><div className="help-guide-content"><h2>{section.title}</h2><p>{section.description}</p><ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol><Link to={section.to}>{section.action} <span aria-hidden="true">›</span></Link></div></article>)}</div>
    <section id="help-faq" className="help-faq" aria-labelledby="help-faq-title"><header><p className="help-eyebrow">常见问题</p><h2 id="help-faq-title">遇到问题时，先从这里看</h2></header><details><summary>为什么会看到“数据库状态检查暂时失败”？</summary><p>页面暂时无法连接本地 API 或数据库检查接口时，会沿用上次确认的配置继续展示。请确认服务已启动、数据目录可写，再到备份设置中重试检查。</p></details><details><summary>SQLite 数据保存在哪里？</summary><p>容器部署时，SQLite 会写入应用的数据目录。请把该目录挂载到宿主机或持久化卷；只重建容器而未挂载数据目录，数据库文件可能随容器一同丢失。</p></details><details><summary>AI 助手为什么没有回答或无法联网？</summary><p>请在设置中检查模型地址、模型名称和 API Key。联网检索还需要单独完成 Tavily 配置；未配置时，AI 仍可基于本地账本提供分析。</p></details><details><summary>快捷键会在输入框里触发吗？</summary><p>不会。光标在输入框、文本框或可编辑内容中时，快捷键会自动失效。可用 N 新增交易、A 打开助手、B 打开智能预算、G 回到首页、H 打开帮助、D 打开备份设置、/ 打开流水检索。</p></details></section>
  </main>;
}
