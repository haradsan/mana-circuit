// ============================================================
// stages.js — ステージ定義（16面）・盤面グラフ構築・進行度セーブ
// ============================================================
// 盤面は「グラフ」: 各マスが next（次のマスidの配列）を持つ。
// v23（自由移動）: ダイス移動は隣接マスへ双方向に進める（moveOptions・state.js）。next は
//   「正規ルート」（既定の周回方向・AIの近似先読み・walkAhead）と、一方通行の向きの定義に使う。
//
// ステージ定義:
//   board.rings  : 長方形ループの列。{w,h,x0,y0,start?}。最初のリングの先頭マスが城(id 0)。
//                  start=[x,y] でループの開始マスを回転指定（八の字の共有マス用）
//   board.chords : 近道。{from:[x,y], cells:[[x,y]...], to:[x,y]} — from/to はリング上のマス。
//                  oneway:true を付けると通路の中間マスが➡一方通行マスになる（from→to 方向にしか
//                  進めず、出口側から入ることもできない。盤面に矢印で表示される）
//   board.warpPairs : [["x,y","x,y"]] 対応マスへ飛ぶ（typesでWARP指定すること）
//   types        : {"x,y": "GATE"|"CARD"|"MAGIC"|"MAGMA"|"BOOST"|"WARP"|"FORTUNE"|"SPRING"} 指定なしはLAND
//   theme        : ステージの雰囲気カラー {glow, bg, path, dot}（背景グラデーション・回路の道の色）
//   elements     : 属性ブロックの並び（短いパレット）。同属性を RUN マス連続で置いて連鎖を出やすくする。
//                  先頭に4属性を並べれば小さい盤面でも全属性が出る。bias属性を多く入れると偏る。
//   elemRun      : 属性ブロックの長さ（省略時3）。大きいほど同属性が固まり連鎖が強くなる
//   elementAt    : {"x,y": element} 個別指定（循環より優先）
//   gatesNeeded  : 周回に必要な関門数（省略時3）
//   rules        : state.js の DEFAULT_RULES への上書き
"use strict";

// ---------- 盤面ヘルパー ----------
// w×h 長方形の外周マス座標（下辺中央から時計回り）
function ringCoords(w, h, x0 = 0, y0 = 0) {
  const cells = [];
  const cx = Math.floor((w - 1) / 2);
  for (let x = cx; x >= 0; x--) cells.push([x0 + x, y0 + h - 1]);
  for (let y = h - 2; y >= 0; y--) cells.push([x0, y0 + y]);
  for (let x = 1; x <= w - 1; x++) cells.push([x0 + x, y0]);
  for (let y = 1; y <= h - 1; y++) cells.push([x0 + w - 1, y0 + y]);
  for (let x = w - 2; x > cx; x--) cells.push([x0 + x, y0 + h - 1]);
  return cells;
}

function rotateToStart(cells, start) {
  const i = cells.findIndex(c => c[0] === start[0] && c[1] === start[1]);
  if (i < 0) { console.error("[stages] start座標がリング上にない", start); return cells; }
  return cells.slice(i).concat(cells.slice(0, i));
}

