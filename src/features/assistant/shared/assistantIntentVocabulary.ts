export type AssistantIntent =
  | 'trend'
  | 'review'
  | 'planning'
  | 'decision'
  | 'risk'
  | 'category';

export const ASSISTANT_INTENT_PATTERNS: Array<{
  intent: AssistantIntent;
  regex: RegExp;
  label: string;
  priority: number;
}> = [
  {
    intent: 'trend',
    regex:
      /趋势|变化|波动|上升|下降|增长|减少|最近|近[一二三四五六七八九十\d]+(?:天|周|个月|年)|本月|这月|上月|上个月|环比|同比|对比|拐点/,
    label: '趋势变化',
    priority: 6
  },
  {
    intent: 'review',
    regex: /复盘|回顾|总结|问题在哪|哪里出问题|哪里失控|拆解|原因|为啥|为什么|怎么回事/,
    label: '复盘拆解',
    priority: 5
  },
  {
    intent: 'planning',
    regex: /预算|计划|安排|怎么做|怎么省|下一步|清单|执行|优先级|先还|先买|先花|攒钱/,
    label: '行动规划',
    priority: 4
  },
  {
    intent: 'decision',
    regex: /怎么看|判断|值不值|划算吗|要不要|是否|应该|该不该|合适吗|能不能|该选|选哪个/,
    label: '判断取舍',
    priority: 5
  },
  {
    intent: 'risk',
    regex: /风险|压力|危险|失控|隐患|吃紧|透支|超支|还不上了?|逾期|爆仓|扛不住/,
    label: '风险提醒',
    priority: 4
  },
  {
    intent: 'category',
    regex:
      /分类|餐饮|吃饭|外卖|交通|通勤|住房|居住|娱乐|日用|订阅|买菜|出行|购物|医疗|教育|旅行|宠物|保险/,
    label: '分类聚焦',
    priority: 3
  }
];

export function rankAssistantIntents(text: string): AssistantIntent[] {
  const scored = ASSISTANT_INTENT_PATTERNS.map((item) => ({
    intent: item.intent,
    label: item.label,
    priority: item.priority,
    hits: (text.match(new RegExp(item.regex.source, 'g')) || []).length
  }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits * 10 + b.priority - (a.hits * 10 + a.priority));

  return scored.slice(0, 3).map((item) => item.intent);
}

export function buildAssistantIntentLabels(intents: AssistantIntent[]): string[] {
  return intents
    .map((intent) => ASSISTANT_INTENT_PATTERNS.find((item) => item.intent === intent)?.label || '')
    .filter(Boolean);
}

export function buildAssistantPromptFocus(intents: AssistantIntent[]): string[] {
  const focus = new Set<string>();
  intents.forEach((intent) => {
    if (intent === 'trend') focus.add('先抓变化,再解释驱动因素与后续影响');
    if (intent === 'review') focus.add('优先定位问题,再拆原因,不要只报现象');
    if (intent === 'planning') focus.add('把建议落到先后顺序和可执行动作,不要停在方向层');
    if (intent === 'decision') focus.add('需要明确表态时直接给判断,并交代成立前提');
    if (intent === 'risk') focus.add('指出最值得警惕的风险点,并说明影响范围');
    if (intent === 'category') focus.add('尽量落到具体分类、场景或对象,不要只说泛化结论');
  });

  if (focus.size === 0) focus.add('先回答问题主线,再补最关键的细节');
  return Array.from(focus).slice(0, 3);
}
