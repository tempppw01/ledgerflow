import { useState } from 'react';
import { formatDateTime } from '../../../shared/lib/format';
import { useDebugLogStore } from '../../../shared/store/useDebugLogStore';

export function DebugLogPanel() {
  if (!import.meta.env.DEV) {
    return null;
  }

  const logs = useDebugLogStore((s) => s.logs);
  const clearLogs = useDebugLogStore((s) => s.clearLogs);
  const [open, setOpen] = useState(false);

  return (
    <aside className="debug-log-fab-wrap">
      <button
        type="button"
        className="debug-log-fab"
        aria-label={open ? '收起调试日志' : '展开调试日志'}
        onClick={() => setOpen((v) => !v)}
      >
        🐞{logs.length > 0 ? ` ${logs.length}` : ''}
      </button>

      {open ? (
        <section className="panel debug-log-panel debug-log-floating">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>首页调试日志</h3>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" onClick={clearLogs} disabled={logs.length === 0}>
                清空日志
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
          </div>

          {logs.length === 0 ? (
            <p className="debug-log-empty">暂无调试日志</p>
          ) : (
            <div className="debug-log-scroll" aria-label="调试日志滚动容器">
              {logs
                .slice()
                .reverse()
                .map((item) => (
                  <article key={item.id} className={`debug-log-item debug-${item.status}`}>
                    <div className="debug-log-meta">
                      <span className="mono-inline">{formatDateTime(item.timestamp)}</span>
                      <span className="badge badge-primary">{item.action}</span>
                      {item.dbType ? <span className="badge">{item.dbType.toUpperCase()}</span> : null}
                    </div>
                    <p>{item.message}</p>
                  </article>
                ))}
            </div>
          )}
        </section>
      ) : null}
    </aside>
  );
}
