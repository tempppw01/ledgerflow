import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../i18n/locales/en/translation.json';
import zh from '../../i18n/locales/zh/translation.json';

/*
 * 侧边栏第一组的组名不能和组内第一项的名字一字不差。
 *
 * 原来的样子:组标题 nav.assistant =「AI 助手」/「AI Assistant」,
 * 组内第一项的 label 是 getAssistantModeLabel(默认模式)= 同一个字符串 ——
 * 渲染出来就是"AI 助手"标题下面紧跟一个"AI 助手",看不出层级(实测截图确认过)。
 *
 * 组名现在用类别名 nav.aiTools(这组三项:助手 / 智能预算 / 全局记忆)。
 * 项名保持动态(默认 AI 助手 / AI 信用卡助手 / AI 投资助手),那是有信息量的,不能为了
 * 去重把它改掉 —— 它同时被助手页标题与设置页标签使用。
 */
describe('侧边栏分组标题', () => {
  it('组名与助手项的名字必须不同(中英都是)', () => {
    expect(zh.nav.aiTools).toBeTruthy();
    expect(en.nav.aiTools).toBeTruthy();

    expect(zh.nav.aiTools).not.toBe(zh.nav.assistant);
    expect(zh.nav.aiTools).not.toBe(zh.assistant.ui.assistantMode);
    expect(en.nav.aiTools).not.toBe(en.nav.assistant);
    expect(en.nav.aiTools).not.toBe(en.assistant.ui.assistantMode);
  });

  it('AppLayout 里这一组的标题确实用的是 nav.aiTools', () => {
    /*
     * 这里读源码而不是渲染 AppLayout:渲染它要拖进 auth context、SettingsPage、
     * 数据同步门与一堆 store(jsdom 里代价很大、也容易假失败),而"这一组标题取哪个 key"
     * 就是这一行的全部真相。把 key 改回去(哪怕资源两条都在)会被这条测试拦下。
     */
    const source = readFileSync(
      path.join(process.cwd(), 'src/widgets/layout/AppLayout.tsx'),
      'utf8'
    );
    expect(source).toContain("tFallback('nav.aiTools'");
    expect(source).not.toContain("title: tFallback('nav.assistant'");
  });
});
