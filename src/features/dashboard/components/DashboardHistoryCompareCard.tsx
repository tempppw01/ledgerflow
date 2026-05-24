import { formatCurrency } from '../../../shared/lib/format';

export interface DashboardHistoryCompareCardProps {
  previousMonthExpense: number;
  quarterExpense: number;
  yearlyExpense: number;
  profile?: {
    timePreference: string;
    topMerchant: string;
    personality: string;
    crowdCompare: string;
  };
  monthlyInsightStatus: 'idle' | 'loading' | 'streaming' | 'done' | 'error';
}

function getProfileStatusText(status: DashboardHistoryCompareCardProps['monthlyInsightStatus']) {
  if (status === 'loading' || status === 'streaming') {
    return 'AI 正在给本月消费贴标签…';
  }
  if (status === 'error') {
    return '画像暂时没生成，稍后再刷一下。';
  }
  if (status === 'done') {
    return '已根据本月账单刷新。';
  }
  return '记几笔之后，这里会自动生成消费人设。';
}

export function DashboardHistoryCompareCard({
  previousMonthExpense,
  quarterExpense,
  yearlyExpense,
  profile,
  monthlyInsightStatus
}: DashboardHistoryCompareCardProps) {
  return (
    <article className="panel" style={{ marginTop: 12 }}>
      <div className="dashboard-section-header">
        <h3>消费手账</h3>
        <span>过去花了多少 + 本月人设</span>
      </div>

      <div className="grid grid-2 dashboard-history-profile-grid" style={{ gap: 12 }}>
        <section className="panel dashboard-history-card" style={{ margin: 0 }}>
          <h4>花钱时间线</h4>
          <div className="dashboard-history-metrics dashboard-history-metrics--compact">
            <article>
              <span>上月花了</span>
              <strong className="expense">{formatCurrency(previousMonthExpense)}</strong>
            </article>
            <article>
              <span>本季花了</span>
              <strong className="expense">{formatCurrency(quarterExpense)}</strong>
            </article>
            <article>
              <span>今年花了</span>
              <strong className="expense">{formatCurrency(yearlyExpense)}</strong>
            </article>
          </div>
        </section>

        <section className="panel dashboard-profile-card" style={{ margin: 0 }}>
          <h4>本月消费人设</h4>
          <div className="dashboard-profile-tags dashboard-profile-tags--compact">
            <span>常买时段：{profile?.timePreference || '待解锁'}</span>
            <span>常去商家：{profile?.topMerchant || '待解锁'}</span>
            <span>消费风格：{profile?.personality || '待解锁'}</span>
            <span>同类对比：{profile?.crowdCompare || '待解锁'}</span>
          </div>
          <p className="dashboard-profile-tip" style={{ marginTop: 8 }}>
            {getProfileStatusText(monthlyInsightStatus)}
          </p>
        </section>
      </div>
    </article>
  );
}
