import { ConnectionConfig } from '../../../entities/connection/types';
import { ConnectionConfigForm } from './ConnectionConfigForm';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { ConnectionFormValues } from '../model/connectionFormSchema';

interface ConnectionConfigCardProps {
  item: ConnectionConfig;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onSave: (values: ConnectionFormValues) => void;
  onCancelEdit: () => void;
}

export function ConnectionConfigCard(props: ConnectionConfigCardProps) {
  const { item, editing, onEdit, onDelete, onToggle, onSave, onCancelEdit } = props;
  const tf = useTFallback();

  if (editing) {
    return (
      <ConnectionConfigForm
        initialValues={item}
        onSubmit={(values) => onSave({ ...values, id: item.id })}
        onCancel={onCancelEdit}
      />
    );
  }

  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>
          {item.name} <small className="mono">({item.type})</small>
        </strong>
        <label>{tf('dbSettings.connection.enabled', " 启用 ")}<input checked={item.enabled} onChange={(e) => onToggle(e.target.checked)} type="checkbox" />
        </label>
      </div>
      <p>
        {item.host}:{item.port} / timeout {item.timeoutMs}ms
      </p>
      <small className="mono">updated: {item.updatedAt}</small>
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={onEdit}>{tf('dbSettings.connection.edit', "编辑")}</button>
        <button onClick={onDelete} className="danger">{tf('dbSettings.connection.delete', " 删除 ")}</button>
      </div>
    </section>
  );
}
