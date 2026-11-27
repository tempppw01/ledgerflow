export const ALIPAY_LOGO_URL =
  '/cdn/ui/alipay-logo.svg';

export const WECHAT_LOGO_URL =
  '/cdn/ui/wechat-logo.svg';

export const CHAT_ICON_URL =
  '/cdn/ui/chat.svg';

export const USER_ICON_URL =
  '/cdn/ui/user.svg';

export const BOT_ICON_URL =
  '/cdn/ui/bot.svg';

export const CIRCLE_USER_ICON_URL =
  '/cdn/ui/circle-user.svg';

export const DEFAULT_ANIME_AVATAR_URL = '/default-anime-avatar.svg';

export const CLOUD_SYNC_ICON_URL =
  '/cdn/ui/cloud-sync.svg';

export const PACKAGE_ICON_URL =
  '/cdn/ui/package.svg';

export const GLOBE_ICON_URL =
  '/cdn/ui/globe.svg';

export const COPY_ICON_URL =
  '/cdn/ui/copy.svg';

export const ROTATE_CCW_ICON_URL =
  '/cdn/ui/rotate-ccw.svg';

export const SUN_ICON_URL =
  '/cdn/ui/sun.svg';

export const MOON_ICON_URL =
  '/cdn/ui/moon.svg';

export const MONITOR_ICON_URL =
  '/cdn/ui/monitor.svg';

export const CHEVRONS_RIGHT_LEFT_ICON_URL =
  '/cdn/ui/chevrons-right-left.svg';

export const CHEVRONS_LEFT_RIGHT_ICON_URL =
  '/cdn/ui/chevrons-left-right.svg';

export const CHEVRON_DOWN_ICON_URL =
  '/cdn/ui/chevron-down.svg';

export const EYE_ICON_URL =
  '/cdn/ui/eye.svg';

export const EYE_OFF_ICON_URL =
  '/cdn/ui/eye-off.svg';

export const DASHBOARD_ICON_URL =
  '/cdn/ui/chart-no-axes-combined.svg';

export const INVESTMENTS_ICON_URL =
  '/cdn/ui/chart-spline.svg';

export const BACKUP_ICON_URL =
  '/cdn/ui/cloud-upload.svg';

export const RESTORE_ICON_URL =
  '/cdn/ui/cloud-download.svg';

export const SETTINGS_ICON_URL =
  '/cdn/ui/settings.svg';

export const DATA_INPUT_ILLUSTRATION_URL =
  '/cdn/ui/data-input.svg';

export const BRAIN_ICON_URL =
  '/cdn/ui/brain.svg';

export const CALENDAR_ICON_URL =
  '/cdn/ui/calendar.svg';

export const DATABASE_ICON_URL =
  '/cdn/ui/database.svg';

export const BADGE_DOLLAR_SIGN_ICON_URL =
  '/cdn/ui/badge-dollar-sign.svg';

export const WALLET_CARDS_ICON_URL =
  '/cdn/ui/wallet-cards.svg';

export const CREDIT_CARDS_ICON_URL =
  '/cdn/ui/credit-card.svg';

export const SCALE_ICON_URL =
  '/cdn/ui/scale.svg';

export const LANDMARK_ICON_URL =
  '/cdn/ui/landmark.svg';

export const IMAGE_ICON_URL =
  '/cdn/ui/image.svg';

export const WEBANK_ICON_URL =
  '/cdn/public/webank.png';

export const JIEBEI_ICON_URL =
  '/cdn/public/jiebei.png';

export const BAITIAO_ICON_URL =
  '/cdn/public/baitiao.png';

export const ANYIHUA_ICON_URL =
  '/cdn/public/msxf.png';

export const FANGXINJIE_ICON_URL =
  '/cdn/public/fangxinjie.png';

export const QIFUJIETIAO_ICON_URL =
  '/cdn/public/qifujietiao.webp';

export const CARD_SD_ICON_URL =
  '/cdn/ui/card-sd.svg';

export const ARCHIVE_ICON_URL =
  '/cdn/ui/archive.svg';

export const TRASH_ICON_URL =
  '/cdn/ui/trash.svg';

export const TRASH_2_ICON_URL =
  '/cdn/ui/trash-2.svg';

export const STAR_ICON_URL =
  '/cdn/ui/star.svg';

export const STAR_OFF_ICON_URL =
  '/cdn/ui/star-off.svg';

export const PRINTER_ICON_URL =
  '/cdn/ui/printer.svg';

export const PEN_TOOL_ICON_URL =
  '/cdn/ui/pen-tool.svg';

export const QUESTION_ICON_URL =
  '/cdn/ui/question.svg';

export const INFO_ICON_URL =
  '/cdn/ui/info.svg';

export const ABOUT_HAPPY_ILLUSTRATION_URL =
  '/cdn/ui/happy.svg';

export const AWESOME_ILLUSTRATION_URL =
  '/cdn/Illustrations/awesome.svg';

export const INVESTMENT_HERO_ILLUSTRATION_URL =
  '/cdn/Illustrations/investment-hero.svg';

/**
 * PDF 导出用的中文字体。
 *
 * 必须走同源 /cdn 代理,不能直接写 R2 公共域名:该域名不返回
 * Access-Control-Allow-Origin,浏览器 fetch 会被 CORS 拦下,于是
 * getCachedChineseFontBytes 抛错、整个 PDF 导出直接失败(不只是缺字)。
 * vite / localDevServer / nginx 都已把 /cdn 反代到 R2。
 */
export const PDF_CHINESE_FONT_URL = '/cdn/fonts/NotoSansSC-Regular.ttf';