// ステージ定義 → タイル配列（id/x/y/type/element/next/warpTo）
function buildBoard(stage) {
  const b = stage.board;
  const paths = [];
  b.rings.forEach(r => {
    let cells = ringCoords(r.w, r.h, r.x0 || 0, r.y0 || 0);
    if (r.start) cells = rotateToStart(cells, r.start);
    paths.push([...cells, cells[0]]); // 閉路
  });
  (b.chords || []).forEach(c => paths.push([c.from, ...c.cells, c.to]));

  const keyOf = c => c[0] + "," + c[1];
  const tiles = [];
  const idxByKey = {};
  const idxOf = c => {
    const k = keyOf(c);
    if (idxByKey[k] === undefined) {
      idxByKey[k] = tiles.length;
      tiles.push({ id: tiles.length, x: c[0], y: c[1], type: null, element: null, owner: null, level: 0, creature: null, next: [] });
    }
    return idxByKey[k];
  };
  paths.forEach(path => {
    for (let i = 1; i < path.length; i++) {
      const a = idxOf(path[i - 1]), b2 = idxOf(path[i]);
      if (a !== b2 && !tiles[a].next.includes(b2)) tiles[a].next.push(b2);
    }
  });

  // ➡一方通行（v23）: oneway:true の通路は中間マスに onewayTo（唯一の出口）を刻む。
  // from/to 端点はリング上の共有マスなので自由なまま＝「入口から入り、出口へ抜ける」だけの道になる
  (b.chords || []).forEach(c => {
    if (!c.oneway) return;
    const path = [c.from, ...c.cells, c.to];
    for (let i = 1; i < path.length - 1; i++) {
      tiles[idxOf(path[i])].onewayTo = idxOf(path[i + 1]);
    }
  });

  // タイプ・属性の割り当て（id 0 は常に城）
  // 属性は「同属性を RUN マス連続で置く」クラスタ割当にして連鎖（同属性の隣接地）を出やすくする。
  //   elements は“属性ブロックの並び”を表す短いパレット（bias属性を厚めに）。RUN で各ブロックの長さを決める。
  //   非LANDマス（関門/カード等）で列が分断されても、隣接する土地同士は同属性になりやすい。
  //   elementAt の個別指定は循環を消費しない（ci を進めない）ので、指定タイルは連鎖の起点として別枠に置ける。
  let ci = 0;
  const RUN = stage.elemRun || 3;
  tiles.forEach(t => {
    const k = t.x + "," + t.y;
    t.type = t.id === 0 ? "CASTLE" : (stage.types[k] || "LAND");
    if (t.type === "LAND") {
      t.level = 1;
      t.element = (stage.elementAt && stage.elementAt[k]) || stage.elements[Math.floor(ci++ / RUN) % stage.elements.length];
    }
  });
  (b.warpPairs || []).forEach(([a, c]) => {
    const ia = idxByKey[a], ic = idxByKey[c];
    if (ia === undefined || ic === undefined) { console.error("[stages] warp座標が不正", a, c); return; }
    tiles[ia].warpTo = ic;
    tiles[ic].warpTo = ia;
  });
  return tiles;
}

