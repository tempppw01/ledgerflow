import { describe, expect, it } from 'vitest';
import {
  getFileExtension,
  isValidBackupTime,
  validateBackupFile,
  validateBillFile
} from './backupFileGuards';

/**
 * 数据备份/账单导入的**文件闸门**。
 *
 * 这几个函数决定「这个文件收不收」—— 放错一个就是导错文件、或者覆盖掉正确数据。
 * 之前页面 1995 行、一条测试都没有;这里把闸门本身钉住(它们是纯函数,不需要渲染页面)。
 */

/** 造一个只有名字/类型/大小三个属性的假 File,够校验用。 */
function fakeFile(name: string, size = 1024, type = ''): File {
  return { name, size, type } as unknown as File;
}

/** 测试里的 tf:直接返回兜底文案(不接 i18n)。 */
const tf = ((_key: string, fallback?: string) => fallback ?? _key) as never;

describe('getFileExtension', () => {
  it('取最后一段扩展名并转小写', () => {
    expect(getFileExtension('backup.json')).toBe('.json');
    expect(getFileExtension('BACKUP.JSON')).toBe('.json');
    expect(getFileExtension('账单.2026-11.xlsx')).toBe('.xlsx');
  });

  it('没有扩展名返回空串', () => {
    expect(getFileExtension('noext')).toBe('');
  });
});

describe('validateBackupFile', () => {
  it('正常 JSON 通过', () => {
    expect(() => validateBackupFile(fakeFile('backup.json', 1024, 'application/json'), tf)).not.toThrow();
  });

  it('浏览器不给 mime 时,靠 .json 扩展名也通过', () => {
    expect(() => validateBackupFile(fakeFile('backup.json', 1024, ''), tf)).not.toThrow();
  });

  it('扩展名与 mime 都不是 JSON → 拒绝', () => {
    expect(() => validateBackupFile(fakeFile('notes.txt', 1024, 'text/plain'), tf)).toThrow(/仅支持 JSON/);
  });

  it('超过 50MB → 拒绝', () => {
    const tooBig = 50 * 1024 * 1024 + 1;
    expect(() => validateBackupFile(fakeFile('backup.json', tooBig, 'application/json'), tf)).toThrow(/文件过大/);
  });

  it('正好 50MB → 通过(边界)', () => {
    const exact = 50 * 1024 * 1024;
    expect(() => validateBackupFile(fakeFile('backup.json', exact, 'application/json'), tf)).not.toThrow();
  });
});

describe('validateBillFile', () => {
  it('csv / txt / xlsx 都通过,大写扩展名也算', () => {
    for (const name of ['bill.csv', 'bill.txt', 'bill.xlsx', 'BILL.XLSX']) {
      expect(() => validateBillFile(fakeFile(name), tf)).not.toThrow();
    }
  });

  it('不支持的扩展名 → 拒绝', () => {
    expect(() => validateBillFile(fakeFile('bill.pdf'), tf)).toThrow(/仅支持 CSV\/TXT\/XLSX/);
  });

  it('超过 10MB → 拒绝', () => {
    expect(() => validateBillFile(fakeFile('bill.csv', 10 * 1024 * 1024 + 1), tf)).toThrow(/文件过大/);
  });
});

describe('isValidBackupTime', () => {
  it('合法时间返回 true', () => {
    expect(isValidBackupTime('2026-11-25T00:00:00.000Z')).toBe(true);
  });

  it('空串与非法时间返回 false', () => {
    expect(isValidBackupTime('')).toBe(false);
    expect(isValidBackupTime('不是时间')).toBe(false);
  });
});