import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { AssistantPage } from './AssistantPage';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});

Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: vi.fn()
});

const navigateMock = vi.fn();
const useAssistantWorkbenchMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'assistant.ui.bookkeepingMode': 'AI 记账',
        'assistant.ui.assistantMode': 'AI 助手',
        'assistant.ui.creditMode': 'AI 信贷管家',
        'assistant.ui.bookkeepingAssistant': 'AI 记账助手',
        'assistant.ui.qaAssistant': 'AI 助手',
        'assistant.ui.quickAdd': '快速记一笔',
        'assistant.ui.clearContext': '清空上下文',
        'assistant.ui.selectModel': '选择模型',
        'assistant.ui.loadingModels': '加载中',
        'assistant.ui.refreshModels': '刷新模型',
        'assistant.ui.emptyModels': '暂无模型',
        'assistant.ui.needApiKeyTitle': '请先配置 API Key',
        'assistant.ui.needApiKeyDesc': '需要先配置模型能力',
        'assistant.ui.goSettings': '前往设置',
        'assistant.placeholders.assistantHint': '问点财务问题',
        'assistant.placeholders.bookkeepingHint': '记一笔',
        'assistant.placeholders.readyAssistant': '助手就绪',
        'assistant.placeholders.readyBookkeeping': '记账就绪',
        'assistant.placeholders.idleBookkeeping': '空闲记账',
        'assistant.placeholders.recognizing': '识别中',
        'assistant.placeholders.preview': '预览中',
        'assistant.placeholders.saving': '保存中',
        'assistant.placeholders.saved': '已保存',
        'assistant.placeholders.error': '出错了',
        'assistant.placeholders.needApiKey': '缺少 Key'
      };
      return map[key] || key;
    }
  })
}));

beforeEach(() => {
  navigateMock.mockReset();
  useAssistantWorkbenchMock.mockReset();
  window.sessionStorage.clear();
  vi.mocked(sendAiChat).mockReset();
  vi.mocked(sendAiChat).mockResolvedValue({
    content: JSON.stringify([
      '先帮我拆出最近两周涨得最快的分类？',
      '如果只能先压一项支出，你会先动哪一项？',
      '把这波预算压力按短期和长期分开看？'
    ])
  });
  appPreferencesMocks.state.investmentAiMessages = [];
});

const aiSettingsMocks = vi.hoisted(() => {
  const setModelMock = vi.fn();
  const state = {
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-test',
    setModel: setModelMock,
    showEmbeddingSummary: false,
    showEmbeddingDebug: false,
    embeddingModel: '',
    enableEmbeddingModel: false,
    webSearch: {
      tavilyApiKey: '',
      tavilyBaseUrl: '',
      localEndpoint: '',
      provider: 'tavily',
      maxResults: 5
    }
  };
  return { setModelMock, state };
});

vi.mock('../../shared/store/useAiSettings', () => ({
  useAiSettings: (selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(aiSettingsMocks.state) : aiSettingsMocks.state
}));


const appPreferencesMocks = vi.hoisted(() => {
  const addDebtMock = vi.fn();
  const updateDebtMock = vi.fn();
  const removeDebtMock = vi.fn();
  const addRepaymentRecordMock = vi.fn();
  const state = {
    addDebt: addDebtMock,
    updateDebt: updateDebtMock,
    removeDebt: removeDebtMock,
    addRepaymentRecord: addRepaymentRecordMock,
    monthlyIncome: 0,
    investmentPositions: [],
    investmentGoals: [],
    investmentWatchlist: [],
    investmentAiMessages: [] as Array<Record<string, unknown>>,
    setInvestmentAiMessages: vi.fn(),
    debts: [
      {
        id: 'saved-debt-1',
        name: '京东白条分期',
        type: 'consumer-loan',
        balance: 5200,
        annualRate: 12.8,
        remainingMonths: 9,
        repaymentDay: 8,
        paymentAccount: '招商银行卡'
      }
    ],
    repaymentRecords: [
      {
        debtId: 'saved-debt-1',
        amount: 666,
        paidAt: '2026-03-05',
        paymentAccount: '招商银行卡',
        recordMode: 'manual',
        note: '3月已还'
      }
    ]
  };
  const useAppPreferences = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(state),
    { getState: () => state }
  );
  return { addDebtMock, updateDebtMock, removeDebtMock, addRepaymentRecordMock, state, useAppPreferences };
});

