import { describe, expect, it } from 'vitest';
import { describeAuthError } from './authErrorText';

/** 测试里用 key 直接回显,便于断言走到哪个分支。 */
const tf = (key: string, fallback: string) => `[${key}] ${fallback}`;

describe('describeAuthError', () => {
  // 这一组盯的是「不能把浏览器的技术串漏给用户」:
  // 登录页曾经直接 setError(reason.message),断网时界面显示的是英文 `Failed to fetch`。
  describe('技术性失败换成可读文案', () => {
    it('网络不可达(Chrome 的 Failed to fetch)', () => {
      const reason = new TypeError('Failed to fetch');
      expect(describeAuthError(reason, tf)).toContain('auth.networkUnreachable');
    });

    it('网络不可达(Safari 的 Load failed)', () => {
      const reason = new TypeError('Load failed');
      expect(describeAuthError(reason, tf)).toContain('auth.networkUnreachable');
    });

    it('网络不可达(Firefox 的 NetworkError)', () => {
      const reason = new TypeError('NetworkError when attempting to fetch resource.');
      expect(describeAuthError(reason, tf)).toContain('auth.networkUnreachable');
    });

    it('TypeError 但文案认不出,仍按网络失败处理', () => {
      const reason = new TypeError('');
      expect(describeAuthError(reason, tf)).toContain('auth.networkUnreachable');
    });

    it('客户端造的 HTTP 503', () => {
      expect(describeAuthError(new Error('HTTP 503'), tf)).toContain('auth.serviceUnavailable');
      expect(describeAuthError(new Error('HTTP 401'), tf)).toContain('auth.serviceUnavailable');
    });

    it('非 Error 的抛出物', () => {
      expect(describeAuthError('boom', tf)).toContain('auth.operationFailed');
      expect(describeAuthError(undefined, tf)).toContain('auth.operationFailed');
    });
  });

  // 反过来:服务端给的业务文案必须原样保留,不能被兜底文案吃掉。
  // 否则「邮箱或密码不正确」会变成「账号操作失败」,用户不知道错在哪。
  describe('服务端业务文案原样保留', () => {
    it('密码错误', () => {
      expect(describeAuthError(new Error('邮箱或密码不正确。'), tf)).toBe('邮箱或密码不正确。');
    });

    it('邮箱已被注册', () => {
      expect(describeAuthError(new Error('该邮箱已被注册。'), tf)).toBe('该邮箱已被注册。');
    });

    it('很长的中文提示不被误判为技术串', () => {
      const message = '登录尝试过于频繁,请稍后再试。';
      expect(describeAuthError(new Error(message), tf)).toBe(message);
    });

    it('英文业务文案同样保留(后端可能返回英文)', () => {
      expect(describeAuthError(new Error('Email already registered.'), tf)).toBe(
        'Email already registered.'
      );
    });
  });
});
