import { tApiError as t } from '../../../shared/lib/apiErrorTranslator';

export interface ParsedConnectionString {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
}

const PROTOCOL_MAP: Record<'redis' | 'mysql', string[]> = {
  redis: ['redis', 'rediss'],
  mysql: ['mysql', 'mysqls']
};

function normalizeProtocol(raw: string) {
  return raw.replace(':', '').toLowerCase();
}

export function parseConnectionString(connectionString: string, type: 'redis' | 'mysql') {
  try {
    const url = new URL(connectionString);
    const protocol = normalizeProtocol(url.protocol);

    if (!PROTOCOL_MAP[type].includes(protocol)) {
      return {
        ok: false as const,
        error: t('dbSettings.connection.error.protocolMismatch', "协议不匹配：{type} 连接应使用 {protocols}://").replace("{type}", String(type)).replace("{protocols}", String(PROTOCOL_MAP[type].join('/')))
      };
    }

    const port = url.port ? Number(url.port) : undefined;
    if (port && (port < 1 || port > 65535)) {
      return { ok: false as const, error: t('dbSettings.connection.error.portRange', '端口必须在 1-65535') };
    }

    const parsed: ParsedConnectionString = {
      host: url.hostname,
      port,
      username: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      database: url.pathname.replace(/^\//, '') || undefined
    };

    return { ok: true as const, parsed };
  } catch {
    return { ok: false as const, error: t('dbSettings.connection.error.connectionStringInvalid', '连接串格式不正确，请检查协议、主机、端口和路径') };
  }
}
