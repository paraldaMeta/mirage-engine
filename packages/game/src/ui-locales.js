// Mirage original code. The toolkit's own strings (widgets and the kit menu) in English, Traditional Chinese and
// Arabic: the sample tables, and the proof that plural rules, interpolation and right-to-left hold together.
// createUIKit() lays them under the game's tables (a game's own string for the same key wins).
// ---------------------------------------------------------------------------
// import { LOCALES, LOCALE_NAMES } from '@mirage/game/ui-locales';
// const i18n = createI18n({ locale: 'zh-Hant', tables: { en: { 'game.title': 'Courtyard' }, 'zh-Hant': { 'game.title': '庭院' } } });
// A new language: i18n.add('fr', { 'ui.close': 'Fermer', ... }); keys it lacks fall back to English and are listed
// in i18n.missing. Messages are ICU-style: {name}, {n, plural, one {# item} other {# items}}, {n, number, percent}.
// ---------------------------------------------------------------------------

/** What each language calls itself (a language picker shows these, never a translated name). */
export const LOCALE_NAMES = { en: 'English', 'zh-Hant': '繁體中文', ar: 'العربية' };

const en = {
  'ui.close': 'Close', 'ui.back': 'Back', 'ui.confirm': 'Confirm', 'ui.cancel': 'Cancel', 'ui.select': 'Select', 'ui.on': 'On', 'ui.off': 'Off',
  'ui.reset': 'Reset to defaults', 'ui.pressKey': 'Press a key…', 'ui.rebind': '{action}: {key}. Press to change.', 'ui.rebound': '{action} is now {key}',
  'ui.next': 'Continue', 'ui.skip': 'Skip', 'ui.previous': 'Previous', 'ui.following': 'Next',
  'ui.inventory': 'Inventory', 'ui.emptySlot': 'Slot {n}, empty', 'ui.slot': 'Slot {n}: {item}', 'ui.slotCount': 'Slot {n}: {item}, {count, number}',
  'ui.picked': '{item} picked up. Choose a slot.', 'ui.moved': '{item} moved to slot {n}.', 'ui.dropCancelled': 'Move cancelled.',
  'ui.items': '{n, plural, =0 {No items} one {# item} other {# items}}',
  'ui.objectives': 'Objectives', 'ui.objectiveDone': 'Completed: {text}', 'ui.minimap': 'Minimap', 'ui.north': 'N', 'ui.notifications': 'Notifications',
  'ui.health': 'Health', 'ui.stamina': 'Stamina', 'ui.of': '{value, number, integer} of {max, number, integer}', 'ui.radial': 'Quick menu', 'ui.dialogue': 'Dialogue',
  'menu.paused': 'Paused', 'menu.start': 'Start', 'menu.resume': 'Resume', 'menu.settings': 'Settings', 'menu.save': 'Save', 'menu.load': 'Load', 'menu.restart': 'Restart',
  'menu.controls': 'Controls', 'menu.audio': 'Audio', 'menu.display': 'Display', 'menu.game': 'Game', 'menu.master': 'Master volume', 'menu.music': 'Music', 'menu.sfx': 'Effects', 'menu.ambience': 'Ambience', 'menu.ui': 'Interface sounds',
  'menu.language': 'Language', 'menu.theme': 'Theme', 'menu.textScale': 'Text size', 'menu.reduceMotion': 'Reduce motion', 'menu.sensitivity': 'Look sensitivity', 'menu.invertY': 'Invert look', 'menu.quality': 'Quality',
  'menu.slot': 'Slot {n}', 'menu.slotEmpty': 'Slot {n}: empty', 'menu.slotSaved': 'Slot {n}: {when}', 'menu.saved': 'Saved to slot {n}.', 'menu.loaded': 'Loaded slot {n}.', 'menu.restartAsk': 'Restart from the beginning? Unsaved progress is lost.',
  'menu.exportSave': 'Export save', 'menu.importSave': 'Import save', 'menu.error': 'That did not work: {error}', 'menu.imported': 'Loaded from file.',
  'menu.touchHint': 'Left side: move. Right side: look.', 'menu.startHint': 'Press {key} to start',
  'theme.dark': 'Dark', 'theme.light': 'Light', 'theme.contrast': 'High contrast', 'theme.colorblind': 'Colour-blind safe',
  'action.forward': 'Forward', 'action.back': 'Back', 'action.left': 'Left', 'action.right': 'Right', 'action.run': 'Run', 'action.jump': 'Jump', 'action.interact': 'Interact', 'action.inventory': 'Inventory', 'action.menu': 'Menu',
};

