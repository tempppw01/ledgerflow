export const APP_VERSION = '0.52.3';
export const APP_GITHUB_URL = 'https://github.com/tempppw01/ledgerflow';
/*
 * 品牌图走同源小图(public/logo-128.png,8.7 KB),不再用 R2 上那张 1254×1254 / 2.3 MB 的原图。
 *
 * 它的显示尺寸只有 32px(侧栏)/ 48-56px(登录页、关于页),而原来每次打开都要先下 2.3 MB
 * 才画得出这个方块 —— 实测过:慢一点的连接上,侧栏那个位置会空着直到图到。
 * 原图仍留在 R2(`/cdn/public/logo.png?v=2`),需要大图时直接从那儿取。
 */
export const APP_LOGO_URL = '/logo-128.png?v=1';