const addDebtMock = appPreferencesMocks.addDebtMock;
const updateDebtMock = appPreferencesMocks.updateDebtMock;

vi.mock('../../shared/store/useAppPreferences', () => ({
  useAppPreferences: appPreferencesMocks.useAppPreferences
}));

const financeStoreMocks = vi.hoisted(() => {
  const addCategoryMock = vi.fn();
  const addAccountMock = vi.fn();
  const addTransactionMock = vi.fn();
  const updateTransactionMock = vi.fn();
  const addSubscriptionMock = vi.fn();
  const state = {
    categories: [],
    accounts: [],
    transactions: [],
    subscriptions: [],
    addCategory: addCategoryMock,
    addAccount: addAccountMock,
    addTransaction: addTransactionMock,
    updateTransaction: updateTransactionMock,
    addSubscription: addSubscriptionMock
  };
  return {
    addCategoryMock,
    addAccountMock,
    addTransactionMock,
    updateTransactionMock,
    addSubscriptionMock,
    state
  };
});

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: Record<string, unknown>) => unknown) => selector(financeStoreMocks.state)
}));

vi.mock('../../features/assistant/api/openaiCompatibleClient', () => ({
  sendAiChat: vi.fn()
}));

vi.mock('../../features/assistant/workbench/useAssistantWorkbench', () => ({
  useAssistantWorkbench: (...args: unknown[]) => useAssistantWorkbenchMock(...args)
}));

function createWorkbenchMock() {
  return {
    hasApiKey: true,
    loadingModels: false,
    handleLoadModels: vi.fn(),
    models: ['gpt-test'],
    status: 'idle',
    resetWorkbench: vi.fn(),
    imageDataUrls: [],
    pdfDataUrls: [],
    handleDropImage: vi.fn(),
    handleRecognizeWithPrompt: vi.fn(),
    stopRecognize: vi.fn(),
    setTextInput: vi.fn(),
    textInput: '',
    canRecognize: true,
    error: '',
    rawContent: '',
    rawReasoning: '',
    lastUsage: null,
    embeddingDebug: {
      enabled: false,
      used: false,
      downgraded: false,
      reason: '',
      latencyMs: 0,
      indexedDocs: 0,
      hitCount: 0,
      topScore: 0,
      averageScore: 0,
      hits: [],
      model: ''
    },
    semanticRecallCacheMeta: {
      exists: false,
      indexedDocs: 0,
      updatedAt: 0,
      model: ''
    },
    refreshSemanticRecallCacheMeta: vi.fn(),
    clearSemanticRecallIndex: vi.fn(() => true),
    setToastState: vi.fn(),
    entries: [],
    saveSelected: vi.fn(() => true),
    setImageDataUrls: vi.fn(),
    setPdfDataUrls: vi.fn(),
    removeImageAt: vi.fn(),
    removePdfAt: vi.fn(),
    triggerImagePicker: vi.fn(),
    triggerPdfPicker: vi.fn(),
    handleImageInputChange: vi.fn(),
    handlePdfInputChange: vi.fn(),
    fileInputRef: { current: null },
    pdfInputRef: { current: null },
    textareaRef: { current: null },
    drawerOpen: false,
    setDrawerOpen: vi.fn(),
    toast: { visible: false, message: '', variant: 'success' }
  };
}

async function selectAssistantMode(mode: 'AI 记账' | 'AI 信贷管家') {
  const trigger = document.querySelector<HTMLButtonElement>('.chat-mode-switch-trigger');

  await act(async () => {
    fireEvent.click(trigger as HTMLButtonElement);
  });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: mode }));
  });
}

