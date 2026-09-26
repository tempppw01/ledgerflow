import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from './PasswordInput';

function ApiKeyField() {
  const [value, setValue] = useState('sk-this-is-a-long-secret-api-key');

  return (
    <PasswordInput
      aria-label="API Key"
      compactMask
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

describe('PasswordInput compact mask', () => {
  it('shows a short fixed mask, then reveals and edits the actual value', () => {
    render(<ApiKeyField />);
    const input = screen.getByLabelText('API Key') as HTMLInputElement;

    expect(input.value).toBe('••••••••');
    expect(input.readOnly).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '显示内容' }));
    expect(input.value).toBe('sk-this-is-a-long-secret-api-key');
    expect(input.readOnly).toBe(false);

    fireEvent.change(input, { target: { value: 'sk-updated' } });
    expect(input.value).toBe('sk-updated');
  });
});
