import type { TfFallback } from '../../shared/lib/useTFallback';

/**
 * 备份 / 账单导入的**文件闸门**。
 *
 * 单独一个模块,不是顺手抽的:
 *   · 这几个函数决定「这个文件收不收」—— 放错一个就是导错文件、或者把好数据覆盖掉;
 *   · 它们原来写在 `DatabaseSettingsPage.tsx` 里,而那是 1995 行、**一条测试都没有**的组件文件;
 *   · 而且 React Fast Refresh 要求组件文件只导出组件(react-refresh/only-export-components),
 *     这些函数放在页面文件里连导出都不行,只能靠渲染整个页面来测。
 *
 * 现在它们是纯函数:输入一个 File(只要 name / size / type),要么通过,要么抛出带文案的错误。
 */

export const MAX_BACKUP_FILE_SIZE_MB = 50;
export const MAX_BACKUP_FILE_SIZE_BYTES = MAX_BACKUP_FILE_SIZE_MB * 1024 * 1024;
export const MAX_BILL_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const BACKUP_ACCEPTED_MIME_TYPES = new Set(['application/json', 'text/json']);
const BILL_ACCEPTED_EXTENSIONS = new Set(['.csv', '.txt', '.xlsx']);

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index < 0) return '';
  return fileName.slice(index).toLowerCase();
}

export function validateBackupFile(file: File, tf: TfFallback): void {
  const ext = getFileExtension(file.name);
  const hasValidMime = !file.type || BACKUP_ACCEPTED_MIME_TYPES.has(file.type);
  const hasValidExt = ext === '.json';

  // 扩展名或 MIME 有一个像 JSON 就放行:浏览器常给 .json 空 MIME,
  // 而真正的格式校验在解析那一步。
  if (!hasValidMime && !hasValidExt) {
    throw new Error(tf('dataBackup.import.error.notJson', '备份导入失败:仅支持 JSON 文件(.json)'));
  }

  if (file.size > MAX_BACKUP_FILE_SIZE_BYTES) {
    throw new Error(
      tf(
        'dataBackup.import.error.tooLarge',
        '备份导入失败:文件过大,请上传不超过 {max}MB 的 JSON 备份'
      ).replace('{max}', String(MAX_BACKUP_FILE_SIZE_MB))
    );
  }
}

export function validateBillFile(file: File, tf: TfFallback): void {
  const ext = getFileExtension(file.name);
  if (!BILL_ACCEPTED_EXTENSIONS.has(ext)) {
    throw new Error(
      tf('dataBackup.bill.error.unsupportedType', '账单导入失败:仅支持 CSV/TXT/XLSX 文件')
    );
  }

  if (file.size > MAX_BILL_FILE_SIZE_BYTES) {
    throw new Error(
      tf('dataBackup.bill.error.tooLarge', '账单导入失败:文件过大,请上传不超过 10MB 的账单文件')
    );
  }
}

export function isValidBackupTime(value: string): boolean {
  return Boolean(value) && !Number.isNaN(new Date(value).getTime());
}