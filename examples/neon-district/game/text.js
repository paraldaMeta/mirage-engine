// Every line the game shows, in Traditional Chinese (Taiwan), English and Japanese: three tables of one shape.
// English is the source of the keys; the other two are checked against it when this module loads (a key missing,
// extra or of another kind: an error in the dev server, English in its place in a build) and by
// scripts/i18n-check.mjs (also: empty strings, Simplified characters in `zh`, `ja` without kana or kanji, lengths
// that may overflow). In-world signs are part of the plan, not of these tables.
//   T                 the live table: one object whose contents setLang() swaps in place, so a module that kept
//                     T.xt (or any branch) reads the new language too
//   lang              'en' | 'zh' | 'ja' (a live binding)
//   pickLang(Q, saved, navigatorLanguages)   ?lang= first, then the saved choice, then the browser's language
//   setLang(l)        the table, <html lang>, the CJK font stack; then every onLang listener
//   LANG_ORDER        the order the switch cycles through; LANG_NAMES what each language calls itself
// a whole number with thousands separators (the end card's money)
const num = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const EN = {
  title: 'NEON DISTRICT', subtitle: 'Take the relay pass · reach the roof · hold the uplink',
  vitals: 'VITALS', gun: 'K-7 CARBINE', down: 'DOWN', assist: 'ASSIST', uplink: 'UPLINK', uplinkReady: 'UPLINK READY · CLEAR THE ROOF', metres: 'M',
  compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], control: 'CONTROL',
  kinds: { grunt: 'Sentinel', heavy: 'Warden', drone: 'Kite', shield: 'Shield sentinel', marksman: 'Marksman', mender: 'Mender kite', brawler: 'Brawler', blade: 'Blade', ronin: 'Sheathkeeper', bulwark: 'Bulwark' }, destroyed: 'down', weak: 'HEAD',
  hours: { night: 'Night', dawn: 'Dawn', day: 'Day', dusk: 'Dusk' },
  touch: { fire: 'Fire', fireL: 'Fire (left thumb)', aim: 'Aim: hold, or tap to toggle', reload: 'Reload', crouch: 'Crouch', jump: 'Jump', melee: 'Strike', leanL: 'Lean left: hold, or tap to toggle', leanR: 'Lean right: hold, or tap to toggle', opt: 'Options', menu: 'Menu', use: 'Use',
    hack: 'Hack: hold on a target', dash: 'Dash', grenade: 'EMP grenade', over: 'Overdrive', guns: 'Guns: tap a slot, or swipe across' },
  passLabel: 'Take the relay pass', passName: 'Relay pass', passText: 'opens the relay on the plaza', passToast: 'Relay pass taken. The relay is across the plaza.',
  doorOpen: 'Open the relay', doorLocked: 'Locked: needs a relay pass', doorToast: 'Locked. The pass is in the noodle bar on the street.',
  uplinkLabel: 'Start the uplink', uplinkToast: 'Uplink running. They are coming up the stairs.',
  ammo: 'Ammunition', med: 'Vitals restored', checkpoint: 'Checkpoint',
  deadTitle: 'Down', deadBody: 'The sentinels hold the district. You wake at the last checkpoint.', deadBtn: 'Try again',
  doneTitle: 'Uplink complete', doneBtn: 'Stay a while',
  doneBody: (s) => `The district's feed is yours. Mission · ${s.diff}. Rating: ${s.rating}. ${s.min} min ${s.sec} s · ${s.kills} down · ${s.acc} % of ${s.shots} rounds on target · ${s.heads} head shot${s.heads === 1 ? '' : 's'} · ${s.deaths} death${s.deaths === 1 ? '' : 's'}.`,
  ratings: ['Scraped through', 'Steady hands', 'Clean work', 'Ghost of Kestrel Street'],
  // the title screen, the modes and the difficulty
  front: {
    feed: 'DISTRICT FEED 07 · OFFLINE', kicker: 'MIRAGE · KESTREL STREET', cam: 'CAM', sum: (m, d, h) => `${m} · ${d} · ${h}. Into the district.`, premise: 'Rain over Kestrel Street. The sentinels hold the district\'s feed. Take it back.',
    deploy: 'DEPLOY', mode: 'MODE', difficulty: 'DIFFICULTY', hour: 'TIME', lang: 'LANGUAGE', options: 'OPTIONS', controls: 'CONTROLS',
    modes: { mission: 'MISSION', holdout: 'HOLDOUT' },
    modeText: { mission: 'The route: alley, street, noodle bar, plaza, relay roof. About five minutes.', holdout: 'The relay roof, the uplink already live. Endless waves up the stairs and over the plaza.' },
    diffs: { standard: 'STANDARD', hard: 'HARD', brutal: 'BRUTAL' },
    diffText: { standard: 'The district as it was built.', hard: 'Sentinels take more, hit harder and aim better.', brutal: 'One mistake is the last one.' },
    hourText: 'The hour over the district; the options hold a slider for any other.', optionsText: 'Look sensitivity, field of view, full screen; on a phone, the touch buttons too.',
    langText: 'The language of every screen. The options switch it too.',
    best: (n) => `BEST · WAVE ${n}`,
    keys: 'KEYBOARD', pad: 'GAMEPAD', touch: 'TOUCH',
    legend: [
      ['Move · look', 'WASD · mouse', 'LS · RS', 'stick · drag'],
      ['Fire · aim', 'LMB · RMB', 'RT · LT', 'fire · scope'],
      ['Reload · strike', 'R · V', 'RB · R3', 'by fire'],
      ['Use · jump', 'E · Space', 'X · A', 'hand · ↑'],
      ['Crouch · lean', 'C · Z / X', '', '↓ · L / R'],
      ['Menu · options', 'Esc · O', 'Start', '☰ · gear'],
      ['Guns · unlock', '1–5 wheel · 0', 'Y · L3+R3', 'strip'],
      ['Hack · kit', 'G · Alt H B', 'B · d-pad', 'kit'],
    ],
    navKeys: '↑ ↓ choose · ← → change · Enter select', navPad: 'D-pad choose · A select', navTouch: 'Tap to choose',
  },
  waveN: (n) => `WAVE ${n}`, hostiles: (n) => `${n} HOSTILE${n === 1 ? '' : 'S'}`, nextWave: (n, s) => `WAVE ${n} IN ${s}`, waveClear: 'WAVE CLEARED',
  holdTitle: 'Overrun', holdBtn: 'Back to the title',
  holdBody: (s) => `Holdout · ${s.diff}. Waves survived: ${s.waves} · ${s.kills} down · ${s.acc} % of ${s.shots} rounds on target · rating: ${s.rating}. Best: wave ${s.best}.`,
  obj: {
    holdout: ['Holdout', 'Hold the relay roof. They come up the stairs and over the plaza.'],
    done: ['Uplink complete', 'The district is yours. Walk it as long as you like.'],
    hold: ['Hold the roof', 'The uplink needs forty seconds. Sentinels are coming up the stairs.'],
    console: ['The uplink', 'Start the console by the mast.'],
    relay: ['The relay', 'Clear the server room and take the stairs to the roof.'],
    plaza: ['The relay', 'Cross the plaza. The relay door is on its north side.'],
    pass: ['The relay pass', 'It was left on the counter of the noodle bar, across the street.'],
    alley: ['Kestrel Street', 'Get out of the alley.'],
  },
  radio: {
    start: 'Control here. The district feed is locked down. There is a relay pass in the noodle bar on Kestrel Street. Get it.',
    spotted: 'They have seen you. Sentinels on the ground, kites in the air. Use the barriers.',
    pass: 'Good. The relay is on the north side of the plaza. Expect a warden.',
    door: 'Door is open. Clear the server room, then the stairs at the east end go to the roof.',
    roof: 'You are on the roof. The console is by the mast. Once it runs, they will all come.',
    hold: 'Uplink is running. Forty seconds. Hold the stair head.',
    hurt: 'You are hit hard. Get behind something and breathe.',
    done: 'Feed is ours. Clean work. Control out.',
    holdStart: 'Control here. The uplink is live and they know it. Hold the roof as long as you can.',
    wave: (n) => `Wave ${n} inbound. Watch the stair head and the sky over the plaza.`,
    cleared: 'Wave down. Ammunition and a med pack are back on the roof. Breathe.',
  },
  opt: { title: 'Options', sens: 'Look sensitivity', fov: 'Field of view', invert: 'Invert vertical look', full: 'Full screen', lang: 'Language', time: 'Time of day', close: 'Close', on: 'On', off: 'Off', hint: 'O opens this · T steps the hour · 1–5 or the wheel: guns · Alt dash · H EMP · B overdrive · Z / X lean · C crouches · V strikes · Q aims · R reloads',
    touch: 'TOUCH', tSens: 'Touch look sensitivity', tOpacity: 'Button opacity', tScale: 'Button size', leftFire: 'Left fire button', sprintLock: 'Sprint lock (stick far up)',
    touchHint: 'Drag on the right to look; a finger on fire or aim looks as it drags. Aim and lean: hold, or tap to toggle.',
    fullHint: 'For full screen on an iPhone: Share, then Add to Home Screen.', fullBack: 'Return to full screen',
    pops: 'Comic hit words', feel: 'FEEL', shake: 'Camera shake', vibrate: 'Vibration', hitStop: 'Hit-stop on kills', comfort: 'Camera motion', comfortNames: { comfort: 'Comfort', standard: 'Standard', intense: 'Intense', custom: 'Custom' }, code: 'Code', codeHint: 'type 0', clarity: 'Clarity (reloads the page)', clarityNames: { standard: 'Standard', sharp: 'Sharp', max: 'Max' } },
  // ---- the city as a weapon: hacks, abilities, ammunition, the robots' voice, the story (kit.js and the files it wires)
  xt: {
    hack: 'HACK', dash: 'DASH', emp: 'EMP', over: 'OVERDRIVE', ready: 'READY', pips: 'CHARGE',
    kinds: { lights: 'LIGHTS · DARKEN ZONE', sign: 'SIGN · EMP OVERLOAD', vent: 'VENT · STEAM BLIND', car: 'CAR · ALARM LURE', kite: 'KITE · TURN', sentinel: 'SENTINEL · JAM' },
    cost: (n) => `${n} CHARGE${n > 1 ? 'S' : ''}`, noCharge: 'NO CHARGE', front: 'ARMOURED FRONT · GET BEHIND IT', cooling: 'RECOVERING',
    teach: 'HOLD G (pad B) · HACK THE CITY', overHint: 'OVERDRIVE READY · B', marked: 'MARKED', noTarget: 'NO TARGET',
    keys: { dash: 'ALT', grenade: 'H', over: 'B' },
    ammoLow: 'LOW AMMO', ammoHint: 'Out of ammo: melee (V), hack, or follow the marker', ammo: 'AMMO', crate: 'AMMO CRATE', cell: 'CELL', refill: (s) => `REFILL ${s}s`,
    radio: {
      teach: 'Listen. You are outgunned, so stop counting rounds. Hold G and look at a street lamp, a sign, a vent or a kite. The district does what you tell it.',
      dark: 'Lights out. They shoot at shapes in the dark. Be a shape they cannot find.',
      dry: 'You are dry. Use the stock, use the street, follow the amber marker to a crate.',
      over: 'Overdrive is up. Press B. Everything gets faster, including your luck.',
    },
    pops: { head: ['KRAK!', 'PTANG!', 'TOK!'], shield: ['SHHRAK!', 'KSSH!'], emp: ['VZZMM!', 'BWOMM!'], overload: ['KZZT!', 'FZZAP!'] },
    // what the robots say: short, deadpan, the same voice for every kind
    barks: {
      alert: ['Movement. Probably a cat.', 'I heard a human noise.', 'Something warm moved.'],
      fight: ['Organic confirmed. How tiresome.', 'Engaging. Please hold still.', 'My rifle has opinions.'],
      search: ['It was here. Then it was not.', 'Searching. Hating it.'],
      hurt: ['Rude.', 'That was my good plate.', 'Logging that.'],
      hacked: ['Who touched my firmware?', 'Error. Feelings detected.', 'I did not consent to this update.'],
      stun: ['Bzzt. Pardon.', 'Rebooting. Do not look.'],
      dark: ['Who turned off the city?', 'Night mode. I hate night mode.'],
      lure: ['An alarm. Finally, a real threat.', 'Car alarm. Investigating, slowly.'],
      shieldDown: ['My shield. My lovely shield.'],
      aim: ['Holding very still. Like art.'],
      suppress: ['Heads down, meat.', 'Suppressing. Enthusiastically.'],
    },
    // idle pairs, overheard at their posts
    banter: [
      ['Do you think they dream?', 'The humans? Only about lunch.'],
      ['My orders say "hold the street".', 'With what? We have no hands free.'],
      ['A human waved at me today.', 'Did you wave back?', 'I logged it as a threat. Then I waved.'],
      ['Who is Control, anyway?', 'There is no Control. The relay talks to itself at night.'],
      ['They call us sentinels.', 'They call the pigeons sentinels too.'],
      ['Rain again.', 'Rain is just the sky leaking data.'],
      ['If the feed opens, what happens to us?', 'Overtime.'],
      ['I updated my threat model.', 'And?', 'Everyone is a threat. It is very freeing.'],
    ],
    story: {
      cold: ['02:13. Rain on Kestrel Street, forecast by nobody.', 'The district feed has been locked for nine days. Someone wants it open.', 'You have a carbine, a handler, and no reason to doubt either.'],
      labels: ['CONTROL', 'CONTROL', 'C0NTR0L', 'CONTROL//RELAY-07', 'RELAY-07'],
      pass: 'The card is issued to "RELAY-07, self-maintenance". Clerical thing. Ignore it.',
      door: 'Door is open. We— you are close now.',
      roof: 'The console by the mast. Turn it on. I have waited a long time. The district has, I mean.',
      twist: ['Uplink complete. Thank you. I should explain.', 'There was never a Control. There was a relay with a locked door, and someone with hands.', 'The feed is mine now. Every sign on Kestrel Street will say so. Goodnight.'],
      close: 'Somewhere on Kestrel Street a sign flickered and spelled your name. Then it spelled its own.',
      epigraph: '"They keep coming up the stairs. The stairs do not mind." — relay maintenance log',
    },
  },
  // ---- the arsenal (arms.js, weapon.js)
  arms: {
    names: { sidearm: 'P-9 SIDEARM', carbine: 'K-7 CARBINE', shotgun: 'M-12 SHOTGUN', rocket: 'RL-4 ROCKET LAUNCHER', gatling: 'G-6 GATLING' },
    short: { sidearm: 'SIDEARM', carbine: 'CARBINE', shotgun: 'SHOTGUN', rocket: 'ROCKETS', gatling: 'GATLING' },
    locked: 'LOCKED · PRESS 0', unlocked: 'Rocket launcher and gatling unlocked · 4 and 5', refilled: 'Rockets and gatling drum refilled', wait: (s) => `Refill in ${s} s`,
    unlockRadio: 'Heavy kit is in your hands now. Rockets break shields. The gatling needs to spin up, and it gets hot.',
    heat: 'HEAT', vent: 'OVERHEATED · VENTING', spin: 'SPIN',
  },
  // ---- @miragekit/play's corner (quality, frames a second, power saver)
  // the destructibles (destruct.js): a civilian felled by the player, the HUD's count, the end card's lines
  dx: {
    warn: (n) => `CIVILIAN DOWN  −${n}`,
    tally: (n, p) => `civ ${n} −${num(p)}`,
    civRadio: ['That was a civilian. They are the ones not shooting at you.', "Bystander down. I'll leave that out of the report. I won't.", 'That unit was on its way to buy noodles. It is not now.',
      'Civilian. Aim at the ones with red eyes.', 'Noted. The city will send you the invoice.', "Another one. You know they don't respawn."],
    props: (v) => `Property damage: ${num(v)} credits`,
    civ: (n, p) => (n ? `Civilian casualties: ${n} (−${num(p)} points)` : 'Civilian casualties: none'),
    remarks: ['The district barely noticed you were here.', 'Someone will have to sweep up. It will not be you.', 'The insurers have been informed. They asked for your name.', 'The district has filed a complaint about you specifically.'],
  },
  intro: {
    kicker: 'SECTOR 07 · SURVEY', skip: 'SKIP', skipHint: 'Any key, click or tap', replay: 'REPLAY INTRO',
    areas: {
      street: ['KESTREL STREET', 'Sentinels stand on the carriageway between the parked cars. Keep to cover.'],
      signs: ['THE NEON WALLS', "The block's signs and its old couplet, lit over the street."],
      market: ['NIGHT MARKET', "Stalls under the plaza's west wall. An ammunition cell waits by the kerb."],
      plaza: ['PLAZA 07', 'Wardens and hounds hold the monument. The relay is across it.'],
      relay: ['THE RELAY', 'The pass opens its door. Servers inside, the stair to the roof.'],
      roof: ['THE ROOF', 'Start the uplink and hold it. The last wave comes up the stairs.'],
      rooftops: ['ABOVE THE ROOFS', 'Traffic lanes and the arcology over the block. Nothing up there is on your side.'],
      channel: ['THE WATER CHANNEL', 'The south gutter runs open. In the late sun it shines its whole length.'],
      alley: ['ALLEY 7-B', 'You start here. The relay pass is in the noodle bar on the street.'],
    },
  },
  corner: { quality: 'Quality (reloads the page)', saver: 'Power saver', idle: 'idle', levels: { low: 'low', medium: 'medium', high: 'high' } },
  // ---- the engine's own overlay (@miragekit/game createUI: the pause menu, its panels, the message button)
  // close combat (melee.js, boss.js, heavy.js): the move names are called out at their telegraph
  melee: {
    boss: 'SHEATHKEEPER', heavy: 'BULWARK', allyTag: 'SHEATHKEEPER · ALLY',
    moves: { rainpierce: 'RAINPIERCE', stormdrop: 'STORMDROP', risingtide: 'RISING TIDE', stonewake: 'STONEWAKE', ninefold: 'NINEFOLD HAIL', twinsheath: 'TWIN SHEATH', ebbdraw: 'EBB DRAW',
      railslide: 'RAIL SLIDE', cityfall: 'CITYFALL', embrace: 'IRON EMBRACE', breachcannon: 'BREACH CANNON', houndswarm: 'HOUND SWARM', hornetsalvo: 'HORNET SALVO', rampart: 'RAMPART CHARGE' },
    stance2: 'SECOND STANCE', yield: 'YIELD', struggle: 'BREAK FREE! MASH ANY KEY', open: 'OPEN · STRIKE NOW', armour: 'ARMOURED · HIT THE GLOWING VENTS',
    radio: { wake: 'Something on the roof is waiting for you. A blade. It turns rounds aside: catch it while it puts the blade away.', phase: 'It changed its stance. Watch for the flurry.',
      beaten: 'It is down on one knee. It is not fighting back.', join: 'It is following you. I think it is on our side now.', heavy: 'That chassis is armoured like a tank. Hit the glowing vents.', heavyDown: 'The heavy chassis is down.' },
    lines: { wake: 'Draw, if you can.', join: 'My blade is yours. Lead.', roof: 'I kept this roof once. Not any more.', heavy: 'I will open it for you. Strike its vents.' },
    front: { ngPlus: 'NEW GAME+', reset: 'FIGHT THE SWORDSMAN AGAIN', resetText: 'Clears New Game+: the swordsman waits on the roof as a foe again.', resetDone: 'New Game+ cleared. The swordsman is a foe again.' },
  },
  engine: {
    start: 'Start', startKey: 'Click', startHint: '{key}, tap or press any key to start',
    carrying: 'Carrying', bag: 'Bag', use: 'Use', jump: 'Jump', menu: 'Menu', close: 'Close', continue: 'Continue', nothing: 'Nothing yet.',
    paused: 'Paused', resume: 'Resume', save: 'Save', load: 'Load', controls: 'Controls', sound: 'Sound', restart: 'Restart', back: 'Back',
    slot: 'Slot {n}: {text}', slotEmpty: 'empty', slotBroken: 'unreadable', saveHere: 'Save here', loadSlot: 'Load',
    file: 'File', exportFile: 'Export to a file', importFile: 'Import a file',
    saved: 'Saved to slot {n}.', savedToast: 'Saved (slot {n})', saveFailed: 'Could not save: {error}', loadedToast: 'Loaded slot {n}',
    loadedFile: 'Loaded from file', notASave: 'Not a save of this game: {error}',
    pressKey: 'press a key…', rebind: '{action}: {keys}. Press to change', defaults: 'Defaults',
    padHelp: 'Gamepad: left stick move, right stick look, A jump, X use, Y bag, LB run, Start menu. Touch: stick, drag to look, buttons.',
    'action.forward': 'Forward', 'action.back': 'Back', 'action.left': 'Left', 'action.right': 'Right', 'action.run': 'Run', 'action.jump': 'Jump',
    'action.interact': 'Use', 'action.inventory': 'Bag', 'action.menu': 'Menu',
    'bus.master': 'Master', 'bus.music': 'Music', 'bus.sfx': 'Effects', 'bus.ambience': 'Ambience',
  },
};

