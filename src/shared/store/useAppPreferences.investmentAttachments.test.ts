import { beforeEach, describe, expect, it } from 'vitest';
import { useAppPreferences } from './useAppPreferences';

describe('useAppPreferences investment AI attachments', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppPreferences.setState({
      investmentPositions: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: []
    });
  });

  it('persists fund analysis image data on chat messages', () => {
    useAppPreferences.getState().setInvestmentAiMessages([
      {
        id: 'msg-user-image',
        role: 'user',
        text: 'Please analyze this fund screenshot',
        attachmentCount: 99,
        attachmentImages: [
          'data:image/png;base64,ZmFrZS1mdW5kLWltYWdl',
          'https://example.com/not-persisted.png'
        ],
        createdAt: '2026-05-29T03:00:00.000Z'
      }
    ]);

    const [message] = useAppPreferences.getState().investmentAiMessages;
    expect(message.attachmentImages).toEqual(['data:image/png;base64,ZmFrZS1mdW5kLWltYWdl']);
    expect(message.attachmentCount).toBe(1);
  });
});
