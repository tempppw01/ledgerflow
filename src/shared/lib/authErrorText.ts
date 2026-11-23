import { describeRequestFailure } from './requestErrorText';

type Translate = (key: string, fallback: string) => string;

/**
 * 账号接口失败的文案。
 *
 * 背景:登录页曾经直接 `setError(reason.message)`,于是断网时界面上显示的是
 * 浏览器内部的英文串 `Failed to fetch`。账号接口的失败分两类 ——
 * 服务端给的可读业务文案(如「邮箱或密码不正确。」)必须保留,
 * 技术性失败(网络不可达、`HTTP 503`)要换成可读文案。
 *
 * 分类与文案策略见 shared/lib/requestErrorText,这里只提供账号场景的文案。
 */
export function describeAuthError(reason: unknown, tf: Translate): string {
  return describeRequestFailure(reason, tf, {
    networkKey: 'auth.networkUnreachable',
    networkFallback: '连接不上账号服务,请检查网络后重试。',
    httpStatusKey: 'auth.serviceUnavailable',
    httpStatusFallback: '账号服务暂时不可用,请稍后再试。',
    unknownKey: 'auth.operationFailed',
    unknownFallback: '账号操作失败。'
  });
}
