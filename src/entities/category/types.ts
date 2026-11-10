export interface Category {
  id: string;
  name: string;
  kind?: 'income' | 'expense';
  /** 上级分类 id;为空表示一级分类。当前最多支持两级。 */
  parentId?: string;
  color?: string;
  icon?: string;
  sortOrder?: number;
  trashedAt?: string;
}
