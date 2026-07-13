import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackupScopeSelector } from './BackupScopeSelector';

describe('BackupScopeSelector', () => {
  it('allows selecting the data included in backups', () => {
    const onChange = vi.fn();

    render(
      <BackupScopeSelector
        scope={{
          ledger: true,
          subscriptions: true,
          globalMemories: true,
          investments: true
        }}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /AI 记忆/ }));

    expect(onChange).toHaveBeenCalledWith({
      ledger: true,
      subscriptions: true,
      globalMemories: false,
      investments: true
    });
  });
});
