export type InvestmentSimulationFrequency = 'monthly' | 'weekly';

export type InvestmentSimulationPoint = {
  date: string;
  value: number;
};

export type InvestmentSimulationResult = {
  contributionCount: number;
  investedAmount: number;
  shares: number;
  endingValue: number;
  profit: number;
  returnRate: number;
  firstBuyDate: string;
  lastBuyDate: string;
};

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nextMonthlyDate(date: Date) {
  const day = date.getUTCDate();
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const daysInMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
  ).getUTCDate();
  next.setUTCDate(Math.min(day, daysInMonth));
  return next;
}

function nextScheduleDate(date: Date, frequency: InvestmentSimulationFrequency) {
  if (frequency === 'weekly') {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  return nextMonthlyDate(date);
}

export function simulateInvestmentPlan(input: {
  points: InvestmentSimulationPoint[];
  startDate: string;
  endDate: string;
  amount: number;
  frequency: InvestmentSimulationFrequency;
}): InvestmentSimulationResult | null {
  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  const amount = Number(input.amount);
  const points = input.points
    .filter((point) => point && Number.isFinite(point.value) && point.value > 0)
    .map((point) => ({ ...point, parsedDate: parseDate(point.date) }))
    .filter((point) => point.parsedDate && point.parsedDate >= (start || new Date(0)))
    .sort((a, b) => a.parsedDate!.getTime() - b.parsedDate!.getTime());

  if (!start || !end || end < start || !Number.isFinite(amount) || amount <= 0 || !points.length) {
    return null;
  }

  let scheduledDate = start;
  let investedAmount = 0;
  let shares = 0;
  let contributionCount = 0;
  let firstBuyDate = '';
  let lastBuyDate = '';
  let pointIndex = 0;

  while (scheduledDate <= end) {
    while (pointIndex < points.length && points[pointIndex].parsedDate! < scheduledDate) {
      pointIndex += 1;
    }
    const point = points[pointIndex];
    if (point && point.parsedDate! <= end) {
      const price = point.value;
      shares += amount / price;
      investedAmount += amount;
      contributionCount += 1;
      const buyDate = point.date;
      if (!firstBuyDate) firstBuyDate = buyDate;
      lastBuyDate = buyDate;
      pointIndex += 1;
    }
    scheduledDate = nextScheduleDate(scheduledDate, input.frequency);
  }

  const endingPoint = points.filter((point) => point.parsedDate! <= end).at(-1);
  if (!endingPoint || contributionCount === 0) return null;
  const endingValue = shares * endingPoint.value;
  const profit = endingValue - investedAmount;
  return {
    contributionCount,
    investedAmount,
    shares,
    endingValue,
    profit,
    returnRate: investedAmount > 0 ? profit / investedAmount : 0,
    firstBuyDate,
    lastBuyDate
  };
}
