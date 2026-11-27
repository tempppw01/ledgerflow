import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../shared/config/app';
import { RELEASE_HISTORY, RELEASE_HISTORY_LIMIT } from './recentReleases.generated';

/**
 * 关于页「最近更新」是**生成出来**的数据(`npm run gen:release-history`)。
 * 这些断言守住它的两条性质:
 *
 *   1. 内容本身讲得通(版本号降序、标题非空、摘要里没有残留 markdown);
 *   2. **和当前版本对得上** —— 最新一条必须是 `APP_VERSION`。
 *      这条最要紧:版本号改了却忘了重新生成时,页面会一本正经地显示上一个版本,
 *      而它的来源(已打包的数据文件)本身不会报错。
 *
 * 注意:数据与 release-notes 的**逐字一致**由 `npm run check:release-history` 守(CI 里跑),
 * 这里不重复做那件事 —— 单元测试看不到 release-notes(Docker 构建上下文里就没有)。
 */
describe('recentReleases.generated', () => {
  it('按版本号严格降序,没有重复', () => {
    const versions = RELEASE_HISTORY.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);

    const sorted = [...versions].sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i += 1) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return 0;
    });
    expect(versions).toEqual(sorted);
  });

  it('保留了约定的条数', () => {
    expect(RELEASE_HISTORY).toHaveLength(RELEASE_HISTORY_LIMIT);
  });

  it('第一条就是当前版本(改版本号/加发布说明后必须重新生成)', () => {
    expect(
      RELEASE_HISTORY[0]?.version,
      '关于页的第一条应当是当前版本。两种可能:① 改版本号/加发布说明之后忘了跑 npm run gen:release-history;' +
        '② 提交了比当前版本更新的发布说明(那会让界面显示一个用户还没有的版本)'
    ).toBe(APP_VERSION);
  });

  it('每条都是 x.y.z、有标题、有中文摘要', () => {
    for (const entry of RELEASE_HISTORY) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.title.trim()).not.toBe('');
      expect(entry.summary.trim()).not.toBe('');
      // 摘要取自中文发布说明,不该出现英文占位或"待补"
      expect(entry.summary).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it('摘要里没有残留的 markdown 标记(行内代码/加粗/链接/标题符)', () => {
    for (const entry of RELEASE_HISTORY) {
      for (const value of [entry.title, entry.summary]) {
        expect(value).not.toMatch(/[*`{}[\]]/);
        expect(value).not.toMatch(/^#/);
        expect(value).not.toMatch(/\s{2,}/);
      }
    }
  });

  it('摘要不超过声明上限(截断只在句末或加省略号)', () => {
    for (const entry of RELEASE_HISTORY) {
      // 生成器按 150 字截断,句末截断时不会再补省略号
      expect(entry.summary.length).toBeLessThanOrEqual(151);
    }
  });

  it('发布日期要么是 YYYY-MM-DD,要么是 null', () => {
    for (const entry of RELEASE_HISTORY) {
      if (entry.publishedOn === null) continue;
      expect(entry.publishedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(`${entry.publishedOn}T00:00:00`).getTime())).toBe(false);
    }
  });
});