const zhHant = {
  'ui.close': '關閉', 'ui.back': '返回', 'ui.confirm': '確認', 'ui.cancel': '取消', 'ui.select': '選擇', 'ui.on': '開', 'ui.off': '關',
  'ui.reset': '恢復預設值', 'ui.pressKey': '請按下按鍵…', 'ui.rebind': '{action}：{key}。按下即可變更。', 'ui.rebound': '{action}已設為 {key}',
  'ui.next': '繼續', 'ui.skip': '略過', 'ui.previous': '上一個', 'ui.following': '下一個',
  'ui.inventory': '物品欄', 'ui.emptySlot': '第 {n} 格，空', 'ui.slot': '第 {n} 格：{item}', 'ui.slotCount': '第 {n} 格：{item}，{count, number} 個',
  'ui.picked': '已拿起{item}，請選擇格子。', 'ui.moved': '{item}已移到第 {n} 格。', 'ui.dropCancelled': '已取消移動。',
  'ui.items': '{n, plural, =0 {沒有物品} other {# 件物品}}',
  'ui.objectives': '目標', 'ui.objectiveDone': '已完成：{text}', 'ui.minimap': '小地圖', 'ui.north': '北', 'ui.notifications': '通知',
  'ui.health': '生命', 'ui.stamina': '體力', 'ui.of': '{value, number, integer}／{max, number, integer}', 'ui.radial': '快捷選單', 'ui.dialogue': '對話',
  'menu.paused': '已暫停', 'menu.start': '開始', 'menu.resume': '繼續遊戲', 'menu.settings': '設定', 'menu.save': '存檔', 'menu.load': '讀取', 'menu.restart': '重新開始',
  'menu.controls': '操作', 'menu.audio': '音訊', 'menu.display': '顯示', 'menu.game': '遊戲', 'menu.master': '主音量', 'menu.music': '音樂', 'menu.sfx': '音效', 'menu.ambience': '環境音', 'menu.ui': '介面音效',
  'menu.language': '語言', 'menu.theme': '主題', 'menu.textScale': '文字大小', 'menu.reduceMotion': '減少動態效果', 'menu.sensitivity': '視角靈敏度', 'menu.invertY': '反轉視角', 'menu.quality': '畫質',
  'menu.slot': '存檔 {n}', 'menu.slotEmpty': '存檔 {n}：空', 'menu.slotSaved': '存檔 {n}：{when}', 'menu.saved': '已存到存檔 {n}。', 'menu.loaded': '已讀取存檔 {n}。', 'menu.restartAsk': '要從頭開始嗎？未存檔的進度將會遺失。',
  'menu.exportSave': '匯出存檔', 'menu.importSave': '匯入存檔', 'menu.error': '操作失敗：{error}', 'menu.imported': '已從檔案讀取。',
  'menu.touchHint': '左側：移動。右側：轉動視角。', 'menu.startHint': '按 {key} 開始',
  'theme.dark': '深色', 'theme.light': '淺色', 'theme.contrast': '高對比', 'theme.colorblind': '色覺友善',
  'action.forward': '前進', 'action.back': '後退', 'action.left': '向左', 'action.right': '向右', 'action.run': '奔跑', 'action.jump': '跳躍', 'action.interact': '互動', 'action.inventory': '物品欄', 'action.menu': '選單',
};

