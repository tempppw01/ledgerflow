import { useState } from 'react';
import { ConnectionConfigForm } from './ConnectionConfigForm';
import { useTFallback } from '../../../shared/lib/useTFallback';
import {
  deleteConnection,
  listConnections,
  saveConnection,
  toggleConnection
} from '../model/connectionStorage';
import { ConnectionConfigCard } from './ConnectionConfigCard';
import { ConnectionFormValues } from '../model/connectionFormSchema';

export function ConnectionConfigManager() {
  const tf = useTFallback();
  const [, setRefreshTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const rows = listConnections();

  function refresh() {
    setRefreshTick((value) => value + 1);
  }

  function handleSave(values: ConnectionFormValues) {
    saveConnection(values);
    setAdding(false);
    setEditingId(null);
    refresh();
  }

  return (
    <section id="connection-config-manager" className="connection-config-manager">
      <div
        className="row"
        style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}
      >
        <div>
          <h3 style={{ margin: 0 }}>{tf('dbSettings.connection.managerTitle', "连接配置管理（MySQL / Redis）")}</h3>
          <p
            style={{
              margin: '6px 0 0',
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--font-sm)'
            }}
          >{tf('dbSettings.connection.managerHint', " 常用默认已预填：localhost、默认端口，以及 MySQL 库名 ledgerflow / Redis DB 0。只在需要时再改。 ")}</p>
        </div>
        <button className="primary" onClick={() => setAdding((value) => !value)}>
          {adding ? tf('dbSettings.connection.collapseCreate', '收起新增') : tf('dbSettings.connection.addConnection', '新增连接')}
        </button>
      </div>

      {adding ? <ConnectionConfigForm onSubmit={handleSave} onCancel={() => setAdding(false)} /> : null}

      <div className="connection-config-list">
        {rows.length === 0 && !adding ? <p>{tf('dbSettings.connection.empty', "暂无连接配置，需要时点“新增连接”即可。")}</p> : null}
        {rows.map((item) => (
          <ConnectionConfigCard
            key={item.id}
            item={item}
            editing={editingId === item.id}
            onEdit={() => setEditingId(item.id)}
            onCancelEdit={() => setEditingId(null)}
            onDelete={() => {
              deleteConnection(item.id);
              refresh();
            }}
            onToggle={(enabled) => {
              toggleConnection(item.id, enabled);
              refresh();
            }}
            onSave={handleSave}
          />
        ))}
      </div>
    </section>
  );
}