// ---------- ステージ定義 ----------
const STAGES = [
  {
    id: "s1", name: "草原の環", icon: "🌿",
    cpuName: "見習いセプター・ノア", ai: "novice",
    desc: "ひとまわり20マスの小さな環。テンポよく周回ボーナスを稼ごう。火・木・地・水の4属性バランス型。",
    board: { rings: [{ w: 6, h: 6 }] },
    types: {
      "0,2": "GATE", "3,0": "GATE", "5,3": "GATE",
      "0,5": "CARD", "5,0": "CARD",
      "1,0": "MAGIC", "4,5": "MAGIC",
      "1,5": "FORTUNE",
    },
    elements: ["fire", "wood", "earth", "water"],
    theme: { glow: "#24402a", bg: "#121c13", path: "#1d2b20", dot: "#6f9a6f" },
    rules: { target: 3000, maxRounds: 32 },
  },
  {
    id: "s2", name: "火山峠ヴォルグ", icon: "🌋",
    cpuName: "火術師ヴォルグ", ai: "easy", cpuBias: "fire",
    desc: "横に長い22マスの峠道。火の土地が多く、🌋マグマに止まると80G失う。",
    board: { rings: [{ w: 7, h: 6 }] },
    types: {
      "0,3": "GATE", "3,0": "GATE", "6,3": "GATE",
      "1,5": "CARD", "5,0": "CARD",
      "1,0": "MAGIC", "5,5": "MAGIC",
      "0,0": "MAGMA", "6,1": "MAGMA",
      "6,5": "FORTUNE",
    },
    elements: ["fire", "water", "wood", "earth", "fire"],
    theme: { glow: "#40231a", bg: "#1c1210", path: "#2e1c16", dot: "#a06a4a" },
    rules: { target: 3200, maxRounds: 34 },
  },
  {
    id: "s3", name: "蒼水の都メルディア", icon: "🌊",
    cpuName: "水賢者マリナ", ai: "easy", cpuBias: "water",
    desc: "24マスの環に「水路の橋」が架かる29マスの街。橋を渡れば対岸へ近道、中央には💎魔力の泉。",
    board: {
      rings: [{ w: 7, h: 7 }],
      chords: [{ from: [0, 3], cells: [[1, 3], [2, 3], [3, 3], [4, 3], [5, 3]], to: [6, 3] }],
    },
    types: {
      "0,4": "GATE", "3,0": "GATE", "6,4": "GATE",
      "1,6": "CARD", "5,6": "CARD",
      "6,0": "MAGIC", "3,3": "MAGIC",
      "0,0": "FORTUNE", "6,6": "SPRING",
    },
    elementAt: { "1,3": "water", "2,3": "water", "4,3": "water", "5,3": "water" },
    elements: ["water", "fire", "wood", "earth", "water"],
    theme: { glow: "#1c2c4a", bg: "#0f1624", path: "#1a2338", dot: "#4a6a9a" },
    hud: { left: "50%", top: "72%", width: "46%" },
    rules: { target: 3500, maxRounds: 38 },
  },
  {
    id: "s4", name: "風走る高地", icon: "🍃",
    cpuName: "疾風のセイル", ai: "normal", cpuBias: "wood",
    desc: "横一直線に伸びた24マスの細長い高原。💨疾風マスに乗れば一気に加速、城へ吹き戻されることも。",
    board: { rings: [{ w: 10, h: 4 }] },
    types: {
      "0,1": "GATE", "5,0": "GATE", "9,2": "GATE",
      "2,0": "CARD", "7,3": "CARD",
      "1,3": "MAGIC", "8,0": "MAGIC",
      "3,0": "BOOST", "6,3": "BOOST",
      "9,0": "FORTUNE", "0,3": "SPRING",
    },
    elements: ["wood", "fire", "water", "earth", "wood"],
    theme: { glow: "#263c1e", bg: "#131a10", path: "#1e2a18", dot: "#7a9a5a" },
    hud: { left: "50%", top: "50%", width: "62%" },
    rules: { target: 3200, maxRounds: 36 },
  },
  {
    id: "s5", name: "大地の霊峰ガンド", icon: "⛰️",
    cpuName: "岩人ドルガ", ai: "normal", cpuBias: "earth",
    desc: "縦に高い24マスの霊峰＋中腹を横切る「尾根の近道」。尾根の奥には+300Gの地脈💎が眠る。",
    board: {
      rings: [{ w: 6, h: 8 }],
      chords: [{ from: [0, 4], cells: [[1, 4], [2, 4], [3, 4], [4, 4]], to: [5, 4] }],
    },
    types: {
      "0,2": "GATE", "3,0": "GATE", "5,2": "GATE",
      "1,7": "CARD", "4,0": "CARD",
      "0,0": "MAGIC", "2,4": "MAGIC",
      "5,7": "FORTUNE", "5,0": "SPRING",
    },
    elementAt: { "1,4": "earth", "3,4": "earth", "4,4": "earth" },
    elements: ["earth", "fire", "wood", "water", "earth"],
    theme: { glow: "#3a2e1e", bg: "#191410", path: "#291f15", dot: "#8a7a5a" },
    hud: { left: "50%", top: "29%", width: "50%" },
    rules: { target: 3400, maxRounds: 38, magicTileG: 300 },
  },
  {
    id: "s6", name: "幻影回廊リノア", icon: "🌀",
    cpuName: "幻術師リノア", ai: "normal",
    desc: "2つの環が🏰城で交差する31マスの「八の字」回廊。周回には両方の環を巡る必要がある。遠い角同士は🌀ワープで繋がる。",
    board: {
      rings: [
        { w: 5, h: 5, x0: 0, y0: 0, start: [4, 4] },
        { w: 5, h: 5, x0: 4, y0: 4, start: [4, 4] },
      ],
      warpPairs: [["0,0", "8,8"]],
    },
    types: {
      "0,2": "GATE", "2,0": "GATE", "8,6": "GATE", "6,8": "GATE",
      "1,4": "CARD", "7,4": "CARD",
      "4,0": "MAGIC", "4,8": "MAGIC",
      "0,0": "WARP", "8,8": "WARP",
      "0,4": "FORTUNE", "8,4": "SPRING",
    },
    gatesNeeded: 3,
    elements: ["fire", "wood", "earth", "water"],
    theme: { glow: "#33204a", bg: "#140f20", path: "#251a38", dot: "#8a6ab8" },
    hud: { left: "24%", top: "76%", width: "42%" },
    rules: { target: 3000, maxRounds: 40 },
  },
  {
    id: "s7", name: "黄金市場ゴルド", icon: "💰",
    cpuName: "大商人ゴルド", ai: "hard", cpuBias: "water",
    desc: "28マスの大きな市場をぐるりと回る。通行料は割高、💎魔力+250・⛩️関門+150の高額経済戦。",
    board: { rings: [{ w: 8, h: 8 }] },
    types: {
      "0,3": "GATE", "4,0": "GATE", "7,4": "GATE",
      "1,0": "CARD", "6,7": "CARD",
      "0,0": "MAGIC", "7,0": "MAGIC",
      "0,7": "FORTUNE", "7,7": "FORTUNE",
    },
    elements: ["water", "fire", "wood", "earth", "water"],
    theme: { glow: "#403618", bg: "#19150c", path: "#2c2512", dot: "#b89a4a" },
    rules: { target: 4200, maxRounds: 40, tollRate: 0.85, magicTileG: 250, gateBonus: 150 },
  },
  {
    id: "s8", name: "闘技場アレナ", icon: "⚔️",
    cpuName: "剣闘士ガイアス", ai: "hard", cpuBias: "earth",
    desc: "たった16マスの小さな闘技場。土地の奪い合いは避けられない。侵略ST+10＆土地の加護2倍。周回は関門2つでOK。",
    board: { rings: [{ w: 5, h: 5 }] },
    types: {
      "0,2": "GATE", "4,2": "GATE",
      "2,0": "CARD",
      "0,0": "MAGIC", "4,4": "MAGIC",
    },
    gatesNeeded: 2,
    elements: ["earth", "fire", "water", "wood", "earth"],
    theme: { glow: "#40202a", bg: "#180f12", path: "#2c181e", dot: "#a05a6a" },
    rules: { target: 4000, maxRounds: 40, invaderSt: 10, landHpMult: 2 },
  },
  {
    id: "s9", name: "雷鳴峡谷ズーム", icon: "⚡",
    cpuName: "雷帝ズーム", ai: "hard", cpuBias: "water",
    desc: "24マスの環を縦横の谷道が貫く33マスの大峡谷。中央の十字路で道を選べ。谷道には🌋マグマと💨疾風が待つ。",
    board: {
      rings: [{ w: 7, h: 7 }],
      chords: [
        { from: [0, 3], cells: [[1, 3], [2, 3], [3, 3], [4, 3], [5, 3]], to: [6, 3] },
        { from: [3, 0], cells: [[3, 1], [3, 2], [3, 3], [3, 4], [3, 5]], to: [3, 6] },
      ],
    },
    types: {
      "0,4": "GATE", "5,0": "GATE", "6,4": "GATE",
      "1,6": "CARD", "6,0": "CARD",
      "0,0": "MAGIC", "6,2": "MAGIC",
      "1,3": "BOOST", "3,4": "BOOST",
      "4,3": "MAGMA", "3,2": "MAGMA",
      "0,6": "FORTUNE", "6,6": "SPRING",
    },
    elements: ["water", "fire", "earth", "wood", "water"],
    theme: { glow: "#2c3140", bg: "#0f131c", path: "#1e2330", dot: "#7a86b0" },
    hud: { left: "27%", top: "30%", width: "38%" },
    rules: { target: 3200, maxRounds: 42 },
  },
  {
    id: "s10", name: "魔王城ザルバド", icon: "👑",
    cpuName: "魔王ザルバド", ai: "demon", cpuBias: "fire",
    desc: "最終決戦。28マスの城郭の頂から🏰玉座へ一直線に堕ちる「地獄回廊」——ただし🌋マグマだらけ。魔王は初期魔力+200。",
    board: {
      rings: [{ w: 9, h: 7 }],
      // 地獄回廊は「堕ちる」だけの➡一方通行（v23: 自由移動化に伴い明示）
      chords: [{ from: [4, 0], cells: [[4, 1], [4, 2], [4, 3], [4, 4], [4, 5]], to: [4, 6], oneway: true }],
    },
    types: {
      "0,3": "GATE", "4,0": "GATE", "8,3": "GATE",
      "1,6": "CARD", "7,0": "CARD",
      "0,0": "MAGIC", "8,0": "MAGIC",
      "3,6": "MAGMA", "5,6": "MAGMA", "4,2": "MAGMA", "4,4": "MAGMA",
      "0,6": "FORTUNE", "8,6": "SPRING",
    },
    elementAt: { "4,1": "fire", "4,3": "fire", "4,5": "fire" },
    elements: ["fire", "water", "wood", "earth", "fire"],
    theme: { glow: "#401820", bg: "#140c10", path: "#2a141c", dot: "#904a5a" },
    hud: { left: "26%", top: "50%", width: "40%" },
    rules: { target: 4500, maxRounds: 45, cpuMagicBonus: 200 },
  },
  {
    // ★ 非環状（星型）盤面のデモ：中央の環から四方へ小さな環が伸びる「四つ辻」。
    //   関門はgatesNeeded:"all"で全て必須通過点＝4つ全て回って城へ戻れば1周。対角のショートカットで三叉路になる。
    id: "s11", name: "星辰の四つ辻", icon: "✴️",
    cpuName: "星詠みステラ", ai: "normal",
    desc: "中央の環から四方へ小さな環が伸びる星型の盤面。⛩️関門4つは全てが必須通過点——全て巡って城へ戻れば1周。中央を貫く対角路は三叉路になっている。",
    board: {
      rings: [
        { w: 3, h: 3, x0: 2, y0: 2 },   // 中央の環（城はここ）
        { w: 3, h: 3, x0: 0, y0: 0 },   // 左上の環（角(2,2)を共有）
        { w: 3, h: 3, x0: 4, y0: 0 },   // 右上の環（角(4,2)を共有）
        { w: 3, h: 3, x0: 0, y0: 4 },   // 左下の環（角(2,4)を共有）
        { w: 3, h: 3, x0: 4, y0: 4 },   // 右下の環（角(4,4)を共有）
      ],
      chords: [
        { from: [2, 2], cells: [[3, 3]], to: [4, 4] },  // 左上⇄右下の対角ショートカット（三叉路化）
        { from: [4, 2], cells: [[3, 3]], to: [2, 4] },  // 右上⇄左下の対角ショートカット
      ],
    },
    types: {
      "0,0": "GATE", "6,0": "GATE", "0,6": "GATE", "6,6": "GATE",
      "3,3": "MAGIC",
      "1,0": "CARD", "5,6": "CARD",
      "5,2": "MAGIC", "1,4": "MAGIC",
      "0,5": "FORTUNE", "6,5": "SPRING",
    },
    gatesNeeded: "all",
    elements: ["fire", "wood", "earth", "water"],
    theme: { glow: "#1e2440", bg: "#0d1120", path: "#181e33", dot: "#5a6ab0" },
    hud: { left: "50%", top: "43%", width: "32%" },
    rules: { target: 3200, maxRounds: 44 },
  },
  {
    // ★ v18追加: 三つ巴のために設計した大型盤面。外周の大環に「三本の腕」が刺さり、
    //   どの腕も中央のハブ(3,3)を経て城へ流れ込む＝終盤の凱旋レースが熱い。
    id: "s12", name: "円卓の三叉界", icon: "🎭",
    cpuName: "円卓の盟主アルヴィス", ai: "hard",
    desc: "外周28マスの大環に、三方から城へ流れ込む「円卓の腕」が交わる40マスの決戦場。⚔三つ巴で真価を発揮する広さ——🎰運命と⛲泉が波乱を呼ぶ。",
    board: {
      rings: [{ w: 8, h: 8 }],
      chords: [
        { from: [3, 0], cells: [[3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6]], to: [3, 7] }, // 北の腕（城まで一直線）
        { from: [0, 3], cells: [[1, 3], [2, 3]], to: [3, 3] },                                 // 西の腕（ハブへ）
        { from: [7, 3], cells: [[6, 3], [5, 3], [4, 3]], to: [3, 3] },                         // 東の腕（ハブへ）
      ],
    },
    types: {
      "0,4": "GATE", "7,4": "GATE", "3,0": "GATE",
      "3,3": "MAGIC", "0,0": "MAGIC", "7,0": "MAGIC",
      "1,7": "CARD", "6,0": "CARD",
      "0,7": "FORTUNE", "7,7": "FORTUNE",
      "3,5": "SPRING",
    },
    elements: ["fire", "wood", "earth", "water"],
    theme: { glow: "#3a2a40", bg: "#160f20", path: "#291f36", dot: "#9a6ab8" },
    hud: { left: "69%", top: "70%", width: "28%" },
    rules: { target: 3600, maxRounds: 46 },
  },
  {
    // ★ v20（第二弾）: 「盤面が手狭」への回答その1＝横に広い46マスの大草原。
    //   経済・建造物・移動スペルがのびのび活きる通常大型ステージ。
    id: "s13", name: "隊商の大草原", icon: "🐪",
    cpuName: "隊商長ラシード", ai: "normal", cpuBias: "wood",
    desc: "地平まで続く46マスの大草原を、隊商路が横切る。道は長く、土地は豊か——🏛建造物や⛏採掘でじっくり富を育てる者が勝つ。",
    board: {
      rings: [{ w: 12, h: 8 }],
      chords: [{ from: [0, 4], cells: [[1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4]], to: [11, 4] }],
    },
    types: {
      "0,2": "GATE", "5,0": "GATE", "11,2": "GATE",
      "2,0": "CARD", "9,7": "CARD",
      "0,6": "MAGIC", "11,6": "MAGIC", "5,4": "MAGIC",
      "0,0": "FORTUNE", "11,0": "FORTUNE",
      "2,4": "SPRING", "8,0": "BOOST", "8,4": "SPRING",
    },
    elements: ["wood", "earth", "fire", "water", "wood"],
    theme: { glow: "#3c3a1e", bg: "#171610", path: "#2a2816", dot: "#b0a45a" },
    hud: { left: "50%", top: "26%", width: "50%" },
    rules: { target: 3800, maxRounds: 48 },
  },
  {
    // ★ v20（第二弾）: 「盤面が手狭」への回答その2＝外環と内環を4本の歯車道で結ぶ56マスの機構都市。
    //   内環は近道だが出口は南と東のみ＝一方通行の歯車に巻き込まれる緊張感。
    id: "s14", name: "時計仕掛けの大環", icon: "⚙️",
    cpuName: "機構技師ギアハルト", ai: "hard", cpuBias: "earth",
    desc: "巨大な外環と小さな内環が4本の歯車道で噛み合う56マスの機構都市。北と西から内環へ入り、南と東へ吐き出される——歯車の回りを読んだ者が時を制す。",
    board: {
      rings: [
        { w: 10, h: 10 },
        { w: 4, h: 4, x0: 3, y0: 3 },
      ],
      // 歯車道は4本とも➡一方通行（v23: 自由移動化に伴い明示。内環自体は自由に回れる）
      chords: [
        { from: [4, 0], cells: [[4, 1], [4, 2]], to: [4, 3], oneway: true }, // 北の歯車道（外→内）
        { from: [0, 4], cells: [[1, 4], [2, 4]], to: [3, 4], oneway: true }, // 西の歯車道（外→内）
        { from: [4, 6], cells: [[4, 7], [4, 8]], to: [4, 9], oneway: true }, // 南の歯車道（内→外）
        { from: [6, 4], cells: [[7, 4], [8, 4]], to: [9, 4], oneway: true }, // 東の歯車道（内→外）
      ],
    },
    types: {
      "0,3": "GATE", "4,0": "GATE", "9,5": "GATE",
      "1,0": "CARD", "8,9": "CARD",
      "0,8": "MAGIC", "9,0": "MAGIC", "5,3": "MAGIC",
      "2,9": "BOOST", "7,0": "BOOST",
      "0,0": "FORTUNE", "9,9": "FORTUNE",
      "3,4": "SPRING",
    },
    elements: ["earth", "water", "fire", "wood", "earth"],
    theme: { glow: "#3a3226", bg: "#151310", path: "#2a2418", dot: "#b08a4a" },
    hud: { left: "24%", top: "78%", width: "34%" },
    rules: { target: 4000, maxRounds: 50 },
  },
  {
    // ★ v20（第二弾ボスその1）: 四隅の玉座の間に4体の精霊王が眠る56マスの神殿。
    //   ⛩️関門4つは全て必須（gatesNeeded:"all"）。巫女は精霊王4体を固定エースに従える（cpuAces）。
    id: "s15", name: "五王の間", icon: "🕯️",
    cpuName: "精霊王の巫女セレスティア", ai: "hard",
    cpuAces: ["ignisking", "sylvanking", "terraking", "nereusking"],
    desc: "中央の祭壇から四方の玉座の間へ渡る56マスの大神殿。⛩️4つの玉座はすべて必須通過点。巫女セレスティアは👑火・木・地・水の精霊王を従える——王たちの目覚めが遅いことを祈れ。",
    board: {
      rings: [
        { w: 4, h: 4, x0: 3, y0: 3 },   // 中央の祭壇（城はここ）
        { w: 4, h: 4, x0: 0, y0: 0 },   // 焔王の間（角(3,3)を共有）
        { w: 4, h: 4, x0: 6, y0: 0 },   // 翠王の間（角(6,3)を共有）
        { w: 4, h: 4, x0: 0, y0: 6 },   // 岩帝の間（角(3,6)を共有）
        { w: 4, h: 4, x0: 6, y0: 6 },   // 海王の間（角(6,6)を共有）
      ],
    },
    types: {
      "0,0": "GATE", "9,0": "GATE", "0,9": "GATE", "9,9": "GATE",
      "3,0": "MAGIC", "6,9": "MAGIC", "0,3": "MAGIC", "9,6": "MAGIC",
      "6,0": "CARD", "3,9": "CARD",
      "0,6": "FORTUNE", "9,3": "FORTUNE",
      "4,3": "SPRING", "5,6": "SPRING",
    },
    gatesNeeded: "all",
    elements: ["fire", "wood", "earth", "water"],
    theme: { glow: "#403420", bg: "#181207", path: "#2e2412", dot: "#c8a44a" },
    hud: { left: "78%", top: "22%", width: "30%" },
    rules: { target: 4200, maxRounds: 50, cpuMagicBonus: 300 },
  },
  {
    // ★ v20（第二弾ボスその2・最終）: 時の十字が刻まれた51マスの玉座。
    //   時空王アイオーン自身が盤上に立つ（cpuAces=aeonking×2）。中央は🌋マグマに守られた💎時の泉。
    id: "s16", name: "時流の玉座", icon: "⏳",
    cpuName: "時空王アイオーン", ai: "demon", cpuBias: "water",
    cpuAces: ["aeonking", "aeonking"],
    desc: "第二弾の最終決戦。51マスの大環に「時の十字」が交わる時空の玉座——中央の💎大魔力は🌋時の奔流に守られている。時空王アイオーンは自らの写し身を従え、潤沢な資金で時を支配する。",
    board: {
      rings: [{ w: 10, h: 10 }],
      chords: [
        { from: [5, 0], cells: [[5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [5, 8]], to: [5, 9] },
        { from: [0, 5], cells: [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5]], to: [9, 5] },
      ],
    },
    types: {
      "0,3": "GATE", "5,0": "GATE", "9,3": "GATE",
      "1,9": "CARD", "8,0": "CARD",
      "5,5": "MAGIC", "0,0": "MAGIC", "9,0": "MAGIC",
      "5,4": "MAGMA", "5,6": "MAGMA",
      "9,7": "BOOST",
      "0,9": "FORTUNE", "9,9": "FORTUNE",
      "3,5": "SPRING",
    },
    elements: ["water", "fire", "earth", "wood", "water"],
    theme: { glow: "#2a2440", bg: "#100e1c", path: "#1e1a33", dot: "#8a7ab8" },
    hud: { left: "24%", top: "24%", width: "34%" },
    rules: { target: 4800, maxRounds: 52, cpuMagicBonus: 400, magicTileG: 300 },
  },
];

