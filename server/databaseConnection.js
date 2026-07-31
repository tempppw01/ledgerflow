import mysql from 'mysql2/promise';

export function getMysqlConnectionOptions(env = process.env) {
  if (env.MYSQL_URL) {
    return env.MYSQL_URL;
  }

  return {
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER || 'ledgerflow',
    password: env.MYSQL_PASSWORD || '',
    database: env.MYSQL_DATABASE || 'ledgerflow',
    connectTimeout: Number(env.MYSQL_CONNECT_TIMEOUT_MS || 8000),
    ssl:
      env.MYSQL_SSL === 'true'
        ? { rejectUnauthorized: env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined
  };
}

export async function withMysqlConnection(handler, env = process.env) {
  const connection = await mysql.createConnection(getMysqlConnectionOptions(env));
  try {
    return await handler(connection);
  } finally {
    await connection.end();
  }
}
