import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMarkdownContent } from './MarkdownRenderer';

describe('renderMarkdownContent', () => {
  it('renders markdown divider lines as horizontal rules', () => {
    const { container } = render(<>{renderMarkdownContent('前文\n---\n后文')}</>);

    expect(screen.getByText('前文')).toBeInTheDocument();
    expect(screen.getByText('后文')).toBeInTheDocument();
    expect(container.querySelector('hr.chat-md-divider')).toBeInTheDocument();
    expect(screen.queryByText('---')).not.toBeInTheDocument();
  });
});
