# UI动画优化总结

> **⚠ 这是一份历史记录,里面的文件路径不保证仍然存在。**
> 2026-11-25 核对时发现:文中多次提到的 `src/shared/hooks/useUIAnimations.ts` 在仓库里**已经没有了**
> (全仓搜不到任何引用),而 `src/shared/hooks/` 现在只剩 `usePwaInstallPrompt` / `useResolvedTheme` /
> `useUnsyncedChangesGuard` 三个。所以文中写的文件路径与那段 `import` 示例**照抄会失败**。
>
> 保留原文而不改写,是为了留住当时的判断与数据;要查现在的做法,请看代码与
> `docs/verified-invariants.md`,不要以本文档为准。


## 概述
根据提供的UI&动画优化规则，已完成P0、P1、P2优先级的核心优化工作。

## 完成的工作

### 1. P0优先级 - 核心操作反馈
**文件**: `src/app/styles/ui-animations.css`

- ✅ 按钮点击涟漪效果 (`ripple` 动画)
- ✅ 按钮按压缩放反馈 (0.97倍缩放)
- ✅ 危险操作特殊脉冲反馈 (`danger-pulse` 动画)
- ✅ 成功操作闪光反馈 (`success-flash` 动画)

**关键类名**:
- `.success-action` - 成功操作反馈
- `button.danger:active` - 危险按钮脉冲

### 2. P0优先级 - 金额展示规范
**文件**: 
- `src/app/styles/ui-animations.css`
- `src/app/styles/global.css` (修改)

- ✅ 统一金额颜色使用CSS变量 (`--color-income`, `--color-expense`)
- ✅ 金额变更动效 (`amount-up` / `amount-down` 动画)
- ✅ 大金额数字强调样式
- ✅ 暗色模式对比度优化
- ✅ 固定了硬编码的颜色值，改用设计系统变量

**关键类名**:
- `.amount-income` / `.amount-expense` - 统一金额颜色
- `.amount-change-up` / `.amount-change-down` - 金额变更动效
- `.balance-amount` - 大金额强调

### 3. P0优先级 - 列表类动效
**文件**:
- `src/app/styles/ui-animations.css`
- `src/shared/hooks/useUIAnimations.ts` (新建)

- ✅ 新增记录淡入动画 (`list-item-enter`)
- ✅ 删除记录淡出动画 (`list-item-exit`)
- ✅ 拖拽时样式优化 (`list-item-dragging`)
- ✅ 拖拽放置区域提示 (`drag-drop-indicator`)
- ✅ 列表项hover效果 (稳重不夸张)
- ✅ React钩子支持 (`useListItemAnimation`, `useDragAnimation`)

**关键类名**:
- `.list-item-enter` / `.list-item-exit` - 列表项进入退出
- `.list-item-dragging` - 拖拽中样式
- `.drag-drop-indicator` - 放置指示器

### 4. P1优先级 - 页面切换
**文件**: `src/app/styles/ui-animations.css`

- ✅ 页面进入动画 (`page-in`)
- ✅ 页面退出动画 (`page-out`)
- ✅ 低干扰设计，动效持续时间适中

**关键类名**:
- `.page-enter` / `.page-exit` - 页面切换动画

### 5. P1优先级 - Toast提示
**文件**: `src/app/styles/ui-animations.css`

- ✅ Toast进入动画 (`toast-in`)
- ✅ Toast退出动画 (`toast-out`)
- ✅ 低干扰，不打断用户操作

**关键类名**:
- `.toast-enter` / `.toast-exit` - Toast动画

### 6. P2优先级 - 响应式适配
**文件**: `src/app/styles/ui-animations.css`

- ✅ 移动端触摸反馈优化 (最小44px触摸区域)
- ✅ 移动端列表动效加速
- ✅ 移动端金额显示适配

### 7. P2优先级 - 深浅模式切换
**文件**:
- `src/app/styles/ui-animations.css`
- `src/features/theme-switcher/ThemeSwitcher.tsx` (修改)

- ✅ 主题切换平滑过渡 (0.4s ease)
- ✅ 动效禁用支持 (辅助功能)
- ✅ 尊重用户 `prefers-reduced-motion` 偏好

**关键类名**:
- `.theme-transition` - 主题切换时启用
- `.no-animations` - 完全禁用动效
- `.low-motion` - 低动效模式

## React钩子工具

**文件**: `src/shared/hooks/useUIAnimations.ts`

提供了5个实用钩子来简化动画实现：

1. `useListItemAnimation` - 列表项进入/退出动画
2. `useDragAnimation` - 拖拽重排动效
3. `useAmountAnimation` - 金额变更动画
4. `useButtonFeedback` - 按钮点击反馈
5. `useThemeTransition` - 主题切换过渡

## 使用示例

### 金额显示
```tsx
<span className="amount-income">+¥128.50</span>
<span className="amount-expense">-¥68.00</span>
```

### 列表项动画
```tsx
import { useListItemAnimation } from 'shared/hooks/useUIAnimations';

function MyListItem() {
  const { getAnimationClassName } = useListItemAnimation();
  return <div className={getAnimationClassName()}>...</div>;
}
```

### 主题切换
自动集成在ThemeSwitcher组件中，无需额外配置。

## 设计原则遵循

✅ **稳重清晰定位**: 动效克制，避免夸张
✅ **交互反馈优先**: 所有操作都有即时反馈
✅ **列表类动效**: 流畅的进入退出和拖拽
✅ **金额动效规范**: 统一颜色，平滑变更
✅ **低干扰原则**: 动效不打断用户操作
✅ **响应式适配**: 移动端友好
✅ **辅助功能**: 支持减少动效偏好

## 文件清单

### 新建文件
1. `src/app/styles/ui-animations.css` - 动画样式
2. `src/shared/hooks/useUIAnimations.ts` - 动画钩子

### 修改文件
1. `src/app/styles/index.css` - 引入动画样式
2. `src/app/styles/global.css` - 金额颜色优化
3. `src/features/theme-switcher/ThemeSwitcher.tsx` - 主题切换过渡