// ---------- 定義の整合性チェック（起動時に一度だけ実行） ----------
function validateStages() {
  STAGES.forEach(s => {
    const tiles = buildBoard(s);
    const byKey = {};
    tiles.forEach(t => { byKey[t.x + "," + t.y] = t; });
    // types/elementAt の座標が実在するか
    Object.keys(s.types).forEach(k => {
      if (!byKey[k]) console.error(`[stages] ${s.id}: types座標 ${k} が盤面にない`);
    });
    Object.keys(s.elementAt || {}).forEach(k => {
      if (!byKey[k]) console.error(`[stages] ${s.id}: elementAt座標 ${k} が盤面にない`);
      else if (byKey[k].type !== "LAND") console.error(`[stages] ${s.id}: elementAt座標 ${k} がLANDでない`);
    });
    // 全マスが行き先を持ち、城と相互到達可能か
    tiles.forEach(t => {
      if (t.next.length === 0) console.error(`[stages] ${s.id}: マス${t.id}(${t.x},${t.y})に行き先がない`);
      if (t.type === "WARP" && t.warpTo === undefined) console.error(`[stages] ${s.id}: WARP ${t.x},${t.y} に対応先がない`);
      if (t.onewayTo != null && !t.next.includes(t.onewayTo)) console.error(`[stages] ${s.id}: 一方通行マス${t.id}の出口が正規ルート(next)にない`);
    });
    const bfs = (startId, edges) => {
      const seen = new Set([startId]);
      const q = [startId];
      while (q.length) { const v = q.pop(); for (const n of edges(v)) if (!seen.has(n)) { seen.add(n); q.push(n); } }
      return seen;
    };
    const fwd = bfs(0, id => tiles[id].next);
    const rev = bfs(0, id => tiles.filter(t => t.next.includes(id)).map(t => t.id));
    if (fwd.size !== tiles.length) console.error(`[stages] ${s.id}: 城から到達できないマスがある (${fwd.size}/${tiles.length})`);
    if (rev.size !== tiles.length) console.error(`[stages] ${s.id}: 城へ戻れないマスがある (${rev.size}/${tiles.length})`);
    // 関門数と gatesNeeded の整合（"all" は全関門必須なので常に妥当）
    const gateCount = tiles.filter(t => t.type === "GATE").length;
    const gn = s.gatesNeeded ?? 3;
    if (gn === "all") {
      if (gateCount === 0) console.error(`[stages] ${s.id}: gatesNeeded:"all" だが関門が0個`);
    } else if (gn > gateCount) {
      console.error(`[stages] ${s.id}: gatesNeeded(${gn}) > 関門数(${gateCount})`);
    }
  });
}
validateStages();

// ---------- 進行度（localStorage・プレイヤープロファイル別） ----------
const PROGRESS_KEY = "mana-circuit-progress";

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(profileStorageKey(PROGRESS_KEY)));
    if (p && typeof p === "object" && p.cleared) return p;
  } catch (e) { /* 壊れていたら初期化 */ }
  return { cleared: {} };
}

function saveStageClear(stageId) {
  const p = loadProgress();
  p.cleared[stageId] = true;
  try { localStorage.setItem(profileStorageKey(PROGRESS_KEY), JSON.stringify(p)); } catch (e) { /* プライベートモード等 */ }
}

function isStageUnlocked(idx) {
  if (idx === 0) return true;
  return !!loadProgress().cleared[STAGES[idx - 1].id];
}
