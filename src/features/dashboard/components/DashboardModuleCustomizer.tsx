export interface DashboardModuleCustomizerItem {
  id: string;
  label: string;
  description: string;
  checked: boolean;
}

export interface DashboardModuleCustomizerProps {
  title: string;
  hint: string;
  items: DashboardModuleCustomizerItem[];
  draggingModuleId: string | null;
  onDragStart: (moduleId: string) => void;
  onDrop: (moduleId: string) => void;
  onDragEnd: () => void;
  onToggle: (moduleId: string, checked: boolean) => void;
}

export function DashboardModuleCustomizer({
  title,
  hint,
  items,
  draggingModuleId,
  onDragStart,
  onDrop,
  onDragEnd,
  onToggle
}: DashboardModuleCustomizerProps) {
  const enabledCount = items.filter((item) => item.checked).length;
  const shouldShowBadge = enabledCount > 0 && enabledCount < items.length;

  return (
    <section className="dashboard-module-customizer" aria-label={title}>
      <div className="dashboard-module-customizer-head">
        <div className="dashboard-module-customizer-copy">
          <h4>{title}</h4>
          <p>{hint}</p>
        </div>
        {shouldShowBadge ? (
          <span className="dashboard-module-customizer-badge">
            {enabledCount}/{items.length}
          </span>
        ) : null}
      </div>
      <div className="dashboard-module-manage-list" aria-label={title}>
        {items.map((item) => (
          <label
            key={item.id}
            className={`dashboard-module-manage-item ${item.checked ? 'is-enabled' : 'is-disabled'}`}
            draggable
            onDragStart={() => onDragStart(item.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDrop(item.id)}
            onDragEnd={onDragEnd}
            title={item.description}
            data-dragging={draggingModuleId === item.id ? 'true' : 'false'}
          >
            <div className="dashboard-module-manage-main">
              <span className="dashboard-module-drag-handle" aria-hidden="true">
                ::
              </span>
              <div className="dashboard-module-manage-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </div>
            </div>
            <div className="dashboard-module-manage-tail">
              <span className="dashboard-module-switch">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(event) => onToggle(item.id, event.target.checked)}
                  aria-label={item.label}
                />
                <span aria-hidden="true" />
              </span>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
