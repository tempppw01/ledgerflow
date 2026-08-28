import { SalaryToolCard } from './SalaryToolCard';

export function SalaryToolsPage() {
  return (
    <div className="page-stack finance-page vi-page">
      <section className="card finance-page-tip" role="note">
        <strong>这里是工资工具页</strong>
        <p>集中放工资计算、个税测算等工具能力；如果你想看财经 RSS、市场动态与资讯订阅，请前往「市场资讯」。</p>
      </section>
      <SalaryToolCard />
    </div>
  );
}