const ar = {
  'ui.close': 'إغلاق', 'ui.back': 'رجوع', 'ui.confirm': 'تأكيد', 'ui.cancel': 'إلغاء', 'ui.select': 'اختيار', 'ui.on': 'تشغيل', 'ui.off': 'إيقاف',
  'ui.reset': 'استعادة الإعدادات الافتراضية', 'ui.pressKey': 'اضغط مفتاحًا…', 'ui.rebind': '{action}: {key}. اضغط للتغيير.', 'ui.rebound': 'تم تعيين {action} إلى {key}',
  'ui.next': 'متابعة', 'ui.skip': 'تخطٍّ', 'ui.previous': 'السابق', 'ui.following': 'التالي',
  'ui.inventory': 'الحقيبة', 'ui.emptySlot': 'الخانة {n}، فارغة', 'ui.slot': 'الخانة {n}: {item}', 'ui.slotCount': 'الخانة {n}: {item}، العدد {count, number}',
  'ui.picked': 'تم حمل {item}. اختر خانة.', 'ui.moved': 'تم نقل {item} إلى الخانة {n}.', 'ui.dropCancelled': 'أُلغي النقل.',
  'ui.items': '{n, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}',
  'ui.objectives': 'الأهداف', 'ui.objectiveDone': 'اكتمل: {text}', 'ui.minimap': 'الخريطة المصغرة', 'ui.north': 'ش', 'ui.notifications': 'الإشعارات',
  'ui.health': 'الصحة', 'ui.stamina': 'القدرة', 'ui.of': '{value, number, integer} من {max, number, integer}', 'ui.radial': 'القائمة السريعة', 'ui.dialogue': 'حوار',
  'menu.paused': 'إيقاف مؤقت', 'menu.start': 'ابدأ', 'menu.resume': 'متابعة', 'menu.settings': 'الإعدادات', 'menu.save': 'حفظ', 'menu.load': 'تحميل', 'menu.restart': 'إعادة البدء',
  'menu.controls': 'التحكم', 'menu.audio': 'الصوت', 'menu.display': 'العرض', 'menu.game': 'اللعبة', 'menu.master': 'مستوى الصوت العام', 'menu.music': 'الموسيقى', 'menu.sfx': 'المؤثرات', 'menu.ambience': 'أصوات المحيط', 'menu.ui': 'أصوات الواجهة',
  'menu.language': 'اللغة', 'menu.theme': 'السمة', 'menu.textScale': 'حجم النص', 'menu.reduceMotion': 'تقليل الحركة', 'menu.sensitivity': 'حساسية النظر', 'menu.invertY': 'عكس النظر', 'menu.quality': 'الجودة',
  'menu.slot': 'الخانة {n}', 'menu.slotEmpty': 'الخانة {n}: فارغة', 'menu.slotSaved': 'الخانة {n}: {when}', 'menu.saved': 'تم الحفظ في الخانة {n}.', 'menu.loaded': 'تم تحميل الخانة {n}.', 'menu.restartAsk': 'هل تريد البدء من جديد؟ سيضيع التقدم غير المحفوظ.',
  'menu.exportSave': 'تصدير الحفظ', 'menu.importSave': 'استيراد حفظ', 'menu.error': 'تعذّر تنفيذ ذلك: {error}', 'menu.imported': 'تم التحميل من ملف.',
  'menu.touchHint': 'الجانب الأيسر: الحركة. الجانب الأيمن: النظر.', 'menu.startHint': 'اضغط {key} للبدء',
  'theme.dark': 'داكنة', 'theme.light': 'فاتحة', 'theme.contrast': 'تباين عالٍ', 'theme.colorblind': 'آمنة لعمى الألوان',
  'action.forward': 'للأمام', 'action.back': 'للخلف', 'action.left': 'يسار', 'action.right': 'يمين', 'action.run': 'ركض', 'action.jump': 'قفز', 'action.interact': 'تفاعل', 'action.inventory': 'الحقيبة', 'action.menu': 'القائمة',
};

/** The toolkit's string tables by BCP 47 tag. */
export const LOCALES = { en, 'zh-Hant': zhHant, ar };
