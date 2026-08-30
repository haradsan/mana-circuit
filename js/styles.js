// ============================================================
// styles.js — 戦型（アーキタイプ）システム（v33）
// 「相手ごとに戦い方が違う」を作る層。強さ（AI_PROFILES の novice〜demon）とは
// 直交させる: 戦型は好み・優先順位のトレードオフだけを変え、強弱は変えない。
//   STYLES[key].ai   … ai.js の判断に掛かる係数（既定1＝従来挙動）
//   STYLES[key].deck … buildDeck の重み付け・確定投入（sig）・エース（ace）
//   STYLES[key].plan/strong/weak … 出陣確認・口上で「手の内を公開」する文言
// 手の内の公開が対策（カウンターピック）の駆け引きを作る＝弱点は隠さず明示する設計。
// ============================================================
"use strict";

// AI係数の既定値（すべて1/0＝従来と同一の挙動）。styleAI() が返す形。
// invade: 侵略の踏み切りやすさ / march: 侵攻のうまみ閾値 / chain: 連鎖の評価
// level: レベルアップ積極性 / singleLv: 連鎖なし土地の育成上限Lvへの加算
// lap: 分岐選択での関門・城の評価 / settle: 空き地に止まる価値 / tollFear: 敵地通行料の忌避
// defItem: 防衛アイテムの出しやすさ / trap: 伏せ札設置の閾値緩和 / summonBonus: 召喚採点への加点関数
const STYLE_AI_DEFAULT = {
  invade: 1, march: 1, chain: 1, level: 1, singleLv: 0,
  lap: 1, settle: 1, tollFear: 1, defItem: 1, trap: 1, summonBonus: null,
};

// プレイヤーの実効戦型係数（人間・戦型なしCPUは既定値）
function styleAI(p) {
  const prof = (typeof aiProf === "function" && p) ? aiProf(p) : (p && p.aiProfile);
  const st = prof && prof.style;
  return (st && st.ai) || STYLE_AI_DEFAULT;
}

// プレイヤーの戦型定義そのもの（UI用。無ければ null）
function styleOfPlayer(p) {
  const prof = p && p.aiProfile;
  return (prof && prof.style) || null;
}

// ステージの戦型定義（出陣確認用）
function styleOfStage(s) {
  return (s && s.style && STYLES[s.style]) || null;
}

// AIの強さtierの呼び名（出陣確認・口上で「戦型（強さ）」として見せる）
const AI_TIER_LABEL = { novice: "見習い", easy: "駆け出し", normal: "一人前", hard: "強豪", demon: "鬼神" };

// 属性→精霊王（🧚精霊使いの hard 以上が従えるエース。S15の cpuAces と同じカード）
const ELEMENT_KING = { fire: "ignisking", wood: "sylvanking", earth: "terraking", water: "nereusking" };

