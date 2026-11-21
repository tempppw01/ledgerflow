#!/usr/bin/env node
/**
 * 禁止 fetch() 直接请求 R2 公共域名。
 *
 * 背景:界面字体和 PDF 导出字体都曾直接 fetch
 * `pub-….r2.dev/...`,而该域名不返回 Access-Control-Allow-Origin,
 * 浏览器会拦下请求。PDF 那次更严重 —— 取字体失败会 throw,整个导出不可用。
 *
 * 注意:出问题的写法是 `fetch(PDF_CHINESE_FONT_URL)`,参数是**常量**,
 * 所以只看 fetch 调用的字面量是抓不到的。本脚本先把「值里含 r2.dev 的常量」
 * 找出来,再检查 fetch 有没有用到它们(或直接用 r2.dev 字面量)。
 *
 * 正确做法:走同源 /cdn 代理(vite / localDevServer / nginx 都已反代到 R2)。
 *
 * 用法:node scripts/check-no-r2-fetch.mjs   有问题退出码 1
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

const files = listSourceFiles(srcDir);
const contents = new Map();
for (const f of files) contents.set(f, readFileSync(f, 'utf8'));

// 1) 收集「值里含 r2.dev」的常量名
const r2Consts = new Map(); // name -> defining file
const constRe = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([\s\S]{0,400}?);\s*\n/g;
for (const [f, src] of contents) {
  let m;
  constRe.lastIndex = 0;
  while ((m = constRe.exec(src)) !== null) {
    if (/r2\.dev/.test(m[2])) r2Consts.set(m[1], f);
  }
}

const findings = [];

// 2) 直接 fetch 里出现 r2.dev 字面量
const fetchLiteralRe = /fetch\(\s*(['"`])([^'"`]*)\1/g;
for (const [f, src] of contents) {
  let m;
  fetchLiteralRe.lastIndex = 0;
  while ((m = fetchLiteralRe.exec(src)) !== null) {
    if (!/r2\.dev/.test(m[2])) continue;
    const line = src.slice(0, m.index).split('\n').length;
    findings.push(`${path.relative(root, f)}:${line}  fetch("${m[2].slice(0, 60)}")`);
  }

  // 3) fetch(常量),而该常量的值是 r2.dev
  const fetchIdentRe = /fetch\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
  fetchIdentRe.lastIndex = 0;
  while ((m = fetchIdentRe.exec(src)) !== null) {
    const name = m[1];
    if (!r2Consts.has(name)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    findings.push(
      `${path.relative(root, f)}:${line}  fetch(${name})  <- 该常量在 ${path.relative(root, r2Consts.get(name))} 里指向 r2.dev`
    );
  }
}

if (findings.length) {
  console.log(`R2-FETCH — fetch() 直接请求 R2 公共域名(CORS 会被拦),共 ${findings.length} 处:`);
  for (const f of findings) console.log('  ' + f);
  console.log('\n修复:改用同源 /cdn 路径,或为该资源补反代。');
  process.exit(1);
}

console.log('R2-FETCH — 0 处,全部走同源 /cdn 或非 fetch 加载 ✓');