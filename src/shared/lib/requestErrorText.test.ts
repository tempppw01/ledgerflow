import { describe, expect, it } from 'vitest';
import {
  describeRequestFailure,
  isBareHttpStatusMessage,
  isBrowserNetworkFailure
} from './requestErrorText';

const tf = (key: string, fallback: string) => `[${key}] ${fallback}`;

const COPY = {
  networkKey: 'x.network',
  networkFallback: '连不上服务,请检查网络后重试。',
  httpStatusKey: 'x.httpStatus',
  httpStatusFallback: '服务暂时不可用,请稍后再试。',
  unknownKey: 'x.unknown',
  unknownFallback: '操作失败。'
};

describe('isBrowserNetworkFailure', () => {
  it('认出三大浏览器各自的网络失败文案', () => {
    // Chrome / Edge
    expect(isBrowserNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    // Safari
    expect(isBrowserNetworkFailure(new TypeError('Load failed'))).toBe(true);
    // Firefox
    expect(
      isBrowserNetworkFailure(new TypeError('NetworkError when attempting to fetch resource.'))
    ).toBe(true);
  });

  it('空 message 或 TypeError 一律按网络失败处理', () => {
    expect(isBrowserNetworkFailure(new TypeError(''))).toBe(true);
    expect(isBrowserNetworkFailure(new TypeError('something else'))).toBe(true);
  });

  it('服务端业务错误不会被误判', () => {
    expect(isBrowserNetworkFailure(new Error('邮箱或密码不正确。'))).toBe(false);
    expect(isBrowserNetworkFailure(new Error('HTTP 503'))).toBe(false);
    expect(isBrowserNetworkFailure('not an error')).toBe(false);
  });
});

describe('isBareHttpStatusMessage', () => {
  it('只认客户端自己造的 HTTP xxx', () => {
    expect(isBareHttpStatusMessage(new Error('HTTP 503'))).toBe(true);
    expect(isBareHttpStatusMessage(new Error('HTTP 401'))).toBe(true);
    expect(isBareHttpStatusMessage(new Error('HTTP 503 服务不可用'))).toBe(false);
    expect(isBareHttpStatusMessage(new Error('邮箱或密码不正确。'))).toBe(false);
  });
});

describe('describeRequestFailure', () => {
  // 这一整组的重点:技术串换成可读文案,而服务端业务文案原样保留。
  it('网络失败 → 可读文案', () => {
    expect(describeRequestFailure(new TypeError('Failed to fetch'), tf, COPY)).toContain(
      'x.network'
    );
  });

  it('裸 HTTP 状态 → 可读文案', () => {
    expect(describeRequestFailure(new Error('HTTP 502'), tf, COPY)).toContain('x.httpStatus');
  });

  it('服务端业务文案原样返回', () => {
    expect(describeRequestFailure(new Error('该邮箱已被注册。'), tf, COPY)).toBe(
      '该邮箱已被注册。'
    );
  });

  it('非 Error 抛出物 → 单独的笼统文案', () => {
    expect(describeRequestFailure('boom', tf, COPY)).toContain('x.unknown');
  });

  it('没配 unknown 文案时退回网络文案(不返回空)', () => {
    const result = describeRequestFailure('boom', tf, {
      networkKey: 'x.network',
      networkFallback: '连不上服务。'
    });
    expect(result).toContain('x.network');
  });

  it('没配 HTTP 文案时,裸状态串仍按原样返回(不吞掉信息)', () => {
    const result = describeRequestFailure(new Error('HTTP 500'), tf, {
      networkKey: 'x.network',
      networkFallback: '连不上服务。'
    });
    expect(result).toBe('HTTP 500');
  });
});
