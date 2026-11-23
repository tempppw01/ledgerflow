type Translate = (key: string, fallback: string) => string;

/**
 * 判断一个错误是不是「浏览器网络层失败」。
 *
 * 各浏览器的文案不一样,靠英文串特征识别:
 *   Chrome  : TypeError: Failed to fetch
 *   Safari  : TypeError: Load failed
 *   Firefox : TypeError: NetworkError when attempting to fetch resource.
 *
 * 这类文案是给开发者看的,不该出现在界面上。判断只写这一处 ——
 * 仓库里原本散着三份(`backup.ts` 两处),而登录页正因为没做这个判断,
 * 断网时把 `Failed to fetch` 直接显示给了用户。
 */
export function isBrowserNetworkFailure(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  const message = (reason.message || '').trim();
  return (
    !message ||
    /failed to fetch|networkerror|load failed/i.test(message) ||
    reason.name === 'TypeError'
  );
}

/** 客户端自己造的 "HTTP 503" —— 服务端没给出可读文案时的兜底。 */
export function isBareHttpStatusMessage(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  return /^HTTP \d{3}$/.test((reason.message || '').trim());
}

export interface RequestFailureCopy {
  /** 网络不可达 */
  networkKey: string;
  networkFallback: string;
  /** 服务端返回非 2xx 但没带可读文案 */
  httpStatusKey?: string;
  httpStatusFallback?: string;
  /** 抛出来的根本不是 Error(字符串、undefined 等),文案要更笼统 */
  unknownKey?: string;
  unknownFallback?: string;
}

/**
 * 把一次请求失败转成能给用户看的文案。
 *
 * 请求失败有两类,以前被一视同仁地 `reason.message` 直接上屏:
 *
 * 1. **服务端给出的业务文案** —— `邮箱或密码不正确。`、`WebDAV 配置不合法`。
 *    这种必须原样保留,否则用户不知道错在哪。
 * 2. **技术性失败** —— 网络不可达时的 `Failed to fetch`、非 2xx 且响应体没带
 *    message 时的 `HTTP 503`。这些不该给用户看。
 *
 * 两类都是 `Error`,所以不能简单改成"永远用兜底文案"(那会丢掉第 1 类),
 * 只能按 message 的形状区分。
 */
export function describeRequestFailure(
  reason: unknown,
  tf: Translate,
  copy: RequestFailureCopy
): string {
  if (!(reason instanceof Error)) {
    // 抛出来的不是 Error:拿不到任何线索,用更笼统的文案(有配置时)。
    if (copy.unknownKey && copy.unknownFallback) {
      return tf(copy.unknownKey, copy.unknownFallback);
    }
    return tf(copy.networkKey, copy.networkFallback);
  }

  if (isBrowserNetworkFailure(reason)) {
    return tf(copy.networkKey, copy.networkFallback);
  }

  if (isBareHttpStatusMessage(reason) && copy.httpStatusKey && copy.httpStatusFallback) {
    return tf(copy.httpStatusKey, copy.httpStatusFallback);
  }

  return reason.message;
}
