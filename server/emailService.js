import nodemailer from 'nodemailer';

function normalizeAppUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function getPasswordResetEmailConfig(env = process.env) {
  const host = String(env.LEDGERFLOW_SMTP_HOST || '').trim();
  const from = String(env.LEDGERFLOW_SMTP_FROM || '').trim();
  const appUrl = normalizeAppUrl(env.LEDGERFLOW_APP_URL);
  if (!host || !from || !appUrl) return null;

  const port = Number(env.LEDGERFLOW_SMTP_PORT || 587);
  return {
    host,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 587,
    secure: String(env.LEDGERFLOW_SMTP_SECURE || '').toLowerCase() === 'true',
    user: String(env.LEDGERFLOW_SMTP_USER || '').trim(),
    password: String(env.LEDGERFLOW_SMTP_PASSWORD || ''),
    from,
    appUrl
  };
}

export function isPasswordResetEmailConfigured(env = process.env) {
  return Boolean(getPasswordResetEmailConfig(env));
}

export async function sendPasswordResetEmail({ to, token, expiresMinutes }, env = process.env) {
  const config = getPasswordResetEmailConfig(env);
  if (!config) {
    const error = new Error('密码重置邮件服务尚未配置,请联系管理员。');
    error.statusCode = 503;
    throw error;
  }

  const resetUrl = new URL(config.appUrl);
  resetUrl.searchParams.set('resetToken', token);
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user
      ? {
          user: config.user,
          pass: config.password
        }
      : undefined
  });

  try {
    await transport.sendMail({
      from: config.from,
      to,
      subject: 'LedgerFlow 密码重置',
      text: [
        '你正在重置 LedgerFlow 账号密码。',
        '',
        `请在 ${expiresMinutes} 分钟内打开以下链接设置新密码:`,
        resetUrl.toString(),
        '',
        '如果这不是你的操作,请忽略这封邮件,你的密码不会发生变化。'
      ].join('\n'),
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#172033">
          <h2 style="margin:0 0 16px">重置 LedgerFlow 密码</h2>
          <p>你正在重置 LedgerFlow 账号密码。链接将在 ${expiresMinutes} 分钟后失效,且只能使用一次。</p>
          <p style="margin:24px 0">
            <a href="${resetUrl.toString()}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#225ea8;color:#fff;text-decoration:none;font-weight:600">
              设置新密码
            </a>
          </p>
          <p style="color:#667085;font-size:13px">如果这不是你的操作,请忽略这封邮件,你的密码不会发生变化。</p>
        </div>
      `
    });
  } catch (error) {
    const wrapped = new Error('重置邮件发送失败,请稍后重试或联系管理员。');
    wrapped.statusCode = 502;
    wrapped.cause = error;
    throw wrapped;
  }
}