describe('AssistantPage', () => {
  it('AI 记账首屏应展示导入插画', async () => {
    useAssistantWorkbenchMock.mockReturnValue(createWorkbenchMock());

    const { container } = render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await selectAssistantMode('AI 记账');

    expect(screen.getByText(/本轮准备记账/)).toBeInTheDocument();
    const bookkeepingIllustration = container.querySelector<HTMLImageElement>('.chat-bookkeeping-illustration');
    expect(bookkeepingIllustration?.src).toContain('/ledgerflow/Illustrations/importing.svg');
  });

  it('应支持切换到 AI 信贷管家并展示信贷首屏内容', async () => {
    useAssistantWorkbenchMock.mockReturnValue(createWorkbenchMock());

    const { container } = render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await selectAssistantMode('AI 信贷管家');

    expect(screen.getAllByRole('button', { name: 'AI 信贷管家' }).length).toBeGreaterThan(0);
    expect(await screen.findByText(/你好，我是你的 AI 信贷管家/)).toBeInTheDocument();
    const creditIllustration = container.querySelector<HTMLImageElement>('.chat-credit-illustration');
    expect(creditIllustration?.src).toContain('/ledgerflow/Illustrations/importing.svg');
    expect(screen.queryByText('梳理本月应还')).not.toBeInTheDocument();
    expect(screen.queryByText('识别花呗与分期')).not.toBeInTheDocument();
    expect(screen.queryByText('🧭 优先处理')).not.toBeInTheDocument();
    expect(screen.queryByText('📌 这个模式适合什么')).not.toBeInTheDocument();
  });

  it('模式切换默认收起为当前模式按钮，点击后展开三个常规助手模式', async () => {
    useAssistantWorkbenchMock.mockReturnValue(createWorkbenchMock());

    const { container } = render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    const trigger = container.querySelector<HTMLButtonElement>('.chat-mode-switch-trigger');
    const options = container.querySelector('.chat-mode-switch-options');
    expect(trigger).toHaveTextContent('AI 助手');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(options?.querySelectorAll('button')).toHaveLength(3);
    expect(screen.queryByText('投资理财')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(trigger as HTMLButtonElement);
    });

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const creditModeButton = options?.querySelectorAll<HTMLButtonElement>('button')[2];
    await act(async () => {
      fireEvent.click(creditModeButton as HTMLButtonElement);
    });

    expect(trigger).toHaveTextContent('AI 信贷管家');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('旧版投资理财模式会回退至 AI 助手，不再展示右侧投资会话', () => {
    window.sessionStorage.setItem('ledgerflow.assistant.activeMode', 'investment');
    useAssistantWorkbenchMock.mockReturnValue(createWorkbenchMock());

    const { container } = render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    expect(container.querySelector('.chat-mode-switch-trigger')).toHaveTextContent('AI 助手');
    expect(container.querySelector('.chat-messages-area.is-investment-mode')).toBeNull();
    expect(container.querySelector('.chat-investment-stage')).toBeNull();
  });

  it('AI 信贷管家在有内容时才显示优先处理模块', async () => {
    useAssistantWorkbenchMock.mockReturnValue({
      ...createWorkbenchMock(),
      textInput: '帮我看看这几笔分期'
    });

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await selectAssistantMode('AI 信贷管家');

    expect(await screen.findByText('🧭 优先处理')).toBeInTheDocument();
    expect(screen.getByText('先把本月应还摸清')).toBeInTheDocument();
  });

  it('顶部不再显示快捷记一笔，清空上下文改到输入工具条', async () => {
    useAssistantWorkbenchMock.mockReturnValue(createWorkbenchMock());

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: '快速记一笔' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清空上下文' })).toBeInTheDocument();
  });

  it('输入 @ 时应弹出模型列表并支持选中模型', async () => {
    const workbench = {
      ...createWorkbenchMock(),
      textInput: '@',
      setTextInput: vi.fn()
    };
    useAssistantWorkbenchMock.mockReturnValue(workbench);

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('dialog', { name: '模型列表' })).toBeInTheDocument();
    expect(workbench.handleLoadModels).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'gpt-test' }));
    });

    expect(aiSettingsMocks.setModelMock).toHaveBeenCalledWith('gpt-test');
    expect(workbench.setTextInput).toHaveBeenCalledWith('@gpt-test ');
  });

  it('点击模型卡片时应自动刷新模型列表', async () => {
    const workbench = createWorkbenchMock();
    useAssistantWorkbenchMock.mockReturnValue(workbench);

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '当前模型：gpt-test' }));
    });

    expect(await screen.findByRole('dialog', { name: '模型列表' })).toBeInTheDocument();
    expect(workbench.handleLoadModels).toHaveBeenCalledTimes(1);
  });

  it('信贷识别结果应支持直接保存到还款管理', async () => {
    useAssistantWorkbenchMock.mockReturnValue({
      ...createWorkbenchMock(),
      rawContent: '已识别完成',
      status: 'ready'
    });

    const sessionStorageGetItemSpy = vi
      .spyOn(window.sessionStorage.__proto__, 'getItem')
      .mockImplementation((key) => {
        if (String(key).includes('chatHistory.credit')) {
          return JSON.stringify([
            {
              id: 'credit-assistant-0',
              role: 'assistant',
              text: '这是识别后的结果',
              creditItems: [
                {
                  id: 'credit-0',
                  title: '招联消费贷',
                  productType: '消费贷',
                  dueAmount: '998',
                  totalDebt: '4200',
                  repaymentDate: '每月12日',
                  remainingPeriods: '5',
                  monthlyAmount: '998',
                  interest: '15.2',
                  pendingFields: [],
                  confidence: 'high'
                }
              ]
            }
          ]);
        }
        return '[]';
      });

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await selectAssistantMode('AI 信贷管家');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '进入保存前确认' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认保存到还款管理' }));
    });

    await waitFor(() => {
      expect(addDebtMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '招联消费贷',
          type: 'consumer-loan',
          balance: 4200
        })
      );
    });

    sessionStorageGetItemSpy.mockRestore();
  });



  it('信贷结果应展示补全进度并提示承接上轮补充', async () => {
    useAssistantWorkbenchMock.mockReturnValue({
      ...createWorkbenchMock(),
      rawContent: '已识别完成',
      status: 'idle'
    });

    const sessionStorageGetItemSpy = vi
      .spyOn(window.sessionStorage.__proto__, 'getItem')
      .mockImplementation((key) => {
        if (String(key).includes('chatHistory.credit')) {
          return JSON.stringify([
            {
              id: 'credit-assistant-0',
              role: 'assistant',
              text: '这是识别后的结果',
              creditItems: [
                {
                  id: 'credit-0',
                  title: '招联消费贷',
                  productType: '消费贷',
                  dueAmount: '998',
                  totalDebt: '4200',
                  repaymentDate: '每月12日',
                  monthlyAmount: '998',
                  rateType: 'APR',
                  interest: '15.2%',
                  remainingPeriods: '6',
                  pendingFields: ['扣款账户'],
                  confidence: 'high',
                  mergedFromHistory: true,
                  completionRatio: 83,
                  completionLabel: '5/6 关键字段已补齐'
                }
              ]
            }
          ]);
        }
        return '[]';
      });

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await selectAssistantMode('AI 信贷管家');

    expect(await screen.findByText('6/6 关键字段已补齐')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('已承接上轮补充')).toBeInTheDocument();

    sessionStorageGetItemSpy.mockRestore();
  });

  it('字段较完整的信贷结果应先进入保存前确认态', async () => {
    useAssistantWorkbenchMock.mockReturnValue({
      ...createWorkbenchMock(),
      rawContent: '已识别完成',
      status: 'ready'
    });

    const sessionStorageGetItemSpy = vi
      .spyOn(window.sessionStorage.__proto__, 'getItem')
      .mockImplementation((key) => {
        if (String(key).includes('chatHistory.credit')) {
          return JSON.stringify([
            {
              id: 'credit-assistant-confirm',
              role: 'assistant',
              text: '这是识别后的结果',
              creditItems: [
                {
                  id: 'credit-confirm-0',
                  title: '分期乐账单',
                  productType: '消费贷',
                  dueAmount: '666',
                  totalDebt: '3999',
                  repaymentDate: '每月10日',
                  remainingPeriods: '6',
                  monthlyAmount: '666',
                  interest: '18.6%',
                  rateType: 'APR',
                  pendingFields: ['扣款账户'],
                  confidence: 'high',
                  confirmationState: 'ready',
                  confirmationSummary: ['产品：分期乐账单']
                }
              ]
            }
          ]);
        }
        return '[]';
      });

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await selectAssistantMode('AI 信贷管家');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '进入保存前确认' }));
    });

    expect(await screen.findByText('保存前确认')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认保存到还款管理' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认保存到还款管理' }));
    });

    await waitFor(() => {
      expect(addDebtMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '分期乐账单',
          balance: 3999,
          annualRate: 18.6,
          remainingMonths: 6,
          repaymentDay: 10
        })
      );
    });

    sessionStorageGetItemSpy.mockRestore();
  });



  it('信贷卡片应展示还款计划、账户与流水检索结果', async () => {
    useAssistantWorkbenchMock.mockReturnValue({
      ...createWorkbenchMock(),
      rawContent: '已识别完成',
      status: 'ready'
    });

    const sessionStorageGetItemSpy = vi
      .spyOn(window.sessionStorage.__proto__, 'getItem')
      .mockImplementation((key) => {
        if (String(key).includes('chatHistory.credit')) {
          return JSON.stringify([
            {
              id: 'credit-assistant-lookup',
              role: 'assistant',
              text: '这是识别后的结果',
              creditItems: [
                {
                  id: 'credit-lookup-0',
                  title: '京东白条分期',
                  productType: '消费贷',
                  dueAmount: '666',
                  totalDebt: '3999',
                  repaymentDate: '每月8日',
                  remainingPeriods: '6',
                  monthlyAmount: '666',
                  interest: '18.6%',
                  rateType: 'APR',
                  pendingFields: [],
                  confidence: 'high'
                }
              ]
            }
          ]);
        }
        return '[]';
      });

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await selectAssistantMode('AI 信贷管家');

    expect(await screen.findByText('还款检索结果')).toBeInTheDocument();
    expect(screen.getByText('计划中的应还')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('每月8日') && content.includes('本期约666'))).toBeInTheDocument();
    expect(screen.getByText('计划 / 实际账户')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('招商') && content.includes('银行卡'))).toBeInTheDocument();

    sessionStorageGetItemSpy.mockRestore();
  });

  it('保存前确认态应支持更新已有负债', async () => {
    useAssistantWorkbenchMock.mockReturnValue({
      ...createWorkbenchMock(),
      rawContent: '已识别完成',
      status: 'ready'
    });

    const sessionStorageGetItemSpy = vi
      .spyOn(window.sessionStorage.__proto__, 'getItem')
      .mockImplementation((key) => {
        if (String(key).includes('chatHistory.credit')) {
          return JSON.stringify([
            {
              id: 'credit-assistant-update',
              role: 'assistant',
              text: '这是识别后的结果',
              creditItems: [
                {
                  id: 'credit-update-0',
                  title: '京东白条分期',
                  productType: '消费贷',
                  dueAmount: '666',
                  totalDebt: '3999',
                  repaymentDate: '每月10日',
                  remainingPeriods: '6',
                  monthlyAmount: '666',
                  interest: '18.6%',
                  rateType: 'APR',
                  pendingFields: [],
                  confidence: 'high',
                  confirmationState: 'ready',
                  confirmationSummary: ['产品：分期乐账单']
                }
              ]
            }
          ]);
        }
        return '[]';
      });

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await selectAssistantMode('AI 信贷管家');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '进入保存前确认' }));
    });

    expect(await screen.findByText('与已保存负债的差异')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新已有负债' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更新已有负债' }));
    });

    await waitFor(() => {
      expect(updateDebtMock).toHaveBeenCalledWith(
        'saved-debt-1',
        expect.objectContaining({
          name: '京东白条分期',
          balance: 3999,
          annualRate: 18.6,
          remainingMonths: 6,
          repaymentDay: 10
        })
      );
    });

    sessionStorageGetItemSpy.mockRestore();
  });

  it('信贷识别结果应支持带去还款管理', async () => {
    useAssistantWorkbenchMock.mockReturnValue({
      ...createWorkbenchMock(),
      rawContent: '已识别完成',
      status: 'ready'
    });

    const sessionStorageGetItemSpy = vi
      .spyOn(window.sessionStorage.__proto__, 'getItem')
      .mockImplementation((key) => {
        if (String(key).includes('chatHistory.credit')) {
          return JSON.stringify([
            {
              id: 'credit-assistant-1',
              role: 'assistant',
              text: '这是识别后的结果',
              creditItems: [
                {
                  id: 'credit-1',
                  title: '花呗分期',
                  productType: '消费贷',
                  dueAmount: '1288',
                  totalDebt: '5600',
                  repaymentDate: '每月8日',
                  remainingPeriods: '5',
                  monthlyAmount: '1288',
                  interest: '23',
                  pendingFields: ['扣款账户'],
                  confidence: 'high'
                }
              ]
            }
          ]);
        }
        return '[]';
      });

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await selectAssistantMode('AI 信贷管家');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '去补充后保存' }));
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/repayment-management', {
        state: {
          prefillDebt: expect.objectContaining({
            name: '花呗分期',
            type: 'consumer-loan'
          })
        }
      });
    });

    sessionStorageGetItemSpy.mockRestore();
  });

  it('AI 助手提问时应注入稳定的行为约束而不是绑定固定文案', async () => {
    const workbench = {
      ...createWorkbenchMock(),
      textInput: '帮我看看最近支出趋势',
      handleRecognizeWithPrompt: vi.fn(),
      status: 'idle'
    };
    useAssistantWorkbenchMock.mockReturnValue(workbench);

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    await act(async () => {
      fireEvent.click(screen.getByTitle('发送'));
    });

    const [prompt, payload] = workbench.handleRecognizeWithPrompt.mock.calls[0] || [];
    expect(typeof prompt).toBe('string');
    expect(String(prompt)).toContain('当前问题：帮我看看最近支出趋势');
    expect(String(prompt)).toContain('回答偏好：');
    expect(String(prompt)).toContain('趋势变化');
    expect(String(prompt)).toContain('回答原则：');
    expect(String(prompt)).toContain('不要套固定三段式');
    expect(String(prompt)).toContain('先抓变化，再解释驱动因素与后续影响');
    expect(payload).toEqual(
      expect.objectContaining({
        imageDataUrls: [],
        pdfDataUrls: []
      })
    );
  });

  it('AI 助手回复后应生成与主题相关的继续追问建议', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce({
      content: JSON.stringify([
        '先帮我拆出最近两周涨得最快的分类？',
        '如果只能先压一项支出，你会先动哪一项？',
        '把这波预算压力按短期和长期分开看？'
      ])
    });

    useAssistantWorkbenchMock.mockReturnValue({
      ...createWorkbenchMock(),
      rawContent: '最近餐饮和通勤支出一起抬升，本月预算压力主要来自高频小额消费。建议先收紧工作日外卖，再看通勤替代方案。',
      status: 'ready'
    });

    const sessionStorageGetItemSpy = vi
      .spyOn(window.sessionStorage.__proto__, 'getItem')
      .mockImplementation((key) => {
        if (String(key).includes('chatHistory.assistant')) {
          return JSON.stringify([
            {
              id: 'assistant-user-0',
              role: 'user',
              text: '帮我看看最近支出趋势'
            }
          ]);
        }
        return '[]';
      });

    render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('你可以顺手继续问：')).toBeInTheDocument();
    expect(await screen.findByText('先帮我拆出最近两周涨得最快的分类？')).toBeInTheDocument();
    expect(screen.getByText('如果只能先压一项支出，你会先动哪一项？')).toBeInTheDocument();
    expect(screen.getByText('把这波预算压力按短期和长期分开看？')).toBeInTheDocument();
    expect(sendAiChat).toHaveBeenCalledTimes(1);
    expect(sendAiChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining('帮我看看最近支出趋势')
          })
        ])
      })
    );

    sessionStorageGetItemSpy.mockRestore();
  });
});
