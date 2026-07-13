import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
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
    t: (key: string, options?: Record<string, string>) => {
      if (options?.hint) return `${key} ${options.hint}`;
      return key;
    }
  })
}));

const aiSettingsMocks = vi.hoisted(() => ({
  state: {
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-test',
    setModel: vi.fn(),
    showEmbeddingSummary: false,
    showEmbeddingDebug: false,
    embeddingModel: '',
    enableEmbeddingModel: false
  }
}));

vi.mock('../../shared/store/useAiSettings', () => ({
  useAiSettings: (selector: (state: typeof aiSettingsMocks.state) => unknown) =>
    selector(aiSettingsMocks.state)
}));

const appPreferencesMocks = vi.hoisted(() => {
  const state = {
    addDebt: vi.fn(),
    updateDebt: vi.fn(),
    removeDebt: vi.fn(),
    addRepaymentRecord: vi.fn(),
    monthlyIncome: 0,
    debts: [],
    repaymentRecords: []
  };
  const useAppPreferences = Object.assign(
    (selector: (currentState: typeof state) => unknown) => selector(state),
    { getState: () => state }
  );
  return { state, useAppPreferences };
});

vi.mock('../../shared/store/useAppPreferences', () => ({
  useAppPreferences: appPreferencesMocks.useAppPreferences
}));

const financeStoreMocks = vi.hoisted(() => ({
  state: {
    categories: [],
    accounts: [],
    transactions: [
      {
        id: 'tx-latest-context',
        type: 'expense',
        amount: 11,
        date: '2026-04-25',
        categoryId: 'cat-food',
        accountId: 'acc-cash',
        note: '快速记账'
      }
    ],
    subscriptions: [],
    addCategory: vi.fn(),
    addAccount: vi.fn(),
    addTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    addSubscription: vi.fn()
  }
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMocks.state) => unknown) =>
    selector(financeStoreMocks.state)
}));

vi.mock('../../shared/store/useGlobalMemoryStore', () => ({
  useGlobalMemoryStore: (selector: (state: { memories: never[]; addMemory: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({
      memories: [],
      addMemory: vi.fn()
    })
}));

vi.mock('../../features/assistant/memory/extractGlobalMemories', () => ({
  extractGlobalMemoriesFromConversation: vi.fn(async () => [])
}));

vi.mock('../../features/assistant/api/openaiCompatibleClient', () => ({
  sendAiChat: vi.fn(async () => ({
    content: JSON.stringify([])
  }))
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

describe('AssistantPage input layout', () => {
  it('keeps the latest transaction context outside the input form', async () => {
    useAssistantWorkbenchMock.mockReturnValue(createWorkbenchMock());

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <MemoryRouter>
          <AssistantPage />
        </MemoryRouter>
      ));
    });

    const context = container!.querySelector('[aria-label="最近一笔账单"]');
    const form = container!.querySelector('.chat-input-form');

    expect(context).not.toBeNull();
    expect(form).not.toBeNull();
    expect(form?.contains(context as Node)).toBe(false);
  });

  it('uses the compact composer for the three regular assistant modes', async () => {
    useAssistantWorkbenchMock.mockReturnValue(createWorkbenchMock());

    const { container } = render(
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    );

    const regularModeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.chat-mode-switch button')
    ).slice(0, 3);

    expect(regularModeButtons).toHaveLength(3);

    for (const modeButton of regularModeButtons) {
      await act(async () => {
        fireEvent.click(modeButton);
      });

      const input = screen.getByRole('textbox');
      const form = container.querySelector('.chat-input-form-collapsible');
      expect(form).toHaveClass('is-compact');

      fireEvent.focus(input);
      expect(form).toHaveClass('is-expanded');
      fireEvent.blur(input);
      expect(form).toHaveClass('is-compact');
    }
  });
});