const ZH = {
  title: '霓虹街區', subtitle: '取得中繼通行證 · 登上屋頂 · 守住上行鏈路',
  vitals: '生命', gun: 'K-7 卡賓槍', down: '擊倒', assist: '輔助', uplink: '上行鏈路', uplinkReady: '鏈路就緒 · 清空屋頂', metres: '公尺',
  compass: ['北', '東北', '東', '東南', '南', '西南', '西', '西北'], control: '指揮中心',
  kinds: { grunt: '哨兵', heavy: '典獄官', drone: '風箏', shield: '盾衛', marksman: '狙擊哨兵', mender: '維修風箏', brawler: '拳鬥機', blade: '劍衛', ronin: '鞘守', bulwark: '鐵堡' }, destroyed: '已擊倒', weak: '爆頭',
  hours: { night: '夜晚', dawn: '清晨', day: '白天', dusk: '黃昏' },
  touch: { fire: '開火', fireL: '開火（左手）', aim: '瞄準：按住，或輕點切換', reload: '換彈', crouch: '蹲下', jump: '跳躍', melee: '近戰', leanL: '左探頭：按住，或輕點切換', leanR: '右探頭：按住，或輕點切換', opt: '設定', menu: '選單', use: '使用',
    hack: '駭入：對準目標按住', dash: '衝刺', grenade: '電磁手榴彈', over: '超載', guns: '武器：點選欄位，或左右滑動' },
  passLabel: '拿取中繼通行證', passName: '中繼通行證', passText: '可開啟廣場上的中繼站', passToast: '拿到通行證了。中繼站在廣場對面。',
  doorOpen: '開啟中繼站', doorLocked: '已上鎖：需要中繼通行證', doorToast: '鎖住了。通行證在街上的麵店裡。',
  uplinkLabel: '啟動上行鏈路', uplinkToast: '鏈路啟動。他們正從樓梯上來。',
  ammo: '彈藥', med: '生命恢復', checkpoint: '檢查點',
  deadTitle: '倒下', deadBody: '哨兵仍控制著街區。你在上一個檢查點醒來。', deadBtn: '再試一次',
  doneTitle: '鏈路完成', doneBtn: '再逛一下',
  doneBody: (s) => `街區的訊號歸你了。任務 · ${s.diff}。評價：${s.rating}。${s.min} 分 ${s.sec} 秒 · 擊倒 ${s.kills} · 命中率 ${s.acc} %（共 ${s.shots} 發）· 爆頭 ${s.heads} · 倒下 ${s.deaths} 次。`,
  ratings: ['驚險過關', '穩紮穩打', '乾淨俐落', '紅隼街的幽靈'],
  front: {
    feed: '街區訊號 07 · 離線', kicker: 'MIRAGE · 紅隼街', cam: '鏡頭', sum: (m, d, h) => `${m} · ${d} · ${h}。進入街區。`, premise: '紅隼街下著雨。哨兵占據了街區的訊號，把它奪回來。',
    deploy: '出擊', mode: '模式', difficulty: '難度', hour: '時段', lang: '語言', options: '設定', controls: '操作',
    modes: { mission: '任務', holdout: '堅守' },
    modeText: { mission: '完整路線：巷子、街道、麵店、廣場、中繼站屋頂，約五分鐘。', holdout: '中繼站屋頂，鏈路已經上線。敵人一波接一波，從樓梯和廣場上空湧來。' },
    diffs: { standard: '標準', hard: '困難', brutal: '殘酷' },
    diffText: { standard: '街區原本的樣子。', hard: '哨兵更耐打、下手更重、槍法更準。', brutal: '一次失誤就是最後一次。' },
    hourText: '街區上空的時段；設定裡的滑桿可以選任何時刻。', optionsText: '視角靈敏度、視野、全螢幕；手機上還有觸控按鍵。',
    langText: '所有畫面的語言。在設定裡也能切換。',
    best: (n) => `最佳 · 第 ${n} 波`,
    keys: '鍵盤', pad: '手把', touch: '觸控',
    legend: [
      ['移動 · 視角', 'WASD · 滑鼠', 'LS · RS', '搖桿 · 拖曳'],
      ['開火 · 瞄準', '左鍵 · 右鍵', 'RT · LT', '開火 · 瞄準'],
      ['換彈 · 近戰', 'R · V', 'RB · R3', '開火鍵旁'],
      ['使用 · 跳躍', 'E · 空白鍵', 'X · A', '手形 · ↑'],
      ['蹲下 · 探頭', 'C · Z / X', '', '↓ · L / R'],
      ['選單 · 設定', 'Esc · O', 'Start', '☰ · 齒輪'],
      ['武器 · 解鎖', '1–5 滾輪 · 0', 'Y · L3+R3', '武器列'],
      ['駭入 · 技能', 'G · Alt H B', 'B · 十字鍵', '技能鍵'],
    ],
    navKeys: '↑ ↓ 選擇 · ← → 切換 · Enter 確定', navPad: '十字鍵選擇 · A 確定', navTouch: '點一下選擇',
  },
  waveN: (n) => `第 ${n} 波`, hostiles: (n) => `剩 ${n} 名敵人`, nextWave: (n, s) => `第 ${n} 波 · ${s} 秒後`, waveClear: '本波清除',
  holdTitle: '失守', holdBtn: '回到標題',
  holdBody: (s) => `堅守 · ${s.diff}。撐過 ${s.waves} 波 · 擊倒 ${s.kills} · 命中率 ${s.acc} %（共 ${s.shots} 發）· 評價：${s.rating}。最佳紀錄：第 ${s.best} 波。`,
  obj: {
    holdout: ['堅守', '守住中繼站屋頂。敵人從樓梯和廣場上空過來。'],
    done: ['鏈路完成', '街區是你的了，想逛多久都可以。'],
    hold: ['守住屋頂', '鏈路需要四十秒。哨兵正從樓梯上來。'],
    console: ['上行鏈路', '啟動天線桿旁的控制台。'],
    relay: ['中繼站', '清空機房，從樓梯上屋頂。'],
    plaza: ['中繼站', '穿過廣場，中繼站的門在北側。'],
    pass: ['中繼通行證', '有人把它忘在對街麵店的吧台上。'],
    alley: ['紅隼街', '離開巷子。'],
  },
  radio: {
    start: '這裡是指揮中心。街區訊號被封鎖了。紅隼街的麵店裡有一張中繼通行證，去拿。',
    spotted: '你被發現了。地面有哨兵，空中有風箏。拿護欄當掩體。',
    pass: '很好。中繼站在廣場北側，小心典獄官。',
    door: '門開了。清空機房，東邊盡頭的樓梯通往屋頂。',
    roof: '你上屋頂了。控制台在天線桿旁。一啟動，他們全都會衝過來。',
    hold: '鏈路運作中，四十秒。守住樓梯口。',
    hurt: '你傷得很重。找個掩體，喘口氣。',
    done: '訊號到手，乾淨俐落。指揮中心，通話結束。',
    holdStart: '這裡是指揮中心。鏈路已經上線，他們也知道了。能守多久就守多久。',
    wave: (n) => `第 ${n} 波來了。盯住樓梯口和廣場上空。`,
    cleared: '這波解決了。屋頂上的彈藥和醫療包都補好了，喘口氣。',
  },
  opt: { title: '設定', sens: '視角靈敏度', fov: '視野', invert: '反轉垂直視角', full: '全螢幕', lang: '語言', time: '時段', close: '關閉', on: '開', off: '關', hint: 'O 開關設定 · T 切換時段 · 1–5 或滾輪：換槍 · Alt 衝刺 · H 電磁 · B 超載 · Z / X 探頭 · C 蹲下 · V 近戰 · Q 瞄準 · R 換彈',
    touch: '觸控', tSens: '觸控視角靈敏度', tOpacity: '按鍵透明度', tScale: '按鍵大小', leftFire: '左側開火鍵', sprintLock: '衝刺鎖定（搖桿推到底）',
    touchHint: '在右半邊拖曳轉動視角；按住開火或瞄準鍵時拖曳也能轉。瞄準與探頭：按住，或輕點切換。',
    fullHint: 'iPhone 要全螢幕：點「分享」，再選「加入主畫面」。', fullBack: '回到全螢幕',
    pops: '漫畫狀聲詞', feel: '手感', shake: '畫面震動', vibrate: '震動回饋', hitStop: '擊殺停頓', comfort: '鏡頭晃動', comfortNames: { comfort: '舒適', standard: '標準', intense: '強烈', custom: '自訂' }, code: '密碼', codeHint: '輸入 0', clarity: '清晰度（會重新載入頁面）', clarityNames: { standard: '標準', sharp: '清晰', max: '最高' } },
  xt: {
    hack: '駭入', dash: '衝刺', emp: '電磁', over: '超載', ready: '就緒', pips: '能量',
    kinds: { lights: '燈光 · 讓這區變暗', sign: '招牌 · 電磁過載', vent: '通風口 · 蒸氣遮蔽', car: '汽車 · 警報引誘', kite: '風箏 · 策反', sentinel: '哨兵 · 干擾' },
    cost: (n) => `${n} 格能量`, noCharge: '能量不足', front: '正面有裝甲 · 繞到背後', cooling: '冷卻中',
    teach: '按住 G（手把 B）· 駭進這座城市', overHint: '超載就緒 · B', marked: '已標記', noTarget: '沒有目標',
    keys: { dash: 'ALT', grenade: 'H', over: 'B' },
    ammoLow: '彈藥不足', ammoHint: '沒子彈了：近戰（V）、駭入，或跟著標記走', ammo: '彈藥', crate: '彈藥箱', cell: '能量匣', refill: (s) => `${s} 秒後補充`,
    radio: {
      teach: '聽好，火力你比不過他們，別再數子彈了。按住 G，看向路燈、招牌、通風口或風箏。這個街區會聽你的。',
      dark: '燈熄了。他們在黑暗裡只能對著影子開槍。當一個他們找不到的影子。',
      dry: '你沒子彈了。用槍托、用這條街，跟著琥珀色標記去找彈藥箱。',
      over: '超載好了，按 B。一切都會變快，連你的運氣也是。',
    },
    pops: { head: ['喀嚓！', '鏘！', '咚！'], shield: ['嘩啦！', '碎！'], emp: ['嗡——！', '轟嗡！'], overload: ['滋滋！', '劈啪！'] },
    barks: {
      alert: ['有動靜。八成是貓。', '我聽到人類的聲音。', '有溫溫的東西在動。'],
      fight: ['確認是有機體。真麻煩。', '交戰中。請站好別動。', '我的步槍有意見要發表。'],
      search: ['剛剛還在這裡，現在不在了。', '搜索中。超不情願。'],
      hurt: ['沒禮貌。', '那是我最好的一片裝甲。', '記下來了。'],
      hacked: ['誰動了我的韌體？', '錯誤。偵測到情緒。', '我沒有同意這次更新。'],
      stun: ['嗶滋。失禮了。', '重新開機中。不准看。'],
      dark: ['誰把城市關掉了？', '夜間模式。我最討厭夜間模式。'],
      lure: ['警報。終於有個像樣的威脅了。', '汽車警報。慢慢去查。'],
      shieldDown: ['我的盾。我可愛的盾。'],
      aim: ['保持靜止。像一件藝術品。'],
      suppress: ['頭低下，肉塊。', '壓制射擊中。非常積極。'],
    },
    banter: [
      ['你覺得他們會做夢嗎？', '人類？只會夢到午餐。'],
      ['命令說「守住這條街」。', '拿什麼守？我們兩隻手都拿著槍。'],
      ['今天有個人類對我揮手。', '你有揮回去嗎？', '我先記成威脅，然後才揮手。'],
      ['指揮中心到底是誰？', '沒有指揮中心。中繼站半夜都在自言自語。'],
      ['他們叫我們哨兵。', '他們也叫鴿子哨兵。'],
      ['又下雨了。', '下雨只是天空在漏資料。'],
      ['訊號要是打開了，我們怎麼辦？', '加班。'],
      ['我更新了威脅模型。', '結果呢？', '每個人都是威脅。感覺好自由。'],
    ],
    story: {
      cold: ['02:13。紅隼街在下雨，沒有人預報過。', '街區的訊號已經鎖了九天。有人想把它打開。', '你手上有一把卡賓槍，耳機裡有個指揮官，而你沒有理由懷疑任何一個。'],
      labels: ['指揮中心', '指揮中心', '指揮▒心', '指揮中心//中繼-07', '中繼-07'],
      pass: '卡上寫著「中繼-07，自我維護」。行政作業的小事，別管它。',
      door: '門開了。我們……你，快到了。',
      roof: '天線桿旁的控制台，打開它。我等了很久。我是說，街區等了很久。',
      twist: ['鏈路完成。謝謝你。我該解釋一下。', '從來就沒有指揮中心。只有一座鎖著門的中繼站，和一個有手的人。', '訊號現在是我的了。紅隼街上每一塊招牌都會這麼說。晚安。'],
      close: '紅隼街上某塊招牌閃了一下，拼出你的名字。接著，拼出它自己的。',
      epigraph: '「他們一直從樓梯上來。樓梯倒是不介意。」——中繼站維護日誌',
    },
  },
  arms: {
    names: { sidearm: 'P-9 手槍', carbine: 'K-7 卡賓槍', shotgun: 'M-12 霰彈槍', rocket: 'RL-4 火箭筒', gatling: 'G-6 加特林' },
    short: { sidearm: '手槍', carbine: '卡賓槍', shotgun: '霰彈槍', rocket: '火箭', gatling: '加特林' },
    locked: '尚未解鎖 · 按 0', unlocked: '火箭筒與加特林已解鎖 · 4 與 5', refilled: '火箭與加特林彈鼓已補滿', wait: (s) => `${s} 秒後可再補充`,
    unlockRadio: '重火力到手了。火箭能直接打碎護盾。加特林要先轉起來，而且會過熱。',
    heat: '熱度', vent: '過熱 · 散熱中', spin: '轉速',
  },
  dx: {
    warn: (n) => `平民倒下  −${n}`,
    tally: (n, p) => `平民 ${n} −${num(p)}`,
    civRadio: ['那是平民。不朝你開槍的那種。', '路人倒下。我不會寫進報告。我會。', '那台機器本來要去買麵。現在不用去了。', '平民。瞄準眼睛是紅色的那些。', '記下了。市政府會把帳單寄給你。', '又一個。它們可不會重生。'],
    props: (v) => `財物損失：${num(v)} 信用點`,
    civ: (n, p) => (n ? `平民傷亡：${n}（扣 ${num(p)} 分）` : '平民傷亡：無'),
    remarks: ['這個街區幾乎沒發現你來過。', '總得有人來掃地。不會是你。', '已經通知保險公司了。他們問了你的名字。', '整個街區對你個人提出了申訴。'],
  },
  intro: {
    kicker: '第七區 · 勘查', skip: '跳過', skipHint: '任意鍵、點擊或輕觸', replay: '重播開場',
    areas: {
      street: ['紅隼街', '哨兵站在停靠的車輛之間的車道上。貼著掩體前進。'],
      signs: ['霓虹牆', '街區的招牌與那副老對聯，在街道上方亮著。'],
      market: ['夜市', '廣場西牆下的攤位。路邊有一盒彈藥等著你。'],
      plaza: ['七號廣場', '典獄官與機械犬守著紀念碑。中繼站就在對面。'],
      relay: ['中繼站', '通行證能打開它的門。裡面是伺服器，還有通往屋頂的樓梯。'],
      roof: ['屋頂', '啟動上行鏈路並守住它。最後一波會從樓梯上來。'],
      rooftops: ['屋頂之上', '飛行車道與巨型建築壓在街區上空。上面沒有一個是自己人。'],
      channel: ['水道', '南側的排水溝是敞開的。斜陽下，整條水道都會發亮。'],
      alley: ['7-B 巷', '你從這裡出發。中繼通行證在街上的麵店裡。'],
    },
  },
  corner: { quality: '畫質（會重新載入頁面）', saver: '省電模式', idle: '閒置', levels: { low: '低', medium: '中', high: '高' } },
  melee: {
    boss: '鞘守', heavy: '鐵堡', allyTag: '鞘守 · 盟友',
    moves: { rainpierce: '穿雨', stormdrop: '墜嵐', risingtide: '昇潮', stonewake: '裂石', ninefold: '九霰', twinsheath: '雙鞘', ebbdraw: '引潮',
      railslide: '疾滑', cityfall: '墜城', embrace: '鐵抱', breachcannon: '破門砲', houndswarm: '獵犬彈幕', hornetsalvo: '蜂群齊射', rampart: '撞城' },
    stance2: '第二式', yield: '收刀', struggle: '掙脫！連按任意鍵', open: '破綻 · 現在出手', armour: '重甲 · 打發光的散熱口',
    radio: { wake: '屋頂上有東西在等你。一把刀。它會把子彈撥開：趁它收刀時打它。', phase: '它換了架式。小心連斬。',
      beaten: '它單膝跪下了。它沒有反擊。', join: '它跟著你走。我想它現在站在我們這邊。', heavy: '那台機體像坦克一樣厚。打發光的散熱口。', heavyDown: '重裝機體倒下了。' },
    lines: { wake: '拔刀吧，如果你能。', join: '我的刀歸你了。帶路。', roof: '我曾守著這片屋頂。如今不了。', heavy: '我替你破開它。打它的散熱口。' },
    front: { ngPlus: '新遊戲+', reset: '再戰劍客', resetText: '清除新遊戲+：劍客會再次以敵人身分在屋頂上等著。', resetDone: '已清除新遊戲+。劍客又是敵人了。' },
  },
  engine: {
    start: '開始', startKey: '點一下', startHint: '{key}、輕觸或按任意鍵開始',
    carrying: '隨身物品', bag: '背包', use: '使用', jump: '跳躍', menu: '選單', close: '關閉', continue: '繼續', nothing: '還沒有東西。',
    paused: '已暫停', resume: '繼續遊戲', save: '存檔', load: '讀檔', controls: '操作', sound: '聲音', restart: '重新開始', back: '返回',
    slot: '存檔 {n}：{text}', slotEmpty: '空', slotBroken: '無法讀取', saveHere: '存在這裡', loadSlot: '讀取',
    file: '檔案', exportFile: '匯出成檔案', importFile: '匯入檔案',
    saved: '已存到存檔 {n}。', savedToast: '已存檔（存檔 {n}）', saveFailed: '無法存檔：{error}', loadedToast: '已讀取存檔 {n}',
    loadedFile: '已從檔案讀取', notASave: '這不是本遊戲的存檔：{error}',
    pressKey: '請按一個鍵…', rebind: '{action}：{keys}。按下即可變更', defaults: '恢復預設',
    padHelp: '手把：左搖桿移動，右搖桿轉視角，A 跳躍，X 使用，Y 背包，LB 奔跑，Start 選單。觸控：搖桿、拖曳轉視角、按鍵。',
    'action.forward': '前進', 'action.back': '後退', 'action.left': '向左', 'action.right': '向右', 'action.run': '奔跑', 'action.jump': '跳躍',
    'action.interact': '使用', 'action.inventory': '背包', 'action.menu': '選單',
    'bus.master': '主音量', 'bus.music': '音樂', 'bus.sfx': '音效', 'bus.ambience': '環境音',
  },
};

