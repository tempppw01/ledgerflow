import { useTFallback } from '../../../shared/lib/useTFallback';
import type { WorkbenchStatus } from './workbenchTypes';

interface WorkbenchTopbarProps {
  status: WorkbenchStatus;
  providerText: string;
  onOpenSettings: () => void;
}

export function WorkbenchTopbar({ status, providerText, onOpenSettings }: WorkbenchTopbarProps) {
  const tf = useTFallback();
  const statusText: Record<WorkbenchStatus, string> = {
    idle: tf('assistant.workbench.status.idle', '待输入'),
    ready: tf('assistant.workbench.status.ready', '可识别'),
    recognizing: tf('assistant.workbench.status.recognizing', '识别中'),
    preview: tf('assistant.workbench.status.preview', '可预览'),
    saving: tf('assistant.workbench.status.saving', '保存中'),
    saved: tf('assistant.workbench.status.saved', '已保存'),
    error: tf('assistant.workbench.status.error', '异常')
  };

  return (
    <header className="assistant-wb-topbar panel">
      <div>
        <h2 className="assistant-wb-title">
          🤖 {tf('assistant.workbench.title', 'AI 记账工作台')}
        </h2>
      </div>
      <div className="assistant-wb-topbar-actions">
        <span className={STATUS_CLASS[status]}>{statusText[status]}</span>
        <span className="assistant-wb-provider" title={providerText}>
          {providerText}
        </span>
        <button type="button" onClick={onOpenSettings}>
          {tf('assistant.workbench.settings', 'AI 设置')}
        </button>
      </div>
    </header>
  );
}

const STATUS_CLASS: Record<WorkbenchStatus, string> = {
  idle: 'badge badge-primary',
  ready: 'badge badge-primary',
  recognizing: 'badge badge-warning',
  preview: 'badge badge-success',
  saving: 'badge badge-warning',
  saved: 'badge badge-success',
  error: 'badge badge-danger'
};
