#!/usr/bin/env node
/**
 * 生成订阅品牌图标表 src/features/subscriptions/model/brandMarks.ts
 *
 * 为什么要「生成」而不是直接依赖图标包:
 * - 应用是本地优先的记账工具,订阅卡片必须在离线、内网下也能显示品牌 logo,
 *   所以不能走 favicon / 外部 CDN 运行时请求,必须内置进产物;
 * - 图标库有 3000+ 个图标,整体引入会把无关图标一起打进 bundle,
 *   这里只挑订阅场景真正用得到的一小撮,产物里只有用得到的那几十段 path。
 *
 * 图标来源:Simple Icons(https://simpleicons.org,CC0 1.0 公共领域)。
 * 商标归各自品牌所有,这里只用于标识「你订的是哪家的服务」。
 *
 * 少数常用品牌(中国移动、爱奇艺、优酷、腾讯视频等)不在 Simple Icons 里,
 * 这些品牌用「品牌色 + 文字标记」的瓦片表示,不自己乱画 logo。
 *
 * 用法:
 *   node scripts/generate-brand-icons.mjs           # 重新生成并写入文件
 *   node scripts/generate-brand-icons.mjs --check   # 只比对,文件过期时退出码 1
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = path.join(root, 'src/features/subscriptions/model/brandMarks.ts');
const CATALOG_URL = 'https://cdn.jsdelivr.net/npm/simple-icons@latest/_data/simple-icons.json';
const ICON_URL = (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`;

/**
 * 顺序即匹配优先级:越具体的品牌越靠前,避免「Apple Music」被「Apple」抢走,
 * 「腾讯视频」被「腾讯 QQ」抢走这类问题。
 * keywords 一律小写;匹配时两侧都会去掉空格,所以 'applemusic' 也能命中
 * 「Apple Music」。
 */
