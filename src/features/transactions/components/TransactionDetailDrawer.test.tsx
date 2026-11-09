import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TransactionDetailDrawer } from './TransactionDetailDrawer';
import { ALIPAY_LOGO_URL, WECHAT_LOGO_URL } from '../../../shared/config/brandAssets';

vi.mock('../../../shared/lib/backup', () => ({
  loadWebdavConfig: vi.fn(() => ({
    endpoint: '',
    username: '',
    password: '',
    remoteFilePath: 'ledgerflow/backup.json',
    proxyEnabled: true,
    proxyBasePath: '/api/webdav'
  })),
  sanitizeWebdavConfig: vi.fn((input) => input),
  webdavUploadFile: vi.fn()
}));

const sample = {
  id: 'tx_1',
  type: 'expense' as const,
  categoryId: 'cat-1',
  accountId: 'acc-1',
  amount: 100,
  date: new Date('2026-01-01').toISOString(),
  updatedAt: new Date('2026-01-02T10:30:00').toISOString(),
  note: '午餐',
  tags: ['餐饮'],
  merchantOrderNo: 'MERCHANT-123456'
};

describe('TransactionDetailDrawer', () => {
  it('点击复制 JSON 触发回调', () => {
    const onCopyJson = vi.fn();

    render(
      <MemoryRouter>
        <TransactionDetailDrawer
          open
          transaction={sample}
          categoryName="餐饮"
          accountName="现金"
          source="manual"
          onClose={() => undefined}
          onCopyNote={() => undefined}
          onCopyJson={onCopyJson}
          onShareBill={() => undefined}
          onDelete={() => undefined}
          onAiRecategorize={() => undefined}
          privacyMode
          onQuickAdd={() => undefined}
        />
      </MemoryRouter>
    );

    expect(screen.getAllByText('¥••••').length).toBeGreaterThan(0);
    expect(screen.getByText('ME***56')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '复制 JSON' }));
    expect(onCopyJson).toHaveBeenCalledTimes(1);
  });

  it('应显示收支圆圈标签，并在支付宝账户显示图标', () => {
    render(
      <MemoryRouter>
        <TransactionDetailDrawer
          open
          transaction={sample}
          categoryName="餐饮"
          accountName="支付宝"
          source="manual"
          onClose={() => undefined}
          onCopyNote={() => undefined}
          onCopyJson={() => undefined}
          onShareBill={() => undefined}
          onDelete={() => undefined}
          onAiRecategorize={() => undefined}
          onQuickAdd={() => undefined}
        />
      </MemoryRouter>
    );

    expect(screen.getByLabelText('支出')).toBeInTheDocument();
    expect(document.querySelectorAll('.alipay-icon').length).toBeGreaterThan(0);
    expect(document.querySelector('.alipay-icon')).toHaveAttribute('src', ALIPAY_LOGO_URL);
    expect(screen.getByText('最后修改')).toBeInTheDocument();
  });

  it('应在微信账户显示 OSS 微信图标', () => {
    render(
      <MemoryRouter>
        <TransactionDetailDrawer
          open
          transaction={sample}
          categoryName="餐饮"
          accountName="微信"
          source="manual"
          onClose={() => undefined}
          onCopyNote={() => undefined}
          onCopyJson={() => undefined}
          onShareBill={() => undefined}
          onDelete={() => undefined}
          onAiRecategorize={() => undefined}
          onQuickAdd={() => undefined}
        />
      </MemoryRouter>
    );

    expect(document.querySelector('.wechat-icon')).toHaveAttribute('src', WECHAT_LOGO_URL);
  });

  it('应展示退款冲正关系，并可在时间轴模式显示关联原单', () => {
    render(
      <MemoryRouter>
        <TransactionDetailDrawer
          open
          transaction={{
            ...sample,
            id: 'tx-refund',
            amount: 25,
            adjustmentKind: 'refund',
            refundOfTransactionId: 'tx-origin'
          }}
          categoryName="餐饮"
          accountName="支付宝"
          source="alipay"
          relatedOrigin={{
            id: 'tx-origin',
            type: 'expense',
            categoryId: 'cat-1',
            accountId: 'acc-1',
            amount: 88,
            date: new Date('2026-01-02').toISOString(),
            note: '原始订单',
            tags: []
          }}
          relatedRefunds={[]}
          onClose={() => undefined}
          onCopyNote={() => undefined}
          onCopyJson={() => undefined}
          onShareBill={() => undefined}
          onDelete={() => undefined}
          onAiRecategorize={() => undefined}
          onQuickAdd={() => undefined}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('退款 / 冲正')).toBeInTheDocument();
    expect(screen.getByLabelText('退款')).toHaveClass('transaction-type-badge-income');
    expect(screen.getByText('+¥25.00')).toHaveClass('text-income');
    expect(screen.getByText(/原始订单/)).toBeInTheDocument();

    expect(screen.getByText(/关联原单：原始订单/)).toBeInTheDocument();
  });

  it('未配置 WebDAV 时应提示不可上传', () => {
    const onAttachmentUploadStatus = vi.fn();

    render(
      <MemoryRouter>
        <TransactionDetailDrawer
          open
          transaction={sample}
          categoryName="餐饮"
          accountName="现金"
          source="manual"
          onClose={() => undefined}
          onCopyNote={() => undefined}
          onCopyJson={() => undefined}
          onShareBill={() => undefined}
          onDelete={() => undefined}
          onAiRecategorize={() => undefined}
          onAttachmentUploadStatus={onAttachmentUploadStatus}
          onQuickAdd={() => undefined}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '上传附件' }));
    expect(onAttachmentUploadStatus).toHaveBeenCalledWith(
      expect.stringContaining('WebDAV 配置'),
      'warning'
    );
  });

  it('点击分享账单触发回调', () => {
    const onShareBill = vi.fn();

    render(
      <MemoryRouter>
        <TransactionDetailDrawer
          open
          transaction={sample}
          categoryName="餐饮"
          accountName="现金"
          source="manual"
          onClose={() => undefined}
          onCopyNote={() => undefined}
          onCopyJson={() => undefined}
          onShareBill={onShareBill}
          onDelete={() => undefined}
          onAiRecategorize={() => undefined}
          onQuickAdd={() => undefined}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    expect(onShareBill).toHaveBeenCalledTimes(1);
  });

  it('仅对已完成普通交易显示退款入口', () => {
    const renderDrawer = (status: 'completed' | 'pending') =>
      render(
        <MemoryRouter>
          <TransactionDetailDrawer
            open
            transaction={{ ...sample, status }}
            categoryName="餐饮"
            accountName="现金"
            source="manual"
            onClose={() => undefined}
            onCopyNote={() => undefined}
            onCopyJson={() => undefined}
            onShareBill={() => undefined}
            onDelete={() => undefined}
            onRefund={() => undefined}
            onAiRecategorize={() => undefined}
            onQuickAdd={() => undefined}
          />
        </MemoryRouter>
      );

    const completedView = renderDrawer('completed');
    expect(screen.getByRole('button', { name: /发起退款/ })).toBeInTheDocument();

    completedView.unmount();
    renderDrawer('pending');
    expect(screen.queryByRole('button', { name: /发起退款/ })).not.toBeInTheDocument();
  });
});