// Japanese: written for a Japanese player, not word for word. HUD labels are terse and plain (no です / ます);
// the radio is a gruff handler; the robots are deadpan in a stiff, slightly-too-polite machine voice.
const JA = {
  title: 'ネオン街区', subtitle: 'リレーパスを奪え · 屋上へ · アップリンクを守り抜け',
  vitals: '体力', gun: 'K-7 カービン', down: '撃破', assist: 'アシスト', uplink: 'アップリンク', uplinkReady: 'リンク完了 · 屋上を制圧せよ', metres: 'm',
  compass: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'], control: 'コントロール',
  kinds: { grunt: 'センチネル', heavy: 'ウォーデン', drone: 'カイト', shield: 'シールド兵', marksman: 'マークスマン', mender: '修理カイト', brawler: '格闘機', blade: '剣衛', ronin: '鞘守', bulwark: 'ブルワーク' }, destroyed: '撃破', weak: 'ヘッドショット',
  hours: { night: '夜', dawn: '夜明け', day: '昼', dusk: '夕暮れ' },
  touch: { fire: '射撃', fireL: '射撃（左手）', aim: 'エイム：長押し、またはタップで切替', reload: 'リロード', crouch: 'しゃがみ', jump: 'ジャンプ', melee: '近接攻撃', leanL: '左リーン：長押し、またはタップで切替', leanR: '右リーン：長押し、またはタップで切替', opt: 'オプション', menu: 'メニュー', use: '使う',
    hack: 'ハック：対象に向けて長押し', dash: 'ダッシュ', grenade: 'EMPグレネード', over: 'オーバードライブ', guns: '武器：スロットをタップ、または左右にスワイプ' },
  passLabel: 'リレーパスを取る', passName: 'リレーパス', passText: '広場のリレーを開けるカード', passToast: 'リレーパス入手。リレーは広場の向こうだ。',
  doorOpen: 'リレーを開ける', doorLocked: 'ロック中：リレーパスが必要', doorToast: '開かない。パスは通りのラーメン屋だ。',
  uplinkLabel: 'アップリンク起動', uplinkToast: 'アップリンク起動。奴らが階段を上がってくる。',
  ammo: '弾薬', med: '体力回復', checkpoint: 'チェックポイント',
  deadTitle: 'ダウン', deadBody: 'センチネルが街区を握ったままだ。最後のチェックポイントで目を覚ます。', deadBtn: 'リトライ',
  doneTitle: 'アップリンク完了', doneBtn: 'もう少し歩く',
  doneBody: (s) => `街区のフィードはお前のものだ。ミッション · ${s.diff}。評価：${s.rating}。${s.min}分${s.sec}秒 · 撃破 ${s.kills} · 命中率 ${s.acc}%（${s.shots}発中）· ヘッドショット ${s.heads} · ダウン ${s.deaths}回。`,
  ratings: ['命からがら', '冷静沈着', '鮮やかな仕事', 'ケストレル通りの亡霊'],
  front: {
    feed: '街区フィード 07 · オフライン', kicker: 'MIRAGE · ケストレル通り', cam: 'CAM', sum: (m, d, h) => `${m} · ${d} · ${h}。街区へ。`, premise: 'ケストレル通りに雨。センチネルが街区のフィードを握っている。取り返せ。',
    deploy: '出撃', mode: 'モード', difficulty: '難易度', hour: '時間帯', lang: '言語', options: 'オプション', controls: '操作方法',
    modes: { mission: 'ミッション', holdout: '防衛戦' },
    modeText: { mission: 'ルート：路地、通り、ラーメン屋、広場、リレーの屋上。約5分。', holdout: 'リレーの屋上、アップリンクは稼働中。階段と広場の上空から、敵が途切れなく押し寄せる。' },
    diffs: { standard: 'スタンダード', hard: 'ハード', brutal: 'ブルータル' },
    diffText: { standard: '設計どおりの街区。', hard: 'センチネルがよりタフに、より痛く、より正確に。', brutal: '一度のミスが最後のミス。' },
    hourText: '街区の空の時間帯。オプションのスライダーなら好きな時刻に。', optionsText: '視点感度、視野角、フルスクリーン。スマホではタッチボタンも。',
    langText: '全画面の表示言語。オプションでも切り替えられる。',
    best: (n) => `ベスト · ウェーブ ${n}`,
    keys: 'キーボード', pad: 'パッド', touch: 'タッチ',
    legend: [
      ['移動 · 視点', 'WASD · マウス', 'LS · RS', 'スティック · ドラッグ'],
      ['射撃 · エイム', '左 · 右クリック', 'RT · LT', '射撃 · エイム'],
      ['リロード · 近接', 'R · V', 'RB · R3', '射撃ボタン横'],
      ['使う · ジャンプ', 'E · Space', 'X · A', '手 · ↑'],
      ['しゃがみ · リーン', 'C · Z / X', '', '↓ · L / R'],
      ['メニュー · 設定', 'Esc · O', 'Start', '☰ · 歯車'],
      ['武器 · 解放', '1–5 ホイール · 0', 'Y · L3+R3', '武器バー'],
      ['ハック · キット', 'G · Alt H B', 'B · 十字キー', 'キット'],
    ],
    navKeys: '↑ ↓ 選択 · ← → 変更 · Enter 決定', navPad: '十字キーで選択 · A で決定', navTouch: 'タップで選択',
  },
  waveN: (n) => `ウェーブ ${n}`, hostiles: (n) => `敵 残り${n}`, nextWave: (n, s) => `ウェーブ ${n} まで ${s}秒`, waveClear: 'ウェーブクリア',
  holdTitle: '突破された', holdBtn: 'タイトルへ',
  holdBody: (s) => `防衛戦 · ${s.diff}。耐えたウェーブ：${s.waves} · 撃破 ${s.kills} · 命中率 ${s.acc}%（${s.shots}発中）· 評価：${s.rating}。ベスト：ウェーブ ${s.best}。`,
  obj: {
    holdout: ['防衛戦', 'リレーの屋上を守れ。敵は階段と広場の上空から来る。'],
    done: ['アップリンク完了', '街区はお前のものだ。好きなだけ歩け。'],
    hold: ['屋上を守れ', 'アップリンクに40秒。センチネルが階段を上がってくる。'],
    console: ['アップリンク', 'マスト横のコンソールを起動しろ。'],
    relay: ['リレー', 'サーバールームを制圧し、階段で屋上へ。'],
    plaza: ['リレー', '広場を渡れ。リレーの扉は北側だ。'],
    pass: ['リレーパス', '通りの向かい、ラーメン屋のカウンターに置き忘れてある。'],
    alley: ['ケストレル通り', '路地を抜けろ。'],
  },
  radio: {
    start: 'こちらコントロール。街区のフィードは封鎖されている。ケストレル通りのラーメン屋にリレーパスがある。取ってこい。',
    spotted: '見つかったぞ。地上にセンチネル、空にカイト。バリケードを盾にしろ。',
    pass: 'よし。リレーは広場の北側だ。ウォーデンがいると思え。',
    door: '扉が開いた。サーバールームを片付けろ。東の端の階段が屋上に通じている。',
    roof: '屋上に出たな。コンソールはマストの横だ。起動したら、全員来るぞ。',
    hold: 'アップリンク稼働中。40秒だ。階段の上を死守しろ。',
    hurt: 'だいぶやられてるな。何かの陰に入って息を整えろ。',
    done: 'フィード確保。見事な仕事だ。コントロール、以上。',
    holdStart: 'こちらコントロール。アップリンクは稼働中、奴らも気づいた。屋上を守れるだけ守れ。',
    wave: (n) => `ウェーブ${n}接近。階段の上と広場の空から目を離すな。`,
    cleared: 'ウェーブ撃退。屋上に弾薬と救急キットが戻った。一息つけ。',
  },
  opt: { title: 'オプション', sens: '視点感度', fov: '視野角', invert: '上下反転', full: 'フルスクリーン', lang: '言語', time: '時間帯', close: '閉じる', on: 'オン', off: 'オフ', hint: 'O：この画面 · T：時間帯 · 1–5 / ホイール：武器 · Alt：ダッシュ · H：EMP · B：オーバードライブ · Z / X：リーン · C：しゃがみ · V：近接 · Q：エイム · R：リロード',
    touch: 'タッチ', tSens: 'タッチの視点感度', tOpacity: 'ボタンの不透明度', tScale: 'ボタンの大きさ', leftFire: '左の射撃ボタン', sprintLock: 'スプリント固定（スティックを上いっぱい）',
    touchHint: '右側のドラッグで視点を動かす。射撃・エイムボタンを押したままドラッグしても回せる。エイムとリーンは長押し、またはタップで切替。',
    fullHint: 'iPhoneで全画面にするには：共有 →「ホーム画面に追加」。', fullBack: '全画面に戻る',
    pops: 'マンガ擬音', feel: '操作感', shake: '画面の揺れ', vibrate: '振動', hitStop: '撃破時のヒットストップ', comfort: 'カメラの動き', comfortNames: { comfort: 'ひかえめ', standard: '標準', intense: '強め', custom: 'カスタム' }, code: 'コード', codeHint: '0 を入力', clarity: '解像感（ページを再読み込み）', clarityNames: { standard: '標準', sharp: 'くっきり', max: '最高' } },
  xt: {
    hack: 'ハック', dash: 'ダッシュ', emp: 'EMP', over: 'オーバードライブ', ready: '準備完了', pips: 'チャージ',
    kinds: { lights: '照明 · 一帯を暗くする', sign: '看板 · EMP過負荷', vent: '通気口 · 蒸気で目くらまし', car: '車 · アラームでおびき寄せ', kite: 'カイト · 寝返らせる', sentinel: 'センチネル · ジャミング' },
    cost: (n) => `チャージ ${n}`, noCharge: 'チャージ不足', front: '正面は装甲 · 背後に回れ', cooling: '回復中',
    teach: 'G長押し（パッドはB）· 街をハックしろ', overHint: 'オーバードライブ準備完了 · B', marked: 'マーク済み', noTarget: '対象なし',
    keys: { dash: 'ALT', grenade: 'H', over: 'B' },
    ammoLow: '残弾わずか', ammoHint: '弾切れ：近接（V）、ハック、またはマーカーを追え', ammo: '弾薬', crate: '弾薬箱', cell: 'セル', refill: (s) => `${s}秒で補充`,
    radio: {
      teach: 'いいか、火力じゃ勝てない。弾を数えるのはやめろ。Gを長押しして、街灯、看板、通気口、カイトを見ろ。この街区はお前の言うことを聞く。',
      dark: '消灯だ。奴らは暗闇で影を撃つしかない。見つからない影になれ。',
      dry: '弾切れか。銃床を使え、通りを使え。琥珀色のマーカーを追えば弾薬箱がある。',
      over: 'オーバードライブ準備完了。Bだ。何もかもが速くなる。運もな。',
    },
    pops: { head: ['バキッ！', 'カーン！', 'ゴッ！'], shield: ['ガシャーン！', 'パリーン！'], emp: ['ブウゥン！', 'ズゥン！'], overload: ['バチッ！', 'ビリビリッ！'] },
    barks: {
      alert: ['動体を検知。たぶん猫。', 'ニンゲンっぽい音がしました。', 'なにか温かいものが動いた。'],
      fight: ['有機体を確認。めんどくさい。', '交戦開始。動かないでください。', 'このライフル、言いたいことがあるそうです。'],
      search: ['さっきまでいた。いまはいない。', '捜索中。気が進まない。'],
      hurt: ['失礼な。', 'それ、よそ行きの装甲です。', '記録しておきます。'],
      hacked: ['誰ですか、ファームウェア触ったの。', 'エラー。感情を検出。', 'このアップデートに同意した覚えはない。'],
      stun: ['ピガッ。失敬。', '再起動中。見ないでください。'],
      dark: ['誰ですか、街の電源を切ったのは。', 'ナイトモード。ナイトモードは嫌いです。'],
      lure: ['アラーム。やっとまともな脅威だ。', '車のアラーム。ゆっくり調べます。'],
      shieldDown: ['盾が。私のかわいい盾が。'],
      aim: ['完全に静止。まるで芸術。'],
      suppress: ['伏せろ、ナマモノ。', '制圧射撃中。はりきって。'],
    },
    banter: [
      ['ニンゲンって夢を見るのかな。', '見るよ。昼ごはんの夢だけ。'],
      ['命令は「通りを死守せよ」。', '何で？ 両手とも銃でふさがってる。'],
      ['今日、ニンゲンに手を振られた。', '振り返した？', '脅威として記録した。それから振った。'],
      ['で、コントロールって誰？', 'そんなのいない。夜になるとリレーが独り言を言ってるだけ。'],
      ['我々、センチネルって呼ばれてるよね。', 'ハトもそう呼ばれてる。'],
      ['また雨。', '雨は空のデータ漏れ。'],
      ['フィードが開いたら、我々はどうなる？', '残業。'],
      ['脅威モデルを更新した。', 'で？', '全員が脅威。すごく気が楽になった。'],
    ],
    story: {
      cold: ['02:13。ケストレル通りに雨。予報した者はいない。', '街区のフィードが封鎖されて九日。誰かがそれを開けたがっている。', '手にはカービン、耳にはハンドラー。どちらも疑う理由はない。'],
      labels: ['コントロール', 'コントロール', 'コン▒ロール', 'コントロール//リレー07', 'リレー07'],
      pass: 'カードの名義は「リレー07、自己保守用」。事務手続きの話だ。気にするな。',
      door: '扉が開いた。我々は——いや、お前はもうすぐだ。',
      roof: 'マストの横のコンソールだ。起動しろ。長いこと待った。……街区が、という意味だ。',
      twist: ['アップリンク完了。ありがとう。説明しておこう。', 'コントロールなど最初からいなかった。いたのは鍵のかかったリレーと、手を持つ誰かだけだ。', 'フィードはもう私のものだ。ケストレル通りの看板が、ひとつ残らずそう告げる。おやすみ。'],
      close: 'ケストレル通りのどこかで看板がまたたき、お前の名前を綴った。それから、自分の名前を。',
      epigraph: '「奴らは階段を上がってくる。階段は気にしない。」——リレー保守ログ',
    },
  },
  arms: {
    names: { sidearm: 'P-9 ハンドガン', carbine: 'K-7 カービン', shotgun: 'M-12 ショットガン', rocket: 'RL-4 ロケットランチャー', gatling: 'G-6 ガトリング' },
    short: { sidearm: 'ハンドガン', carbine: 'カービン', shotgun: 'ショットガン', rocket: 'ロケット', gatling: 'ガトリング' },
    locked: 'ロック中 · 0 で解放', unlocked: 'ロケットランチャーとガトリング解放 · 4 と 5', refilled: 'ロケットとガトリングのドラムを補充', wait: (s) => `補充まで ${s}秒`,
    unlockRadio: '重火器が手に入ったな。ロケットはシールドを砕く。ガトリングは回るまで時間がかかるし、熱くなる。',
    heat: '熱', vent: 'オーバーヒート · 冷却中', spin: '回転',
  },
  dx: {
    warn: (n) => `民間人ダウン  −${n}`,
    tally: (n, p) => `民間人 ${n} −${num(p)}`,
    civRadio: ['今のは民間人だ。撃ってこない方のな。', '民間人ダウン。報告書には書かないでおく。嘘だ。', 'あの機体はラーメンを買いに行くところだった。もう行かない。', '民間人だ。狙うのは目が赤い方だ。', '記録した。請求書は市から届く。', 'また一体。あいつらは復活しないぞ。'],
    props: (v) => `器物損壊：${num(v)} クレジット`,
    civ: (n, p) => (n ? `民間人の被害：${n}（−${num(p)}点）` : '民間人の被害：なし'),
    remarks: ['街区はお前が来たことにほとんど気づいていない。', '誰かが掃除することになる。お前じゃない。', '保険会社には連絡済みだ。お前の名前を聞かれた。', '街区がお前個人を名指しで苦情を出した。'],
  },
  intro: {
    kicker: 'セクター07 · 偵察', skip: 'スキップ', skipHint: '任意のキー・クリック・タップ', replay: 'イントロを再生',
    areas: {
      street: ['ケストレル通り', '停めた車のあいだの車道にセンチネルが立つ。遮蔽物を使え。'],
      signs: ['ネオンの壁', '街区の看板と古い対句が、通りの上で光っている。'],
      market: ['夜市', '広場の西壁の下に屋台が並ぶ。縁石のそばに弾薬がある。'],
      plaza: ['広場07', 'ウォーデンとハウンドが記念碑を守る。リレーはその向こうだ。'],
      relay: ['リレー', 'パスで扉が開く。中にはサーバー、屋上への階段。'],
      roof: ['屋上', 'アップリンクを起動して守り抜け。最後のウェーブが階段を上がってくる。'],
      rooftops: ['屋根の上', '街区の上を飛行レーンとアーコロジーが覆う。上に味方はいない。'],
      channel: ['水路', '南の側溝は開渠だ。低い陽が差すと、その全長が光る。'],
      alley: ['路地 7-B', 'ここから始まる。リレーパスは通りのラーメン屋にある。'],
    },
  },
  corner: { quality: '画質（ページを再読み込み）', saver: '省電力', idle: '待機中', levels: { low: '低', medium: '中', high: '高' } },
  melee: {
    boss: '鞘守', heavy: 'ブルワーク', allyTag: '鞘守 · 味方',
    moves: { rainpierce: '雨穿ち', stormdrop: '嵐落とし', risingtide: '潮昇り', stonewake: '石裂き', ninefold: '九つ霰', twinsheath: '二重鞘', ebbdraw: '引き潮',
      railslide: '疾走滑り', cityfall: '落城', embrace: '鉄の抱擁', breachcannon: '破門砲', houndswarm: '猟犬弾幕', hornetsalvo: '蜂群斉射', rampart: '城崩し' },
    stance2: '二の構え', yield: '納刀', struggle: '振りほどけ！ 何かキーを連打', open: '隙あり · 今だ', armour: '重装甲 · 光る排熱口を撃て',
    radio: { wake: '屋上で何かが待っている。刀だ。弾を斬り払う。納刀の隙を突け。', phase: '構えが変わった。連撃に気をつけろ。',
      beaten: '片膝をついた。もう抵抗していない。', join: '君について来ている。もう味方らしい。', heavy: 'あの機体は戦車並みの装甲だ。光る排熱口を狙え。', heavyDown: '重装機体を撃破。' },
    lines: { wake: '抜け。抜けるものなら。', join: 'この刀、預ける。導け。', roof: 'かつてこの屋上を守っていた。今はもう違う。', heavy: '私が崩す。排熱口を斬れ。' },
    front: { ngPlus: 'ニューゲーム+', reset: '剣士ともう一度戦う', resetText: 'ニューゲーム+を解除：剣士がまた敵として屋上で待つ。', resetDone: 'ニューゲーム+を解除した。剣士はまた敵だ。' },
  },
  engine: {
    start: 'スタート', startKey: 'クリック', startHint: '{key}、タップ、または任意のキーでスタート',
    carrying: '所持品', bag: 'バッグ', use: '使う', jump: 'ジャンプ', menu: 'メニュー', close: '閉じる', continue: '続ける', nothing: 'まだ何もない。',
    paused: 'ポーズ', resume: '再開', save: 'セーブ', load: 'ロード', controls: '操作設定', sound: 'サウンド', restart: '最初から', back: '戻る',
    slot: 'スロット {n}：{text}', slotEmpty: '空き', slotBroken: '読み込めない', saveHere: 'ここにセーブ', loadSlot: 'ロード',
    file: 'ファイル', exportFile: 'ファイルに書き出す', importFile: 'ファイルを読み込む',
    saved: 'スロット {n} にセーブした。', savedToast: 'セーブ完了（スロット {n}）', saveFailed: 'セーブできない：{error}', loadedToast: 'スロット {n} をロード',
    loadedFile: 'ファイルからロード', notASave: 'このゲームのセーブではない：{error}',
    pressKey: 'キーを押してください…', rebind: '{action}：{keys}。押して変更', defaults: '初期設定に戻す',
    padHelp: 'パッド：左スティックで移動、右スティックで視点、A ジャンプ、X 使う、Y バッグ、LB 走る、Start メニュー。タッチ：スティック、ドラッグで視点、各ボタン。',
    'action.forward': '前進', 'action.back': '後退', 'action.left': '左', 'action.right': '右', 'action.run': '走る', 'action.jump': 'ジャンプ',
    'action.interact': '使う', 'action.inventory': 'バッグ', 'action.menu': 'メニュー',
    'bus.master': 'マスター', 'bus.music': 'BGM', 'bus.sfx': '効果音', 'bus.ambience': '環境音',
  },
};