const BRANDS = [
  // —— Apple 生态:产品名互不相同,必须排在 Apple 前面 ——
  { slug: 'icloud', icon: 'iCloud', title: 'iCloud', keywords: ['icloud'] },
  {
    slug: 'applemusic',
    icon: 'Apple Music',
    title: 'Apple Music',
    keywords: ['applemusic', '苹果音乐']
  },
  { slug: 'appletv', icon: 'Apple TV', title: 'Apple TV', keywords: ['appletv', '苹果tv'] },
  { slug: 'appstore', icon: 'App Store', title: 'App Store', keywords: ['appstore'] },
  { slug: 'apple', icon: 'Apple', title: 'Apple', keywords: ['apple', '苹果'] },

  // —— 影音流媒体 ——
  { slug: 'netflix', icon: 'Netflix', title: 'Netflix', keywords: ['netflix', '奈飞'] },
  { slug: 'spotify', icon: 'Spotify', title: 'Spotify', keywords: ['spotify'] },
  {
    slug: 'youtubemusic',
    icon: 'YouTube Music',
    title: 'YouTube Music',
    keywords: ['youtubemusic', '油管音乐']
  },
  { slug: 'youtube', icon: 'YouTube', title: 'YouTube', keywords: ['youtube', '油管'] },
  {
    slug: 'primevideo',
    icon: 'Prime Video',
    title: 'Prime Video',
    keywords: ['primevideo', '亚马逊视频']
  },
  {
    slug: 'amazonprime',
    icon: 'Amazon Prime',
    title: 'Amazon Prime',
    keywords: ['amazonprime', '亚马逊prime', '亚马逊会员']
  },
  { slug: 'paramountplus', icon: 'Paramount+', title: 'Paramount+', keywords: ['paramount'] },
  { slug: 'hbomax', icon: 'HBO Max', title: 'HBO Max', keywords: ['hbomax', 'hbo'] },
  {
    slug: 'neteasecloudmusic',
    icon: 'NetEase Cloud Music',
    title: '网易云音乐',
    keywords: ['netease', '网易云']
  },
  {
    slug: 'bilibili',
    icon: 'Bilibili',
    title: '哔哩哔哩',
    keywords: ['bilibili', '哔哩哔哩', 'b站', '大会员']
  },
  { slug: 'tiktok', icon: 'TikTok', title: 'TikTok', keywords: ['tiktok', '抖音'] },
  { slug: 'kuaishou', icon: 'Kuaishou', title: '快手', keywords: ['kuaishou', '快手'] },
  { slug: 'douban', icon: 'Douban', title: '豆瓣', keywords: ['douban', '豆瓣'] },
  { slug: 'twitch', icon: 'Twitch', title: 'Twitch', keywords: ['twitch'] },

  // —— 国内常用但 Simple Icons 没有的品牌:品牌色 + 文字标记 ——
  {
    slug: 'chinamobile',
    title: '中国移动',
    label: '移动',
    hex: '0F86D8',
    keywords: ['中国移动', 'chinamobile', '移动']
  },
  {
    slug: 'chinaunicom',
    title: '中国联通',
    label: '联通',
    hex: 'E60012',
    keywords: ['中国联通', 'chinaunicom', '联通']
  },
  {
    slug: 'chinatelecom',
    title: '中国电信',
    label: '电信',
    hex: '0A5FA8',
    keywords: ['中国电信', 'chinatelecom', '电信']
  },
  {
    slug: 'iqiyi',
    title: '爱奇艺',
    label: '爱奇艺',
    hex: '00BE06',
    keywords: ['iqiyi', '爱奇艺', '奇异果']
  },
  {
    slug: 'youku',
    title: '优酷',
    label: '优酷',
    hex: '1BA6E1',
    keywords: ['youku', '优酷', '酷喵']
  },
  {
    slug: 'tencentvideo',
    title: '腾讯视频',
    label: '腾讯视频',
    hex: 'FF6022',
    keywords: ['腾讯视频', 'tencentvideo']
  },
  {
    slug: 'qqmusic',
    title: 'QQ 音乐',
    label: 'QQ音乐',
    hex: '31C27C',
    keywords: ['qqmusic', 'qq音乐']
  },
  { slug: 'kugou', title: '酷狗音乐', label: '酷狗', hex: '2CA2F9', keywords: ['kugou', '酷狗'] },
  {
    slug: 'baidunetdisk',
    title: '百度网盘',
    label: '网盘',
    hex: '06A7FF',
    keywords: ['百度网盘', 'baidunetdisk', '百度云']
  },
  { slug: 'xunlei', title: '迅雷', label: '迅雷', hex: '2179F5', keywords: ['xunlei', '迅雷'] },
  {
    slug: 'wps',
    title: 'WPS',
    label: 'WPS',
    hex: 'E6342F',
    keywords: ['wps', '金山办公', 'kingsoft']
  },
  {
    slug: 'disneyplus',
    title: 'Disney+',
    label: 'Disney+',
    hex: '113CCF',
    keywords: ['disney', '迪士尼']
  },
  {
    slug: 'microsoft365',
    title: 'Microsoft 365',
    label: 'M365',
    hex: 'D83B01',
    keywords: ['microsoft365', 'm365', 'office365', '微软']
  },
  {
    slug: 'adobe',
    title: 'Adobe',
    label: 'Adobe',
    hex: 'FF0000',
    keywords: ['adobe', 'photoshop', 'lightroom', 'creativecloud']
  },
  {
    slug: 'jd',
    title: '京东',
    label: '京东',
    hex: 'E1251B',
    keywords: ['京东', 'jd.com', 'jdplus', 'jd']
  },
  {
    slug: 'pinduoduo',
    title: '拼多多',
    label: '拼多多',
    hex: 'E02E24',
    keywords: ['拼多多', 'pinduoduo']
  },

  // —— 国内有图标的大厂/服务 ——
  { slug: 'sinaweibo', icon: 'Sina Weibo', title: '微博', keywords: ['weibo', '微博'] },
  { slug: 'zhihu', icon: 'Zhihu', title: '知乎', keywords: ['zhihu', '知乎', '盐选'] },
  { slug: 'alipay', icon: 'Alipay', title: '支付宝', keywords: ['alipay', '支付宝'] },
  { slug: 'wechat', icon: 'WeChat', title: '微信', keywords: ['wechat', '微信'] },
  { slug: 'qq', icon: 'QQ', title: 'QQ', keywords: ['腾讯qq', 'qq会员', 'qq超级会员', 'qq'] },
  { slug: 'xiaomi', icon: 'Xiaomi', title: '小米', keywords: ['xiaomi', '小米', '米家'] },
  { slug: 'huawei', icon: 'Huawei', title: '华为', keywords: ['huawei', '华为'] },
  { slug: 'baidu', icon: 'Baidu', title: '百度', keywords: ['baidu', '百度'] },
  { slug: 'taobao', icon: 'Taobao', title: '淘宝', keywords: ['taobao', '淘宝', '88vip'] },
  { slug: 'meituan', icon: 'Meituan', title: '美团', keywords: ['meituan', '美团', '大众点评'] },
  {
    slug: 'xiaohongshu',
    icon: 'Xiaohongshu',
    title: '小红书',
    keywords: ['xiaohongshu', '小红书', 'rednote']
  },

  // —— 生产力 / 开发者工具 ——
  { slug: 'notion', icon: 'Notion', title: 'Notion', keywords: ['notion'] },
  { slug: 'evernote', icon: 'Evernote', title: 'Evernote', keywords: ['evernote', '印象笔记'] },
  { slug: 'dropbox', icon: 'Dropbox', title: 'Dropbox', keywords: ['dropbox'] },
  {
    slug: 'googledrive',
    icon: 'Google Drive',
    title: 'Google Drive',
    keywords: ['googledrive', 'googleone', '谷歌云盘', '云端硬盘']
  },
  { slug: 'figma', icon: 'Figma', title: 'Figma', keywords: ['figma'] },
  { slug: 'canva', icon: 'Canva', title: 'Canva', keywords: ['canva'] },
  { slug: 'adobecreative', skip: true },
  { slug: 'grammarly', icon: 'Grammarly', title: 'Grammarly', keywords: ['grammarly'] },
  { slug: 'todoist', icon: 'Todoist', title: 'Todoist', keywords: ['todoist'] },
  { slug: 'trello', icon: 'Trello', title: 'Trello', keywords: ['trello'] },
  { slug: 'asana', icon: 'Asana', title: 'Asana', keywords: ['asana'] },
  { slug: 'airtable', icon: 'Airtable', title: 'Airtable', keywords: ['airtable'] },
  { slug: 'linear', icon: 'Linear', title: 'Linear', keywords: ['linear'] },
  { slug: 'github', icon: 'GitHub', title: 'GitHub', keywords: ['github', 'copilot'] },
  { slug: 'vercel', icon: 'Vercel', title: 'Vercel', keywords: ['vercel'] },
  { slug: 'cloudflare', icon: 'Cloudflare', title: 'Cloudflare', keywords: ['cloudflare'] },
  { slug: 'namecheap', icon: 'Namecheap', title: 'Namecheap', keywords: ['namecheap'] },
  { slug: 'godaddy', icon: 'GoDaddy', title: 'GoDaddy', keywords: ['godaddy'] },
  { slug: '1password', icon: '1Password', title: '1Password', keywords: ['1password'] },
  { slug: 'nordvpn', icon: 'NordVPN', title: 'NordVPN', keywords: ['nordvpn', 'nordvpn'] },

  // —— AI / 学习 / 娱乐 ——
  { slug: 'anthropic', icon: 'Anthropic', title: 'Claude', keywords: ['anthropic', 'claude'] },
  { slug: 'openai', icon: 'OpenAI', title: 'ChatGPT', keywords: ['openai', 'chatgpt'] },
  { slug: 'perplexity', icon: 'Perplexity', title: 'Perplexity', keywords: ['perplexity'] },
  { slug: 'duolingo', icon: 'Duolingo', title: '多邻国', keywords: ['duolingo', '多邻国'] },
  { slug: 'audible', icon: 'Audible', title: 'Audible', keywords: ['audible'] },
  { slug: 'medium', icon: 'Medium', title: 'Medium', keywords: ['medium'] },
  { slug: 'substack', icon: 'Substack', title: 'Substack', keywords: ['substack'] },
  { slug: 'steam', icon: 'Steam', title: 'Steam', keywords: ['steam'] },
  {
    slug: 'playstation',
    icon: 'PlayStation',
    title: 'PlayStation',
    keywords: ['playstation', 'psplus', 'psn']
  },
  { slug: 'discord', icon: 'Discord', title: 'Discord', keywords: ['discord'] },
  { slug: 'slack', icon: 'Slack', title: 'Slack', keywords: ['slack'] },
  { slug: 'zoom', icon: 'Zoom', title: 'Zoom', keywords: ['zoom'] }
].filter((brand) => !brand.skip);

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Simple Icons 的文件名不全是「标题去符号」(Paramount+ → paramountplus),
 * 所以先用候选写法挨个试,哪个能下载到就用哪个;下载 404 说明候选不对。
 */
