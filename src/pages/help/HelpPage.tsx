import { Link } from 'react-router-dom';

export function HelpPage() {
  return (
    <section className="panel help-page vi-page">
      <header className="help-header">
        <h2>帮助与快捷方式</h2>
        <p>把常用入口、上手步骤和一点点贴心提醒都收在这里。首页负责好看，这里负责好用。</p>
      </header>

      <section className="help-block">
        <h3>三步开始使用</h3>
        <ol>
          <li>先添加一笔交易，看看收支、分类和账户字段顺不顺手——别急，第一笔只是热身。</li>
          <li>再打开智能预算或还款管理，确认系统给出的建议不是“看起来很努力”。</li>
          <li>最后去设置页补齐 AI / 备份配置，让分析、导入和同步链路真正闭环。</li>
        </ol>
      </section>

      <section className="help-block">
        <h3>常用快捷方式</h3>
        <div className="help-shortcut-list">
          <p><kbd>N</kbd><span>快速新增一笔交易，手快一点，账就不容易赖掉</span></p>
          <p><kbd>A</kbd><span>打开 AI 助手，适合追问、复盘和让数字说人话</span></p>
          <p><kbd>B</kbd><span>打开 Smart Budget，看看钱有没有偷偷拐弯</span></p>
          <p><kbd>G</kbd><span>回到首页，总览今天和本月的账本状态</span></p>
          <p><kbd>H</kbd><span>打开帮助页，少走弯路，先看地图再冲</span></p>
          <p><kbd>D</kbd><span>打开数据设置 / 备份页，适合同步、导入和恢复前操作</span></p>
          <p><kbd>/</kbd><span>进入交易记录并开始检索，适合追查每一笔“它怎么又出现了”</span></p>
        </div>
      </section>

      <section className="help-block">
        <h3>推荐入口</h3>
        <div className="help-link-grid">
          <Link to="/assistant" className="help-link-card">
            <strong>AI 记账助手</strong>
            <span>适合快速记账、问答分析和收支建议。你负责开口，它负责少走弯路。</span>
          </Link>
          <Link to="/transactions?quickAdd=1&entry=help" className="help-link-card">
            <strong>快速新增交易</strong>
            <span>直接进入新增页，最快开始沉淀第一批流水。是的，从第一笔开始就算数。</span>
          </Link>
          <Link to="/smart-budget" className="help-link-card">
            <strong>Smart Budget</strong>
            <span>做预算、看偏差、调节奏，顺便防止月底的钱先你一步离家出走。</span>
          </Link>
          <Link to="/settings" className="help-link-card">
            <strong>系统设置</strong>
            <span>补齐模型、数据库和同步配置，把幕后工程也收拾利索。</span>
          </Link>
        </div>
      </section>
    </section>
  );
}
