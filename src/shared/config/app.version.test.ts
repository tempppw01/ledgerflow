import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from './app';

/**
 * 界面上的版本号来自 src/shared/config/app.ts,而发布用的版本号在 package.json,
 * 两者是分开维护的。v0.8.0 那次就只涨了 package.json,界面一直显示 v0.8.0,
 * 直到 v0.8.1 才被发现。这里加一条守卫:发布时忘掉任何一处,测试就会红。
 *
 * 注意不要在 vitest 里用 `new URL('../../package.json', import.meta.url)`:
 * jsdom 环境下 import.meta.url 是 http:// 开头的,会抛 ERR_INVALID_URL_SCHEME。
 * 用 process.cwd()(vitest 的工作目录就是仓库根目录)拼路径最稳。
 */
describe('APP_VERSION', () => {
  it('与 package.json 的 version 保持一致', () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
    ) as { version?: string };

    expect(APP_VERSION).toBe(packageJson.version);
  });

  it('是合法的 semver', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
