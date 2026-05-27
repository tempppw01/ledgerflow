import { PasswordInput } from '../../../shared/ui/PasswordInput';

interface WorkbenchSettingsDrawerProps {
  open: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  memoryDays: number;
  memoryBackend: 'local' | 'redis';
  models: string[];
  onClose: () => void;
  onChangeBaseUrl: (value: string) => void;
  onChangeApiKey: (value: string) => void;
  onChangeModel: (value: string) => void;
  onChangeMemoryDays: (value: number) => void;
  onChangeMemoryBackend: (value: 'local' | 'redis') => void;
  onResetWorkbench: () => void;
}

export function WorkbenchSettingsDrawer(props: WorkbenchSettingsDrawerProps) {
  const {
    open,
    baseUrl,
    apiKey,
    model,
    memoryDays,
    memoryBackend,
    models,
    onClose,
    onChangeBaseUrl,
    onChangeApiKey,
    onChangeModel,
    onChangeMemoryDays,
    onChangeMemoryBackend,
    onResetWorkbench
  } = props;

  if (!open) return null;

  return (
    <div className="drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="AI 设置抽屉"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-header">
          <h3>AI 设置</h3>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="drawer-body">
          <label className="field">
            <span>Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => onChangeBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>

          <div className="field">
            <label>API Key</label>
            <PasswordInput
              value={apiKey}
              onChange={(e) => onChangeApiKey(e.target.value)}
              placeholder="sk-..."
              showLabel="显示密钥"
              hideLabel="隐藏密钥"
            />
          </div>

          <div className="field">
            <span>模型</span>
            <input
              value={model}
              onChange={(e) => onChangeModel(e.target.value)}
              placeholder="gpt-4o-mini"
            />
            {models.length > 0 ? (
              <div className="assistant-wb-model-chips">
                {models.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={
                      item === model ? 'assistant-wb-model-chip active' : 'assistant-wb-model-chip'
                    }
                    onClick={() => onChangeModel(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <label className="field">
            <span>上下文保留天数（1-3）</span>
            <input
              type="number"
              min={1}
              max={3}
              value={memoryDays}
              onChange={(e) => onChangeMemoryDays(Number(e.target.value) || 1)}
            />
          </label>

          <label className="field">
            <span>上下文存储后端</span>
            <select
              value={memoryBackend}
              onChange={(e) => onChangeMemoryBackend(e.target.value as 'local' | 'redis')}
            >
              <option value="local">local</option>
              <option value="redis">redis</option>
            </select>
          </label>

          <button type="button" onClick={onResetWorkbench}>
            重置当前工作台
          </button>
        </div>
      </aside>
    </div>
  );
}
