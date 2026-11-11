import type { StringTable } from './ui-i18n.js';
/** What each shipped language calls itself. */
export const LOCALE_NAMES: Record<'en' | 'zh-Hant' | 'ar', string>;
/** The toolkit's own strings: English, Traditional Chinese, Arabic. */
export const LOCALES: Record<'en' | 'zh-Hant' | 'ar', StringTable>;
