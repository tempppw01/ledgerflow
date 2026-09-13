import { SalaryToolCard } from './SalaryToolCard';

export function SalaryToolsPage() {
  return (
    <div className="page-stack finance-page vi-page finance-salary-workbench">
      <header className="finance-salary-hero">
        <div>
          <span className="finance-eyebrow">PAYDAY LAB · 01</span>
          <h1>把每一小时的价值算清楚</h1>
          <p>输入你的月薪，快速得到日薪、时薪与加班参考。数字会随输入即时更新，适合作为谈薪和排班时的轻量参考。</p>
        </div>
        <div className="finance-salary-hero-mark" aria-hidden="true">¥<span>→</span></div>
      </header>
      <SalaryToolCard />
    </div>
  );
}
