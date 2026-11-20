import { useTFallback } from '../../shared/lib/useTFallback';
import { SalaryToolCard } from './SalaryToolCard';

export function SalaryToolsPage() {
  const tf = useTFallback();

  return (
    <div className="page-stack finance-page vi-page finance-salary-workbench">
      <header className="vi-hero finance-salary-hero">
        <div className="vi-hero-copy">
          <span className="vi-page-kicker">{tf('salaryTools.title', '工资估算')}</span>
          <h1>{tf('salaryTools.headline', '把每一小时的价值算清楚')}</h1>
          <p>
            {tf(
              'salaryTools.subtitle',
              '输入你的月薪，快速得到日薪、时薪与加班参考。数字会随输入即时更新，适合作为谈薪和排班时的轻量参考。'
            )}
          </p>
        </div>
        <div className="vi-hero-media finance-salary-hero-mark" aria-hidden="true">¥</div>
      </header>
      <SalaryToolCard />
    </div>
  );
}
