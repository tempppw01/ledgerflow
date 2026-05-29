import { type ReactNode } from 'react';

/**
 * Render inline markdown (bold **text**) to React nodes.
 */
export function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const strongRegex = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = strongRegex.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(<strong key={`md-strong-${match.index}`}>{match[1]}</strong>);
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * Parse a markdown table row.
 */
const parseTableRow = (line: string) =>
  line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());

const isTableSeparator = (line: string) => {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

const isTableRow = (line: string) => /^\|.+\|$/.test(line);

const isMarkdownDivider = (line: string) => /^ {0,3}(?:-{3,}|\*{3,}|_{3,})$/.test(line);

/**
 * Render full markdown content (headings, lists, tables, paragraphs) to React nodes.
 */
export function renderMarkdownContent(raw: string): ReactNode[] {
  const lines = raw.split(/\n/);
  const nodes: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    nodes.push(
      <ul key={`md-ul-${nodes.length}`} className="chat-md-list">
        {bullets.map((item, idx) => (
          <li key={`md-li-${idx}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx].trim();
    if (!line) {
      flushBullets();
      continue;
    }

    if (isMarkdownDivider(line)) {
      flushBullets();
      nodes.push(<hr key={`md-hr-${idx}`} className="chat-md-divider" />);
      continue;
    }

    const nextLine = lines[idx + 1]?.trim() || '';
    if (isTableRow(line) && isTableSeparator(nextLine)) {
      flushBullets();
      const headerCells = parseTableRow(line);
      const rows: string[][] = [];
      idx += 2;
      while (idx < lines.length) {
        const rowLine = lines[idx].trim();
        if (!isTableRow(rowLine)) break;
        const rowCells = parseTableRow(rowLine);
        if (rowCells.length > 0) rows.push(rowCells);
        idx += 1;
      }
      idx -= 1;

      nodes.push(
        <div key={`md-table-${nodes.length}`} className="chat-md-table-wrap">
          <table className="chat-md-table">
            <thead>
              <tr>
                {headerCells.map((cell, cellIdx) => (
                  <th key={`md-th-${cellIdx}`}>{renderInlineMarkdown(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={`md-tr-${rowIdx}`}>
                  {headerCells.map((_, colIdx) => (
                    <td key={`md-td-${rowIdx}-${colIdx}`}>
                      {renderInlineMarkdown(row[colIdx] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushBullets();
      const level = headingMatch[1].length;
      const title = headingMatch[2];
      nodes.push(
        <p key={`md-h-${idx}`} className={`chat-md-heading chat-md-h${level}`}>
          {renderInlineMarkdown(title)}
        </p>
      );
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      bullets.push(bulletMatch[1]);
      continue;
    }

    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      bullets.push(`${numberedMatch[1]}. ${numberedMatch[2]}`);
      continue;
    }

    flushBullets();
    nodes.push(
      <p key={`md-p-${idx}`} className="chat-md-paragraph">
        {renderInlineMarkdown(line)}
      </p>
    );
  }

  flushBullets();
  return nodes;
}
