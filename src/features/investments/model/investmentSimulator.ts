export type InvestmentSimulationFrequency = 'trading-daily' | 'weekly' | 'monthly';

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
  valuationDate: string;
};

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toWeekday(date: Date) {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextMonthlyDate(date: Date, dayOfMonth: number) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const daysInMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
  ).getUTCDate();
  next.setUTCDate(Math.min(dayOfMonth, daysInMonth));
  return next;
}

function firstMonthlyDate(start: Date, dayOfMonth: number) {
  const daysInMonth = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const candidate = new Date(start);
  candidate.setUTCDate(Math.min(dayOfMonth, daysInMonth));
  return candidate < start ? nextMonthlyDate(start, dayOfMonth) : candidate;
}

function firstWeeklyDate(start: Date, weekday: number) {
  const normalizedWeekday = Math.min(7, Math.max(1, Math.round(weekday)));
  const daysUntilTarget = (normalizedWeekday - toWeekday(start) + 7) % 7;
  const candidate = new Date(start);
  candidate.setUTCDate(candidate.getUTCDate() + daysUntilTarget);
  return candidate;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function findScheduledPoint(
  points: Array<InvestmentSimulationPoint & { parsedDate: Date }>,
  scheduledDate: Date,
  nextScheduledDate: Date | null,
  pointIndex: number
) {
  while (pointIndex < points.length && points[pointIndex].parsedDate < scheduledDate) {
    pointIndex += 1;
  }
  const point = points[pointIndex];
  if (!point || (nextScheduledDate && point.parsedDate >= nextScheduledDate)) {
    return { point: null, pointIndex };
  }
  return { point, pointIndex: pointIndex + 1 };
}

export function simulateInvestmentPlan(input: {
  points: InvestmentSimulationPoint[];
  startDate: string;
  endDate: string;
  amount: number;
  frequency: InvestmentSimulationFrequency;
  weekday?: number;
  dayOfMonth?: number;
}): InvestmentSimulationResult | null {
  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  const amount = Number(input.amount);
  const points = input.points
    .filter((point) => point && Number.isFinite(point.value) && point.value > 0)
    .map((point) => ({ ...point, parsedDate: parseDate(point.date) }))
    .filter((point) => point.parsedDate && point.parsedDate >= (start || new Date(0)))
    .sort((a, b) => a.parsedDate!.getTime() - b.parsedDate!.getTime()) as Array<
    InvestmentSimulationPoint & { parsedDate: Date }
  >;

  if (!start || !end || end < start || !Number.isFinite(amount) || amount <= 0 || !points.length) {
    return null;
  }

  let investedAmount = 0;
  let shares = 0;
  let contributionCount = 0;
  let firstBuyDate = '';
  let lastBuyDate = '';

  if (input.frequency === 'trading-daily') {
    for (const point of points) {
      if (point.parsedDate > end) break;
      shares += amount / point.value;
      investedAmount += amount;
      contributionCount += 1;
      if (!firstBuyDate) firstBuyDate = point.date;
      lastBuyDate = point.date;
    }
  } else {
    const weekday = input.weekday || (start ? toWeekday(start) : 1);
    const dayOfMonth = Math.min(31, Math.max(1, Math.round(input.dayOfMonth || start.getUTCDate())));
    let scheduledDate =
      input.frequency === 'weekly'
        ? firstWeeklyDate(start, weekday)
        : firstMonthlyDate(start, dayOfMonth);
    let pointIndex = 0;

    while (scheduledDate <= end) {
      const nextScheduledDate =
        input.frequency === 'weekly'
          ? addDays(scheduledDate, 7)
          : nextMonthlyDate(scheduledDate, dayOfMonth);
      const scheduledPoint = findScheduledPoint(
        points,
        scheduledDate,
        nextScheduledDate,
        pointIndex
      );
      pointIndex = scheduledPoint.pointIndex;
      if (scheduledPoint.point) {
        const point = scheduledPoint.point;
        shares += amount / point.value;
        investedAmount += amount;
        contributionCount += 1;
        if (!firstBuyDate) firstBuyDate = point.date;
        lastBuyDate = point.date;
      }
      scheduledDate = nextScheduledDate;
    }
  }

  const endingPoint = points.filter((point) => point.parsedDate <= end).at(-1);
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
    lastBuyDate,
    valuationDate: formatDate(endingPoint.parsedDate)
  };
}