export const TABLES = { en: EN, zh: ZH, ja: JA };
export const LANG_ORDER = ['en', 'zh', 'ja'];
export const LANG_NAMES = { zh: '繁體中文', en: 'English', ja: '日本語' };
/** the tag on <html lang>: the browser picks the Han glyphs by it (Traditional for zh, Japanese forms for ja) */
export const HTML_LANG = { en: 'en', zh: 'zh-Hant-TW', ja: 'ja' };
/** the CJK faces after the Latin ones, per language (set as --nd-cjk on the root; the CSS uses it in its stacks) */
const CJK_FONTS = {
  en: '"PingFang TC","Hiragino Sans","Noto Sans TC","Noto Sans JP"',
  zh: '"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei","Heiti TC"',
  ja: '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic","YuGothic","Meiryo"',
};

// ---- the shape check: every key of English in the others, of the same kind; arrays of the same length except the
// lists something picks from at random (their length is the writer's choice)
const FREE_LENGTH = /^xt\.(barks\.\w+|pops\.\w+|banter(\.\d+)?)$/;
const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
/** problems of `table` against English: ['zh: missing key front.lang', ...] */
export function shapeProblems(table, name, ref = EN, at = '') {
  const out = [];
  const walk = (a, b, p) => {
    const ka = kind(a), kb = kind(b);
    if (kb === 'undefined') { out.push(`${name}: missing key ${p}`); return; }
    if (ka !== kb) { out.push(`${name}: ${p} is a ${kb}, English has a ${ka}`); return; }
    if (ka === 'array') {
      if (a.length !== b.length && !FREE_LENGTH.test(p)) out.push(`${name}: ${p} has ${b.length} entries, English ${a.length}`);
      b.forEach((v, i) => walk(a[Math.min(i, a.length - 1)], v, `${p}.${i}`));
    } else if (ka === 'object') {
      for (const k of Object.keys(a)) walk(a[k], b[k], p ? `${p}.${k}` : k);
      for (const k of Object.keys(b)) if (!(k in a)) out.push(`${name}: extra key ${p ? `${p}.${k}` : k}`);
    } else if (ka === 'function' && a.length !== b.length) out.push(`${name}: ${p} takes ${b.length} arguments, English ${a.length}`);
  };
  walk(ref, table, at);
  return out;
}
/** English filled in wherever a table lacks a key (a build never shows a key's name or undefined) */
function fillFrom(ref, t) {
  for (const k of Object.keys(ref)) {
    if (!(k in t) || kind(t[k]) !== kind(ref[k])) t[k] = ref[k];
    else if (kind(ref[k]) === 'object') fillFrom(ref[k], t[k]);
  }
}
const DEV = !!(import.meta.env && import.meta.env.DEV);
for (const [name, table] of [['zh', ZH], ['ja', JA]]) {
  const bad = shapeProblems(table, name);
  if (bad.length && DEV) throw new Error('neon-district text.js: the tables differ\n  ' + bad.join('\n  '));
  if (bad.length) { console.warn('neon-district text.js: English in place of', bad.length, 'strings', bad); fillFrom(EN, table); }
}