const STYLES = {
  // ⚔️ 武人: 攻撃的クリーチャー＋武具で序盤から侵略・侵攻。経済は雑。
  brawler: {
    icon: "⚔️", label: "武人",
    plan: "安い駒と武具で、序盤から侵略と侵攻を仕掛ける",
    strong: "侵略バトル・駐留クリーチャーの侵攻・武具の応酬",
    weak: "経済が細く、高Lvの連鎖経済と長期戦に置いていかれる。守りも薄い",
    ai: { invade: 1.4, march: 1.5, chain: 0.85, level: 0.8, lap: 0.9, settle: 0.9, tollFear: 0.8, defItem: 0.9 },
    deck: {
      creatureW: c => ((c.ab || []).some(a => ["assault", "first", "double", "pierce", "weaponlove"].includes(a)) ? 2 : 0)
        + (c.st > c.hp ? 1 : 0),
      spells: new Set(["fx_war", "quake", "grandquake", "meteor", "r_blaze", "snipe", "recruit"]),
      itemW: c => (c.st >= 40 ? 2 : c.st >= 20 ? 1 : 0)
        + ((c.grant || []).some(a => ["assault", "double", "pierce", "weaponlove"].includes(a)) ? 2 : 0),
      sig: () => ["wardrum", "warhammer", "fx_war", "rampagesword"], // v34: 一点突破の大剣も看板に
    },
  },
  // 💰 商人: 連鎖・通行料・施設・不労所得の経済圧殺。戦いは避ける。
  merchant: {
    icon: "💰", label: "商人",
    plan: "連鎖と施設で通行料と不労所得を積み上げ、経済で圧殺する",
    strong: "連鎖の通行料・🏛施設と鉱脈の不労所得・資金力",
    weak: "戦闘力が低い。土地攻めスペルや侵略で経済の芯を崩されると脆い",
    ai: {
      invade: 0.6, march: 0.7, chain: 1.4, level: 1.35, lap: 1.15, settle: 1.3, tollFear: 1.2, defItem: 0.8,
      // 属性の合わないマスには施設や稼ぎ手を置く（施設は素の採点では選ばれない）
      summonBonus: c => (c.structure || (c.ab || []).some(a => ["mine", "merchant", "harbor", "warfire", "festival"].includes(a))) ? 45 : 0,
    },
    deck: {
      creatureW: c => ((c.ab || []).some(a => ["mine", "merchant", "harbor", "warfire", "festival"].includes(a)) ? 3 : 0)
        + (c.cost <= 70 ? 1 : 0),
      spells: new Set(["treasure", "taxcollect", "goldrush", "veinfind", "fx_market", "fx_manastorm", "r_plenty", "r_harvest", "alchemy", "revelation"]),
      itemW: c => (c.drainMagic ? 2 : 0) + (c.escape ? 1 : 0),
      // v34: 招福の宝蔵（黄金竜⇔招き猫）と市場の金庫番（金庫番⇔交易市場）が看板同士で絆を結ぶ
      sig: () => ["trademarket", "miningtower", "lighthouse", "fortunecat", "golddragon", "veinfind", "taxcollect"],
    },
  },
  // 🃏 策士: 罠・妨害・足止めで相手の計画を崩す。地力は低い。
  trickster: {
    icon: "🃏", label: "策士",
    plan: "伏せ札と妨害スペルで、相手の計画を足元から崩す",
    strong: "🃏伏せ札・足止めと妨害スペル・手札攻め",
    weak: "盤面の地力が低く、正面から殴られると脆い。護法や罠外しに空回りする",
    ai: { invade: 0.85, level: 0.95, trap: 1.6, tollFear: 1.1, defItem: 1.1 },
    deck: {
      creatureW: c => ((c.ab || []).some(a => ["capture", "mimic", "escaper", "trapper", "dispel"].includes(a)) ? 2 : 0)
        + ((c.ab || []).includes("first") ? 1 : 0),
      spells: new Set(["trap_pit", "trap_bolt", "trap_ambush", "trap_snatch", "trap_toll", "trap_sleep", "trap_gate",
        "trap_mimic", "trap_poison",
        "nullfog", "silencefog", "gust", "ensnare", "cursedice", "mudswamp", "steal", "whisper", "freeze",
        "trapsweep", "timereverse", "deport"]),
      itemW: c => ((c.trapSynergy || c.stDebuff || c.nullify || c.escape || c.noCrit) ? 2 : 0)
        + ((c.grant || []).includes("capture") ? 2 : 0),
      sig: () => ["trap_snatch", "trap_toll", "nullfog", "trickdagger", "hazecloak", "kagemusha"], // v34: 影武者は強豪の切り札
    },
  },
  // 🏰 城主: 少数の土地を高Lvに固め、防衛アイテムで守り切る。足は遅い。
  warden: {
    icon: "🏰", label: "城主",
    plan: "少数の土地を高レベルの要塞に育て、防具で守り切る",
    strong: "高Lv土地の加護・防衛アイテム・硬い駐留クリーチャー",
    weak: "足が遅く周回や機動力で負ける。要塞を迂回されると収入が伸びない。貫通・魔法攻撃",
    ai: { invade: 0.7, march: 0.6, chain: 1.1, level: 1.5, singleLv: 1, lap: 0.8, settle: 1.1, defItem: 1.5 },
    deck: {
      creatureW: c => ((c.ab || []).some(a => ["immobile", "guard", "armor", "bulwark", "physreflect", "physnull", "capture"].includes(a)) ? 2 : 0)
        + (c.hp >= c.st + 15 ? 1 : 0),
      spells: new Set(["sanctuary", "fortify", "growth", "blessing", "regen", "fx_bud", "r_ages", "miragefield", "r_purify", "repairwall"]),
      itemW: c => (c.hp >= 40 ? 2 : c.hp >= 20 ? 1 : 0)
        + ((c.reflect || (c.grant || []).some(a => ["guard", "armor", "endure"].includes(a))) ? 2 : 0),
      sig: () => ["fortify", "sanctuary", "towershield", "colossus"], // v34: 砦の巨人は鬼神級の看板（コスト上限で自然に出し分け）
    },
  },
  // 💨 疾走: 周回とダイス操作で速攻資産。土地に執着しない。
  runner: {
    icon: "💨", label: "疾走",
    plan: "ダイス操作と機動力で周回ボーナスを稼ぎ、速さで押し切る",
    strong: "周回ボーナス・🎲ダイス操作・テレポートの機動力",
    weak: "土地が育たず、終盤の資産勝負と防衛が薄い。足止め（罠・フリーズ・呪いのダイス）に弱い",
    ai: { invade: 0.9, march: 1.1, chain: 0.8, level: 0.65, lap: 1.7, settle: 0.85, tollFear: 1.3, defItem: 0.8 },
    deck: {
      creatureW: c => ((c.ab || []).some(a => ["fly", "ranged"].includes(a)) ? 2 : 0)
        + (c.cost <= 60 ? 1 : 0),
      spells: new Set(["holyword", "hyperdice", "recall", "teleport", "leap", "transport", "r_time",
        "drawmist", "revelation", "deport", "timereverse", "fx_harvest"]),
      itemW: c => (c.escape ? 1 : 0),
      sig: () => ["hyperdice", "holyword", "recall", "pegasus", "unicorn", "shinobi"], // v34: 疾風の忍が加勢
    },
  },
  // 🧚 精霊使い: 単属性に染めた連鎖と土地の加護。相性の輪の天敵が明確な弱点。
  spirit: {
    icon: "🧚", label: "精霊使い",
    plan: "ひとつの属性に染めた連鎖と土地の加護で、精霊の力を束ねる",
    strong: "単属性の連鎖・属性一致の土地の加護・🐺群れ",
    weak: "相性の輪の天敵属性（受けの悪い属性）と貫通に弱い。単色ゆえ対策されやすい",
    ai: { chain: 1.35, level: 1.15, settle: 1.2 },
    deck: {
      counts: [9, 3, 3, 3], // 主属性に寄せた単色デッキ（既定は 6/6/3/3）
      creatureW: null, // biasは counts で強制済み。群れ持ちを好む（下の creatureWB で bias を参照）
      creatureWB: (c, bias) => (bias && c.element === bias ? 2 : 0) + ((c.ab || []).includes("pack") ? 1 : 0),
      spells: new Set(["eleshift", "growth", "blessing", "fx_goddess", "resonancecall", "r_ages", "regen", "fx_bud", "recruit"]),
      itemW: c => (c.id === "elementalorb" ? 1 : 0),
      sig: bias => ["eleshift", "fx_goddess"].concat(
        bias ? [{ fire: "blessfire", wood: "blesswood", earth: "blessearth", water: "blesswater" }[bias] || null].filter(Boolean) : []),
      // hard以上（deckMaxCost>=150）は主属性の精霊王を1体従える（コスト上限の外＝エース枠）
      ace: bias => (bias && ELEMENT_KING[bias]) ? [ELEMENT_KING[bias]] : [],
    },
  },
};

// 係数の欠けを既定値で補完（styleAI が常に全キーを返せるように）
Object.keys(STYLES).forEach(k => { STYLES[k].key = k; STYLES[k].ai = { ...STYLE_AI_DEFAULT, ...STYLES[k].ai }; });

// 読み込み時の検証（BOND_DEFS と同方式）: sig/ace/spells のid誤り・noCpu混入をコンソールへ
function validateStyles() {
  if (typeof CARD_BY_ID === "undefined") return;
  Object.values(STYLES).forEach(st => {
    const d = st.deck || {};
    const ids = [];
    ["fire", "wood", "earth", "water", null].forEach(b => {
      if (d.sig) ids.push(...d.sig(b));
      if (d.ace) ids.push(...d.ace(b));
    });
    (d.spells || []).forEach(id => ids.push(id));
    ids.forEach(id => {
      const c = CARD_BY_ID[id];
      if (!c) console.error(`[styles] ${st.label}: 未知のカードid "${id}"`);
      else if (c.noCpu) console.error(`[styles] ${st.label}: noCpuカード "${id}" はCPUデッキで腐る`);
    });
  });
}
validateStyles(); // 読み込み時に検査（index.html で cards.js の直後に読み込む前提）