async function fetchIconPath(title, explicitSlug) {
  const candidates = explicitSlug
    ? [explicitSlug]
    : [
        slugify(title),
        title.toLowerCase().replace(/[^a-z0-9]/g, ''),
        slugify(title.replace(/\s(max|plus|pro)$/i, ''))
      ].filter(Boolean);
  const tried = [];
  for (const candidate of [...new Set(candidates)]) {
    tried.push(candidate);
    const response = await fetch(ICON_URL(candidate));
    if (response.ok) return { slug: candidate, path: extractPaths(await response.text()) };
  }
  throw new Error(`图标文件里找不到「${title}」(尝试过:${tried.join(', ')})`);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

function extractPaths(svg) {
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((match) => match[1]);
  if (!paths.length) throw new Error('no <path> found');
  return paths.join(' ');
}

/**
 * 生成结果必须和仓库的 prettier 配置(单引号)一致,否则每次重新生成都会产生
 * 一份「只是引号不同」的 diff,`prettier --check` 也会失败。
 */
function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

async function main() {
  const checkMode = process.argv.includes('--check');

  // 先从 Simple Icons 目录里拿到「标题 → slug / 品牌色」,再按需下载图标本体,
  // 避免把 3000+ 个 svg 全拉一遍。
  const catalog = JSON.parse(await fetchText(CATALOG_URL));
  const byTitle = new Map(catalog.map((icon) => [String(icon.title).toLowerCase(), icon]));

  const records = [];
  for (const brand of BRANDS) {
    const keywords = brand.keywords.map((keyword) => keyword.toLowerCase().replace(/\s+/g, ''));
    if (!brand.icon) {
      records.push({
        slug: brand.slug,
        title: brand.title,
        hex: brand.hex,
        label: brand.label,
        keywords
      });
      continue;
    }

    const icon = byTitle.get(brand.icon.toLowerCase());
    if (!icon) throw new Error(`simple-icons 目录里找不到「${brand.icon}」`);

    const resolved = await fetchIconPath(icon.title, brand.iconSlug);
    records.push({
      slug: brand.slug,
      title: brand.title,
      hex: String(icon.hex).toUpperCase(),
      path: resolved.path,
      keywords
    });
    process.stderr.write(`ok ${brand.slug} <- ${resolved.slug}\n`);
  }

  const lines = [];
  lines.push('/**');
  lines.push(' * 订阅品牌标识表 —— 由 scripts/generate-brand-icons.mjs 生成,请勿手工编辑。');
  lines.push(' *');
  lines.push(' * 图标来源:Simple Icons(https://simpleicons.org),CC0 1.0 公共领域。');
  lines.push(' * 商标归各品牌所有,这里仅用于标识订阅的服务提供方。');
  lines.push(' *');
  lines.push(' * 部分国内常用品牌不在 Simple Icons 中(如中国移动、爱奇艺、优酷),');
  lines.push(' * 这些条目没有 path,只有品牌色和 label,由 UI 渲染成「品牌色 + 文字」瓦片。');
  lines.push(' */');
  lines.push('');
  lines.push('export interface BrandMark {');
  lines.push('  /** 稳定的品牌标识,用于 aria 文案与测试断言。 */');
  lines.push('  slug: string;');
  lines.push('  /** 品牌展示名。 */');
  lines.push('  title: string;');
  lines.push('  /** 品牌主色(十六进制,不含 #)。 */');
  lines.push('  hex: string;');
  lines.push('  /** 24x24 viewBox 下的图标路径;缺失时退回 label 文字瓦片。 */');
  lines.push('  path?: string;');
  lines.push('  /** 无图标时的文字标记。 */');
  lines.push('  label?: string;');
  lines.push('  /** 命中关键词(小写、去空格),顺序即匹配优先级。 */');
  lines.push('  keywords: string[];');
  lines.push('}');
  lines.push('');
  lines.push('export const BRAND_MARKS: BrandMark[] = [');
  records.forEach((record, index) => {
    const parts = [`    slug: ${quote(record.slug)}`];
    parts.push(`    title: ${quote(record.title)}`);
    parts.push(`    hex: ${quote(record.hex)}`);
    if (record.path) parts.push(`    path: ${quote(record.path)}`);
    if (record.label) parts.push(`    label: ${quote(record.label)}`);
    parts.push(`    keywords: [${record.keywords.map((keyword) => quote(keyword)).join(', ')}]`);
    lines.push('  {');
    lines.push(parts.join(',\n'));
    // 仓库的 prettier 配置是 trailingComma: none,最后一项不能带逗号。
    lines.push(index === records.length - 1 ? '  }' : '  },');
  });
  lines.push('];');
  lines.push('');

  const output = lines.join('\n');

  if (checkMode) {
    const current = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '';
    if (current !== output) {
      console.error('brandMarks.ts 已过期,请运行 node scripts/generate-brand-icons.mjs');
      process.exit(1);
    }
    console.log('brandMarks.ts is up to date');
    return;
  }

  writeFileSync(outputFile, output);
  console.log(
    `wrote ${path.relative(root, outputFile)} (${records.length} brands, ${Math.round(output.length / 1024)} KB)`
  );
}

await main();