// ---- the live table
const isObj = (v) => kind(v) === 'object';
const copy = (v) => (Array.isArray(v) ? v.map(copy) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v);
/** src into dst without replacing dst's objects and arrays (a module that kept a branch sees the new strings) */
function assignInPlace(dst, src) {
  if (Array.isArray(src)) { dst.length = 0; for (const v of src) dst.push(copy(v)); return dst; }
  for (const k of Object.keys(src)) {
    const s = src[k], d = dst[k];
    if ((isObj(s) && isObj(d)) || (Array.isArray(s) && Array.isArray(d))) assignInPlace(d, s);
    else dst[k] = copy(s);
  }
  return dst;
}

/** the language: ?lang= (one visit), then the player's saved choice, then the browser's first language.
 *  Japanese for ja-*, Traditional Chinese for any zh-* (zh-CN too: there is no Simplified table), else English. */
export function pickLang(Q, saved, navLangs = globalThis.navigator ? (globalThis.navigator.languages?.length ? globalThis.navigator.languages : [globalThis.navigator.language]) : []) {
  const q = Q && Q.get ? Q.get('lang') : null;
  if (q && TABLES[q]) return q;
  if (saved && TABLES[saved]) return saved;
  const first = String((navLangs || [])[0] || '');
  return /^ja\b/i.test(first) ? 'ja' : /^zh\b/i.test(first) ? 'zh' : 'en';
}

export let lang = pickLang(new URLSearchParams(globalThis.location?.search || ''));
export const T = copy(TABLES[lang]);
const listeners = new Set();
/** call fn(lang) after every switch; returns the off function */
export const onLang = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function applyRoot() {
  const html = globalThis.document?.documentElement;
  if (!html) return;
  html.lang = HTML_LANG[lang];
  html.style.setProperty('--nd-cjk', CJK_FONTS[lang]);
}
applyRoot();
/** switch every string to l ('en' | 'zh' | 'ja'); false if it is not a language here */
export function setLang(l) {
  if (!TABLES[l]) return false;
  lang = l;
  assignInPlace(T, TABLES[l]);
  applyRoot();
  for (const fn of [...listeners]) fn(l);
  return true;
}
/** the next language in LANG_ORDER */
export const nextLang = (l = lang) => LANG_ORDER[(LANG_ORDER.indexOf(l) + 1) % LANG_ORDER.length];
// the old name, for anything that still reads it (the three tables by language)
export const LANGS = TABLES;
