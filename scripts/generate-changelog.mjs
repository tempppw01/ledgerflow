#!/usr/bin/env node
/**
 * 从 release-notes/ 生成 CHANGELOG.md 的索引。
 *
 * 背景:release-notes/ 里躺着近百份逐版说明,但没有索引 —— 想知道「哪一版改了什么」
 * 只能一个个文件名去翻。这个脚本按语义版本排序,取每份说明的**第一个二级标题**作为摘要,
 * 按 minor 线分组,输出带链接的索引。
 *
 * 只读 release-notes/、只写 CHANGELOG.md,不碰任何其它文件。
 * 用法:node scripts/generate-changelog.mjs
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_DIR = path.join(ROOT, 'release-notes');
const OUT = path.join(ROOT, 'CHANGELOG.md');

const FILE_RE = /^RELEASE_NOTES_v(\d+)\.(\d+)\.(\d+)\.md$/;

function compareVersion(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

const entries = [];
for (const file of readdirSync(NOTES_DIR)) {
  const match = FILE_RE.exec(file);
  if (!match) continue;
  const entry = {
    file,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
  entry.version = `${entry.major}.${entry.minor}.${entry.patch}`;

  const text = readFileSync(path.join(NOTES_DIR, file), 'utf8');
  const heading = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^##\s+/.test(line));
  entry.summary = heading ? heading.replace(/^##\s+/, '') : '(无标题)';
  entries.push(entry);
}

entries.sort((a, b) => compareVersion(b, a)); // 新版本在前

const lines = [
  '# 变更索引',
  '',
  '> 这份文件由 `node scripts/generate-changelog.mjs` 从 `release-notes/` 生成,**不要手改**。',
  '> 每条右侧链接指向该版本的完整说明。',
  ''
];

let currentMinor = null;
for (const entry of entries) {
  const minorKey = `${entry.major}.${entry.minor}`;
  if (minorKey !== currentMinor) {
    currentMinor = minorKey;
    lines.push(`## ${minorKey}.x`, '');
    lines.push('| 版本 | 说明 |', '| --- | --- |');
  }
  lines.push(`| [v${entry.version}](release-notes/${entry.file}) | ${entry.summary} |`);
  const next = entries[entries.indexOf(entry) + 1];
  if (!next || `${next.major}.${next.minor}` !== minorKey) {
    lines.push('');
  }
}

writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log('已生成 CHANGELOG.md:' + entries.length + ' 个版本,' + lines.length + ' 行');