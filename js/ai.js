// ============================================================
// ai.js — CPUの意思決定（ヒューリスティック）
// 人間と同じアクション関数に渡す「選択」だけを返す
// ============================================================
"use strict";

// 難易度プロファイル（相手ごとに段階的に強くなるよう設計）。ステージの stage.ai がこのどれかを指す。
// reserve: 手元に残す魔力（大きいほど消極的で開発が遅い） / invadeRatio: 侵略に踏み切る損益比（小さいほど好戦的）
// levelSingle: 連鎖なし土地を育てる上限Lv / useDefItems: 防衛アイテムを使うか
// deckMaxCost: CPUの自動デッキに入るカードのコスト上限（弱い相手ほど低コスト＝弱いカードしか持たない）
// hesitateProb: 勝てる侵略でも見送る確率（弱い相手ほど「勝てる戦い」を逃す＝冷徹さを緩和）
// magicBonus: CPUの初期魔力補正（相手ごとの資金力＝強さの違いを明確にする。弱い相手は貧しく、強敵は潤沢）
const AI_PROFILES = {
  // 見習い（第1ステージ）: とても消極的・開発も遅く、手札は低コスト（弱いカード）中心。初心者でも勝てる強さ。
  novice: { reserve: 280, invadeRatio: 2.6,  levelSingle: 1, useDefItems: false, deckMaxCost: 70,  hesitateProb: 0.5,  magicBonus: -90 },
  easy:   { reserve: 190, invadeRatio: 1.9,  levelSingle: 2, useDefItems: false, deckMaxCost: 95,  hesitateProb: 0.28, magicBonus: -40 },
  normal: { reserve: 120, invadeRatio: 1.2,  levelSingle: 3, useDefItems: true,  deckMaxCost: 125, hesitateProb: 0.1,  magicBonus: 0 },
  hard:   { reserve: 60,  invadeRatio: 0.85, levelSingle: 3, useDefItems: true,  deckMaxCost: 150, hesitateProb: 0,    magicBonus: 130 },
  demon:  { reserve: 40,  invadeRatio: 0.7,  levelSingle: 4, useDefItems: true,  deckMaxCost: 999, hesitateProb: 0,    magicBonus: 280 },
};
let AI_PROFILE = AI_PROFILES.normal;

// プレイヤー個人の実効プロファイル。三つ巴ではCPUごとに異なる（newGame の mkCpu がセット）。
// 未設定なら従来どおりグローバルの AI_PROFILE（ステージ既定 × 全体難易度）を使う
function aiProf(p) { return (p && p.aiProfile) || AI_PROFILE; }

// 相手全員（三つ巴では2人）が1〜6マス以内に踏み得るマスidの集合（防衛系スペルの判断用）。
// v24: 通常移動は順方向のみに戻ったため、逆走側（backstepDests）の警戒は外した
// （逆走は🔄時流逆転・🎰時空の渦のときだけ＝稀なので前方だけ警戒する）
function aiNearTilesOfOpponents(g, p) {
  const near = new Set();
  opponentsOf(g, p).forEach(q => {
    for (let n = 1; n <= 6; n++) near.add(walkAhead(g, q.pos, n).id);
  });
  return near;
}

// ---------- ゲーム難易度（イージー / ノーマル / ハード） ----------
// 各ステージ固有のプロファイル（相手ごとの違い）に、プレイヤーが選ぶ全体難易度の補正を掛け合わせる。
// ＝「相手ごとの強さの違い」と「全体の手ごたえ」を独立に調整できる（req11）。
const DIFFICULTY_KEY = "mana-circuit-difficulty";
const DIFFICULTIES = {
  easy:   { label: "イージー", icon: "🟢", desc: "CPUは開発も侵略も控えめで弱いデッキ・資金も少なめ。じっくり攻めれば勝てる",
            reserveMul: 1.5, invadeRatioMul: 1.4, deckMaxCostMul: 0.8, hesitateAdd: 0.2,  levelSingleAdd: -1, magicAdd: -140 },
  normal: { label: "ノーマル", icon: "🟡", desc: "標準の手ごたえ。相手ごとの強さの違いをそのまま味わえる",
            reserveMul: 1,   invadeRatioMul: 1,   deckMaxCostMul: 1,   hesitateAdd: 0,    levelSingleAdd: 0,  magicAdd: 0 },
  hard:   { label: "ハード",   icon: "🔴", desc: "CPUは積極的に侵略・開発し、強いデッキと潤沢な資金を持つ。隙を突かないと厳しい",
            reserveMul: 0.6, invadeRatioMul: 0.78, deckMaxCostMul: 1.25, hesitateAdd: -1,  levelSingleAdd: 1,  magicAdd: 220 },
};
function loadDifficulty() {
  try { const d = localStorage.getItem(DIFFICULTY_KEY); if (DIFFICULTIES[d]) return d; } catch (e) { /* private mode */ }
  return "normal";
}
function saveDifficulty(d) { if (DIFFICULTIES[d]) { try { localStorage.setItem(DIFFICULTY_KEY, d); } catch (e) {} } }

// ステージのAIプロファイル × 全体難易度 → 実効プロファイル（reserve/invadeRatio/deckMaxCost/hesitate/magicBonus）
function resolveAIProfile(stageAiKey) {
  const base = AI_PROFILES[stageAiKey] || AI_PROFILES.normal;
  const d = DIFFICULTIES[loadDifficulty()] || DIFFICULTIES.normal;
  return {
    reserve: Math.max(0, Math.round(base.reserve * d.reserveMul)),
    invadeRatio: +(base.invadeRatio * d.invadeRatioMul).toFixed(2),
    levelSingle: Math.max(1, base.levelSingle + d.levelSingleAdd),
    useDefItems: base.useDefItems || loadDifficulty() === "hard",
    deckMaxCost: base.deckMaxCost >= 999 ? 999 : Math.round(base.deckMaxCost * d.deckMaxCostMul),
    hesitateProb: Math.max(0, Math.min(0.7, base.hesitateProb + d.hesitateAdd)),
    magicBonus: (base.magicBonus || 0) + d.magicAdd,
  };
}

function aiHandCards(p) { return p.hand.map(id => CARD_BY_ID[id]); }

// --- ターン開始時のスペル選択。使うカードidを返す（使わないなら null） ---
function aiChooseSpell(g, p) {
  const opp = opponentOf(g, p); // 筆頭の相手（総資産トップ）。三つ巴では最も勝ちに近い相手を警戒する
  for (const id of p.hand) {
    const c = CARD_BY_ID[id];
    if (c.type !== "spell" || c.cost > p.magic - aiProf(p).reserve) continue;
    if (c.spell === "recall" && p.pos !== 0 && assetsOf(g, p) - c.cost >= RULES.target) return id;
    // 大きく劣勢で関門が規定数揃っているなら、リコールで即周回（劣勢1.5倍ボーナス＋全回復）して立て直す
    if (c.spell === "recall" && p.pos !== 0 && p.gates.size >= gatesNeededOf(g) &&
        assetsOf(g, p) < assetsOf(g, opp) * COMEBACK_RATIO) return id;
    if (c.spell === "revenge" && assetsOf(g, opp) - assetsOf(g, p) >= 600 && opp.magic >= 150) return id;
    if (c.spell === "drain" && richestOpponent(g, p).magic >= 150) return id;
    if (c.spell === "plunder" && richestOpponent(g, p).magic >= 260) return id; // 相手が富んでいる時ほど半額奪取が刺さる
    if (c.spell === "dicedouble" && aiWantDiceDouble(g, p)) return id;
    if (c.spell === "vanish" && aiPickVanishTarget(g, p)) return id;
    if (c.spell === "gust" && aiPickGustTarget(g, p)) return id;
    if (c.spell === "teleport" && aiPickTeleportTarget(g, p)) return id;
    if (c.spell === "transport" && aiPickTransportTarget(g, p)) return id;
    if (c.spell === "leap" && aiPickLeapTarget(g, p)) return id;
    if (c.spell === "quake" && enemyLandsOf(g, p).some(t => t.level >= 3)) return id;
    if (c.spell === "growth" && aiPickGrowthTarget(g, p)) return id;
    if (c.spell === "eleshift" && aiPickShiftTarget(g, p)) return id;
    if (c.spell === "sanctuary" && aiPickSanctuaryTarget(g, p)) return id;
    if (c.spell === "ensnare" && aiPickEnsnareTarget(g, p)) return id;
    if (c.spell === "regen" && aiWantRegen(g, p)) return id;
    if (c.spell === "meteor" && aiPickMeteorTarget(g, p)) return id;
    if (c.spell === "freeze" && aiPickFreezeTarget(g, p)) return id;
    if (c.spell === "treasure" && ownedLands(g, p.id).length >= 3) return id;
    if (c.spell === "steal" && aiPickStealTarget(g, p)) return id;
    if (c.spell === "salvage" && aiPickSalvage(g, p)) return id;
    if (c.spell === "alchemy" && aiPickAlchemy(g, p, id)) return id;
    if (c.spell === "renew" && aiWantRenew(g, p)) return id;
    if (c.spell === "draw" && p.hand.length <= 3) return id;
    if (c.spell === "holyword") {
      const n = aiPickHolywordDice(g, p, c.cost);
      if (n) { p.aiHolyword = n; return id; }
    }
    // ---------- 第二弾スペル（v20） ----------
    if (c.spell === "elembless" && ownedLands(g, p.id).filter(t => t.element === c.elem).length >= 2) return id;
    if (c.spell === "goldrush" && p.magic >= 500) return id;
    if (c.spell === "taxcollect" && opponentsOf(g, p).reduce((s, q) => s + ownedLands(g, q.id).length, 0) >= 4) return id;
    if (c.spell === "revelation" && p.hand.length <= 5) return id;
    if (c.spell === "inspiration" && p.hand.length <= 3) return id;
    if (c.spell === "gravecall" && p.discard.length >= 2 && aiHandCards(p).filter(x => x.type === "creature").length <= 1) return id;
    if (c.spell === "deport" && aiPickDeportTarget(g, p)) return id;
    if (c.spell === "reverse" && aiPickReverseTarget(g, p)) return id;
    if (c.spell === "duplicate" && aiPickDuplicateTarget(g, p)) return id;
    if ((c.spell === "cursedice" || c.spell === "mudswamp") && aiPickSlowTarget(g, p)) return id;
    if (c.spell === "whisper" && aiPickStealTarget(g, p)) return id;
    if (c.spell === "manaburn" && richestOpponent(g, p).magic >= 450) return id;
    if (c.spell === "nullfog" && aiPickNullfogTarget(g, p)) return id;
    if (c.spell === "silencefog" && aiPickSilenceTarget(g, p)) return id;
    if (c.spell === "truce" && assetsOf(g, p) - assetsOf(g, opp) >= 600 && ownedLands(g, p.id).length >= 3) return id;
    if (c.spell === "freezerain" && opponentsOf(g, p).filter(q => !q.skipTurn &&
        assetsOf(g, q) >= RULES.target * 0.75).length >= Math.min(2, opponentsOf(g, p).length)) return id;
    if (c.spell === "miragefield" && ownedLands(g, p.id).filter(t => landValue(t) >= 480).length >= 2) return id;
    if (c.spell === "curseland" && aiPickCurselandTarget(g, p)) return id;
    if (c.spell === "veinfind" && g.round <= RULES.maxRounds / 2 && aiPickVeinTarget(g, p)) return id;
    if (c.spell === "fortify" && aiPickFortifyTarget(g, p)) return id;
    if (c.spell === "blessing" && aiPickBlessingTarget(g, p)) return id;
    if (c.spell === "grandquake" && aiPickGrandquakeTargets(g, p)) return id;
    // 儀式は「捧げる手札」が別に要る（このカード＋1枚）
    if (c.spell === "r_harvest" && p.hand.length >= 3 && p.magic < 300) return id;
    if (c.spell === "r_blaze" && p.hand.length >= 2 && aiPickBlazeTarget(g, p)) return id;
    if (c.spell === "r_revive" && p.hand.length >= 2 && aiPickReviveTarget(g, p)) return id;
    if (c.spell === "r_ages" && p.hand.length >= 2 && aiPickAgesTarget(g, p)) return id;
    if (c.spell === "r_storm" && p.hand.length >= 2 && enemyLandsOf(g, p).filter(t =>
        t.creature && currentHp(t.creature) <= 25 && !isSanctuaryProtected(g, t) && !isSpellProof(t)).length >= 2) return id;
    if (c.spell === "r_time" && p.hand.length >= 2 && assetsOf(g, p) >= RULES.target && p.pos !== 0) return id;
    if (c.spell === "r_purify" && p.hand.length >= 2 &&
        ownedLands(g, p.id).filter(t => t.creature && isWounded(t.creature)).length >= 2) return id;
    if (c.spell === "fx_market" && p.hand.length <= 2) return id;
    if (c.spell === "fx_bud" && ownedLands(g, p.id).filter(t => t.creature && isWounded(t.creature)).length >= 2) return id;
    if (c.spell === "fx_war" && assetsOf(g, p) < assetsOf(g, opp) &&
        aiHandCards(p).filter(x => x.type === "creature").length >= 3) return id;
    if (c.spell === "fx_manastorm" && ownedLands(g, p.id).length >= ownedLands(g, opp.id).length + 2) return id;
    if (c.spell === "fx_silence" && assetsOf(g, p) >= RULES.target) return id;
    if (c.spell === "fx_goddess" && ownedLands(g, p.id).filter(t =>
        t.creature && CARD_BY_ID[t.creature.cardId].element === t.element).length >= 2) return id;
  }
  return null;
}

// ---------- 第二弾スペルのターゲット選択（v20） ----------
// 儀式の捧げ物: 使い道の薄い最安カード（クリーチャーは2枚まで温存）
function aiPickSacrifice(g, p, selfId) {
  const idx = p.hand.indexOf(selfId);
  const pool = p.hand.slice(0, idx).concat(p.hand.slice(idx + 1)).map(id => CARD_BY_ID[id]);
  if (pool.length === 0) return null;
  const creatures = pool.filter(c => c.type === "creature");
  const cands = (creatures.length <= 2) ? pool.filter(c => c.type !== "creature") : pool;
  const sorted = (cands.length ? cands : pool).slice().sort((a, b) => a.cost - b.cost);
  return sorted[0].id;
}
// 強制送還: 凱旋間際（目標到達・城以外）の相手を押し戻す
function aiPickDeportTarget(g, p) {
  const cands = opponentsOf(g, p).filter(q => q.pos !== 0 && assetsOf(g, q) >= RULES.target);
  if (cands.length === 0) return null;
  cands.sort((a, b) => assetsOf(g, b) - assetsOf(g, a));
  return cands[0];
}
// 🔄 時流逆転（v24）: 相手の「反転後の進路」に自分の高額地が並ぶとき、反転させて通行料地帯へ押し返す。
// 進路は各プレイヤーの向き（cameFrom）から moveOptions の既定候補で近似する
function aiPickReverseTarget(g, p) {
  // fromId を背後として既定ルートで n マス歩いたときに踏むタイル列
  const walkTiles = (pos, fromId, n) => {
    const out = [];
    let prev = fromId, cur = pos;
    for (let i = 0; i < n; i++) {
      const nxt = moveOptions(g, g.tiles[cur], prev)[0];
      if (!nxt) break;
      prev = cur; cur = nxt.id;
      out.push(g.tiles[cur]);
    }
    return out;
  };
  const myTollOn = tiles => tiles.reduce((s, t) =>
    s + (t.type === "LAND" && t.owner === p.id && t.creature ? tollOf(g, t) : 0), 0);
  let best = null, bestGain = 0;
  for (const q of opponentsOf(g, p)) {
    if (q.skipTurn) continue;
    const fwd = moveOptions(g, g.tiles[q.pos], q.cameFrom ?? null)[0];
    if (!fwd) continue;
    const ahead = walkTiles(q.pos, q.cameFrom ?? null, 6); // 今の進路
    const back = walkTiles(q.pos, fwd.id, 6);              // 反転後の進路（前方を背後にして歩く）
    const gain = myTollOn(back) - myTollOn(ahead);
    if (gain > bestGain) { bestGain = gain; best = q; }
  }
  return bestGain >= 150 ? best : null; // 反転で自領の高額地帯へ押し返せる時だけ使う
}
// 🧪 増殖の秘薬（v24）: 手札が細いとき、場の主力（85G以上。🐺群れ持ちは優先）を複製して厚みを増す
function aiPickDuplicateTarget(g, p) {
  if (p.hand.length > 4) return null;
  const score = t => {
    const c = CARD_BY_ID[t.creature.cardId];
    return c.cost + (c.ab.includes("pack") ? 40 : 0) + (c.ab.includes("split") ? 40 : 0);
  };
  const cands = ownedLands(g, p.id).filter(t => t.creature).sort((a, b) => score(b) - score(a));
  if (cands.length === 0) return null;
  return CARD_BY_ID[cands[0].creature.cardId].cost >= 85 || score(cands[0]) >= 100 ? cands[0] : null;
}
// 呪いのダイス/泥沼: 勝ちに近い相手の歩みを鈍らせる
function aiPickSlowTarget(g, p) {
  const cands = opponentsOf(g, p).filter(q => q.pos !== 0 && assetsOf(g, q) >= RULES.target * 0.85);
  if (cands.length === 0) return null;
  cands.sort((a, b) => assetsOf(g, b) - assetsOf(g, a));
  return cands[0];
}
// 沈黙の霧: 勝ちに近い相手のスペル（リコール等）を封じる
function aiPickSilenceTarget(g, p) {
  const cands = opponentsOf(g, p).filter(q => assetsOf(g, q) >= RULES.target * 0.85);
  if (cands.length === 0) return null;
  cands.sort((a, b) => assetsOf(g, b) - assetsOf(g, a));
  return cands[0];
}
// 無力化の霧: 能力2つ以上の高額地の敵クリーチャーを丸裸に
function aiPickNullfogTarget(g, p) {
  const cands = enemyLandsOf(g, p).filter(t => t.creature && !isSanctuaryProtected(g, t) &&
    !isSpellProof(t) && !creatureNulled(g, t.creature) &&
    CARD_BY_ID[t.creature.cardId].ab.length >= 2 && landValue(t) >= 480);
  if (cands.length === 0) return null;
  cands.sort((a, b) => landValue(b) - landValue(a));
  return cands[0];
}
// カースランド: 高額な敵地の通行料を半減
function aiPickCurselandTarget(g, p) {
  const cands = enemyLandsOf(g, p).filter(t => !landSpellShielded(g, t) && !landCursed(g, t) && tollOf(g, t) >= 250);
  if (cands.length === 0) return null;
  cands.sort((a, b) => tollOf(g, b) - tollOf(g, a));
  return cands[0];
}
// 城塞化: 相手の進路上にある属性一致・高Lvの自領を鉄壁に
function aiPickFortifyTarget(g, p) {
  const near = aiNearTilesOfOpponents(g, p);
  const cands = ownedLands(g, p.id).filter(t => !t.fortified && t.level >= 3 &&
    t.creature && CARD_BY_ID[t.creature.cardId].element === t.element && near.has(t.id));
  if (cands.length === 0) return null;
  cands.sort((a, b) => landValue(b) - landValue(a));
  return cands[0];
}
// 鉱脈発見: 最も価値の高い自領に（長期の収入源）
function aiPickVeinTarget(g, p) {
  const cands = ownedLands(g, p.id).filter(t => t.veinOwner === undefined || t.veinOwner === null);
  if (cands.length === 0) return null;
  cands.sort((a, b) => landValue(b) - landValue(a));
  return cands[0];
}
// ブレッシング: 高Lv地の主力を永続強化
function aiPickBlessingTarget(g, p) {
  const cands = ownedLands(g, p.id).filter(t => t.creature && (t.creature.grown || 0) < 4 && t.level >= 3);
  if (cands.length === 0) return null;
  cands.sort((a, b) => landValue(b) - landValue(a));
  return cands[0];
}
// グランドクエイク: Lv3以上の敵地が2つあるときだけ撃つ（高いほうから2つ）
function aiPickGrandquakeTargets(g, p) {
  const cands = enemyLandsOf(g, p).filter(t => t.level >= 3 && !landSpellShielded(g, t));
  if (cands.length < 2) return null;
  cands.sort((a, b) => b.level - a.level || landValue(b) - landValue(a));
  return cands.slice(0, 2);
}
// 猛火の儀: 70ダメージで倒せる高額地の敵を焼く
function aiPickBlazeTarget(g, p) {
  const cands = enemyLandsOf(g, p).filter(t => t.creature && !isSanctuaryProtected(g, t) &&
    !isSpellProof(t) && currentHp(t.creature) <= 70 && landValue(t) >= 480);
  if (cands.length === 0) return null;
  cands.sort((a, b) => landValue(b) - landValue(a));
  return cands[0];
}
// 蘇生の儀: 捨て札の強クリーチャーを連鎖の伸びる空き地へ
function aiPickReviveTarget(g, p) {
  const creatures = [...new Set(p.discard)].map(id => CARD_BY_ID[id])
    .filter(c => c.type === "creature" && c.st + c.hp >= 100);
  if (creatures.length === 0) return null;
  creatures.sort((a, b) => (b.st + b.hp) - (a.st + a.hp));
  const empties = g.tiles.filter(t => t.type === "LAND" && t.owner === null);
  if (empties.length === 0) return null;
  empties.sort((a, b) =>
    (landValue(b) + chainCount(g, p.id, b.element) * 40) -
    (landValue(a) + chainCount(g, p.id, a.element) * 40));
  return { cardId: creatures[0].id, tile: empties[0] };
}
// 星霜の儀: 連鎖2以上の低Lv地を一気に育てる
function aiPickAgesTarget(g, p) {
  const cands = ownedLands(g, p.id).filter(t => t.level <= 2 && chainCount(g, p.id, t.element) >= 2);
  if (cands.length === 0) return null;
  cands.sort((a, b) => chainCount(g, p.id, b.element) - chainCount(g, p.id, a.element));
  return cands[0];
}

// ホーリーワードで狙う価値のある目（1〜6）を探す。なければ null
// 「連鎖が伸びる空き地」に一致属性クリーチャーを置ける場合のみ使う
function aiPickHolywordDice(g, p, spellCost) {
  const budget = p.magic - spellCost - aiProf(p).reserve;
  for (let n = 1; n <= 6; n++) {
    const t = walkAhead(g, p.pos, n); // 分岐は既定ルートで近似
    if (t.type !== "LAND" || t.owner !== null) continue;
    if (chainCount(g, p.id, t.element) < 1) continue;
    const hasMatch = aiHandCards(p).some(c =>
      c.type === "creature" && c.element === t.element && c.cost <= budget);
    if (hasMatch) return n;
  }
  return null;
}

// --- 手札上限超過時に捨てるカード ---
function aiChooseDiscard(g, p) {
  const cards = aiHandCards(p);
  // 使い道の薄い順: holyword > （クリーチャーを温存しつつ）最安カード
  const hw = cards.find(c => c.spell === "holyword");
  if (hw) return hw.id;
  // クリーチャーが残り2枚以下なら土地を取れなくなるので、スペル/アイテムから捨てる
  const creatures = cards.filter(c => c.type === "creature");
  const pool = (creatures.length <= 2) ? cards.filter(c => c.type !== "creature") : cards;
  const sorted = (pool.length ? pool : cards).slice().sort((a, b) => a.cost - b.cost);
  return sorted[0].id;
}

// --- 空き地: 召喚するクリーチャーを選ぶ（しないなら null） ---
function aiChooseSummon(g, p, tile) {
  const budget = p.magic - aiProf(p).reserve;
  const candidates = aiHandCards(p).filter(c => c.type === "creature" && c.cost <= budget);
  if (candidates.length === 0) return null;
  // 属性一致 > 連鎖が伸びる属性 > 安い、で採点
  const score = c => {
    let s = 0;
    if (c.element === tile.element) s += 100 + chainCount(g, p.id, tile.element) * 30;
    s += (c.st + c.hp) / 10;
    s -= c.cost / 10;
    return s;
  };
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0].id;
}

// --- 敵地: 侵略するか。侵略するなら {cardId, itemId|null}、通行料払いなら null ---
function aiChooseInvade(g, p, tile) {
  const toll = tollOf(g, tile);
  const budget = p.magic - 50;
  // 不動クリーチャーは侵略に出せない
  const creatures = aiHandCards(p).filter(c => c.type === "creature" && !c.ab.includes("immobile") && c.cost <= budget);
  const items = aiHandCards(p).filter(c => c.type === "item");
  const combos = [];
  const bopts = { g, attackerId: p.id }; // 群れ（pack）の集計に侵略側プレイヤーを渡す（v19）
  for (const c of creatures) {
    if (resolveBattle(c, tile, null, null, bopts).attackerWins) {
      combos.push({ cardId: c.id, itemId: null, cost: c.cost });
    } else {
      for (const it of items) {
        if (it.escape) continue; // 💨煙玉は防衛側専用（v19）
        if (c.cost + it.cost <= budget && resolveBattle(c, tile, it, null, bopts).attackerWins) {
          combos.push({ cardId: c.id, itemId: it.id, cost: c.cost + it.cost });
        }
      }
    }
  }
  if (combos.length === 0) return null;
  combos.sort((a, b) => a.cost - b.cost);
  const best = combos[0];
  const gain = landValue(tile) + toll; // 奪う価値 + 払わずに済む通行料
  if (gain > best.cost * aiProf(p).invadeRatio) {
    // 弱い相手は「勝てる戦い」でも一定確率で見送る（＝冷徹に最善手を取り続けない）
    if (aiProf(p).hesitateProb && Math.random() < aiProf(p).hesitateProb) return null;
    return best;
  }
  return null;
}

// --- 防衛時: アイテムを使うか。使うならカードid、使わないなら null ---
function aiChooseDefenseItem(g, defender, tile, attCard, attItem) {
  if (!aiProf(defender).useDefItems) return null;
  const bopts = { g, attackerId: g.current }; // 侵略は手番プレイヤーが行う（群れの集計用・v19）
  const noItem = resolveBattle(attCard, tile, attItem, null, bopts);
  if (!noItem.attackerWins) return null; // 素で守れるなら温存
  const items = aiHandCards(defender).filter(c => c.type === "item" && c.cost <= defender.magic - 50);
  const savers = items.filter(it => !it.escape && !resolveBattle(attCard, tile, attItem, it, bopts).attackerWins);
  if (savers.length > 0) {
    savers.sort((a, b) => a.cost - b.cost);
    // 守る価値がある土地か（アイテム代 < 土地価値）
    if (savers[0].cost < landValue(tile)) return savers[0].id;
    return null;
  }
  // 💨煙玉（v19）: どうやっても守れないとき、高価なクリーチャーなら土地を明け渡して手札へ退避させる
  const smoke = items.find(c => c.escape);
  const defCard = CARD_BY_ID[tile.creature.cardId];
  if (smoke && defCard.cost >= 80 && !defCard.structure) return smoke.id;
  return null;
}

// --- 自分の土地: クリーチャー交代 or レベルアップ or 駐留クリーチャーの侵攻 or 何もしない ---
// 返り値: { action: "swap", cardId } / { action: "up" } / { action: "march", dst } / null
function aiOwnLand(g, p, tile) {
  const cur = CARD_BY_ID[tile.creature.cardId];
  // 属性不一致なら、一致するクリーチャーへの交代を検討（土地の加護で守りが固くなる）
  if (cur.element !== tile.element) {
    const budget = p.magic - aiProf(p).reserve;
    const cands = aiHandCards(p).filter(c =>
      c.type === "creature" && c.element === tile.element && c.cost <= budget &&
      c.st + c.hp >= cur.st + cur.hp - 10);
    if (cands.length > 0) {
      cands.sort((a, b) => (b.hp - a.hp) || (a.cost - b.cost));
      return { action: "swap", cardId: cands[0].id };
    }
  }
  if (aiChooseLevelUp(g, p, tile)) return { action: "up" };
  // 到達した自領の駐留クリーチャーをそのまま隣へ侵攻させる価値があるか（①でも命令できる）
  const march = aiMarchFromTile(g, p, tile);
  if (march) return { action: "march", dst: march.dst };
  return null;
}

// ①到達マス: 停止した自領の駐留クリーチャーを隣へ侵攻させる価値があるか。
// aiChooseMarch（②通過アクション）と同じ採点を、単一の出撃元に適用する。
// 返り値: { dst } または null
function aiMarchFromTile(g, p, src) {
  if (!src.creature || truceActive(g)) return null; // 🏳️停戦協定（v20）: 侵攻不可

  const card = CARD_BY_ID[src.creature.cardId];
  if (card.ab.includes("immobile")) return null;
  const cost = marchCost(card);
  if (p.magic - aiProf(p).reserve < cost) return null;
  let best = null, bestScore = 40; // 最低限のうまみが無ければ動かさない
  for (const dst of marchTargets(g, p, src)) {
    let score = -cost;
    if (dst.owner === null) {
      score += landValue(dst) - landValue(src)
        + (chainCount(g, p.id, dst.element) - (chainCount(g, p.id, src.element) - 1)) * 40;
      if (card.element === dst.element && card.element !== src.element) score += 30;
    } else {
      if (!resolveBattle(card, dst, null, null, {
        g, attackerId: p.id, attSrcId: src.id,
        attGrown: card.ab.includes("grow") ? Math.min(5, src.creature.grown || 0) : 0,
      }).attackerWins) continue;
      score += landValue(dst) + tollOf(g, dst) * 0.5 - landValue(src) * 0.3;
    }
    if (score > bestScore) { bestScore = score; best = { dst }; }
  }
  return best;
}

// --- 自分の土地: レベルアップするか ---
function aiChooseLevelUp(g, p, tile) {
  const cost = levelUpCost(tile);
  if (!isFinite(cost) || cost > p.magic - aiProf(p).reserve * 2) return false;
  const chain = chainCount(g, p.id, tile.element);
  // 連鎖のある土地を優先的に伸ばす。単発土地もある程度は投資する
  if (chain >= 2) return true;
  return tile.level < aiProf(p).levelSingle && p.magic > cost + 300;
}

// --- 進む方向の選択（v24: 方向つき移動＝分岐でのみ呼ばれる）: moveOptions の候補ごとに「既定ルート近似」で
//     stepsLeft 先まで歩いて評価し、最も実りのある方向のタイルidを返す ---
function aiChooseDirection(g, p, tile, stepsLeft, prevId = null) {
  const opts = moveOptions(g, tile, prevId);
  let best = opts[0].id, bestScore = -Infinity;
  for (const nb of opts) {
    let score = Math.random() * 20; // 同点時のゆらぎ
    let prev = tile.id, cur = nb.id;
    for (let s = 0; s < stepsLeft; s++) {
      const t = g.tiles[cur];
      if (t.type === "GATE" && !p.gates.has(t.id)) score += RULES.gateBonus * 0.5;
      if (t.type === "CASTLE") {
        if (assetsOf(g, p) >= RULES.target) score += 5000;         // 勝ちに行く
        else if (p.gates.size >= gatesNeededOf(g)) score += 150;   // 周回ボーナス
      }
      if (s === stepsLeft - 1) score += aiLandingScore(g, p, t);
      else {
        const nxt = moveOptions(g, t, prev)[0]; // 途中の分岐は既定候補で近似
        prev = t.id;
        cur = nxt.id;
      }
    }
    if (score > bestScore) { bestScore = score; best = nb.id; }
  }
  return best;
}

// 止まるマスの評価
function aiLandingScore(g, p, t) {
  switch (t.type) {
    case "MAGIC": return RULES.magicTileG * 0.6;
    case "CARD":  return 40;
    case "MAGMA": return -RULES.magmaLoss;
    case "BOOST": return 20;
    case "FORTUNE": return 70;  // 期待値プラスのくじ引き
    case "SPRING": {
      // 負傷クリーチャーがいるほど泉の価値が上がる
      const wounded = g.tiles.filter(t => t.type === "LAND" && t.owner === p.id && t.creature && isWounded(t.creature)).length;
      return 30 + wounded * 25;
    }
    case "LAND":
      if (t.owner === null) return 60 + chainCount(g, p.id, t.element) * 30;
      if (t.owner === p.id) return 30;
      return -tollOf(g, t) * 0.8;
    default: return 0;
  }
}

// ---------- スペルのターゲット選択ヘルパー ----------
function aiPickQuakeTarget(g, p) {
  const lands = enemyLandsOf(g, p).filter(t => t.level > 1 && !landSpellShielded(g, t));
  if (lands.length === 0) return null;
  lands.sort((a, b) => b.level - a.level);
  return lands[0];
}

// バニッシュ: 敵の最も価値の高い（＝主力の）土地のクリーチャーを無条件で消滅させる（HP不問）。
// レジェンド級の確定除去なので、相手の要となる高額地・連鎖地に温存して撃つ。
function aiPickVanishTarget(g, p) {
  const lands = enemyLandsOf(g, p).filter(t =>
    t.creature && landValue(t) >= 480 && !isSanctuaryProtected(g, t) && !isSpellProof(t));
  if (lands.length === 0) return null;
  lands.sort((a, b) =>
    (landValue(b) + chainCount(g, b.owner, b.element) * 200) -
    (landValue(a) + chainCount(g, a.owner, a.element) * 200));
  return lands[0];
}

// ガスト（強制移動）: 敵の連鎖地・高額地のクリーチャーを、隣接する最も安い空き地へ押し出して連鎖・防衛を崩す
// 返り値: { src, dst } または null
function aiPickGustTarget(g, p) {
  let best = null, bestScore = 60; // 最低限のうまみが無ければ撃たない
  for (const src of enemyLandsOf(g, p)) {
    if (!src.creature || isSanctuaryProtected(g, src) || isSpellProof(src)) continue;
    if (CARD_BY_ID[src.creature.cardId].ab.includes("immobile")) continue;
    const dests = gustDests(g, src);
    if (dests.length === 0) continue;
    dests.sort((a, b) => landValue(a) - landValue(b)); // 相手の得を最小化＝最も安い空き地へ
    const dst = dests[0];
    const chain = chainCount(g, src.owner, src.element);
    const score = landValue(src) * 0.4 + (chain >= 2 ? chain * 120 : 0) - landValue(dst) * 0.3;
    if (score > bestScore) { bestScore = score; best = { src, dst }; }
  }
  return best;
}

// テレポート（v17）: 進路上（1〜6マス先）に高額な敵地が待ち構えているとき、
// 実りの多い位置（着地評価の平均が高く・未通過の関門に近い）へ跳んで危険を回避する
function aiPickTeleportTarget(g, p) {
  let danger = 0;
  for (let n = 1; n <= 6; n++) {
    const t = walkAhead(g, p.pos, n);
    if (t.type === "LAND" && t.owner !== null && t.owner !== p.id) danger = Math.max(danger, tollOf(g, t));
  }
  if (danger < 250) return null; // 高額地が迫っていないなら温存
  let best = null, bestScore = 60; // 逃げた先にうまみが無ければ使わない
  for (const tile of g.tiles) {
    if (tile.id === p.pos || tile.type === "CASTLE") continue;
    let s = 0;
    for (let n = 1; n <= 6; n++) {
      const t = walkAhead(g, tile.id, n);
      s += aiLandingScore(g, p, t) / 6;
      if (t.type === "GATE" && !p.gates.has(t.id)) s += 25;
    }
    if (s > bestScore) { bestScore = s; best = tile; }
  }
  return best;
}

// トランスポート（v17）: 自分のクリーチャーを好きな空き地へ転送。
// 元の土地は失うので「価値差＋連鎖の伸び＋属性一致」で移す価値を採点する（marchの採点と同型）
// 返り値: { src, dst } または null
function aiPickTransportTarget(g, p) {
  let best = null, bestScore = 100; // スペル代80Gぶんのうまみが要る
  for (const src of ownedLands(g, p.id)) {
    if (!src.creature || CARD_BY_ID[src.creature.cardId].ab.includes("immobile")) continue;
    const card = CARD_BY_ID[src.creature.cardId];
    for (const dst of g.tiles) {
      if (dst.type !== "LAND" || dst.owner !== null) continue;
      let s = landValue(dst) - landValue(src)
        + (chainCount(g, p.id, dst.element) - (chainCount(g, p.id, src.element) - 1)) * 40;
      if (card.element === dst.element && card.element !== src.element) s += 30;
      if (s > bestScore) { bestScore = s; best = { src, dst }; }
    }
  }
  return best;
}

// リープ（v17）: 2マス先の空き地への跳躍。トランスポートと同じ採点を跳躍範囲に適用（安いぶん閾値は低め）
// 返り値: { src, dst } または null
function aiPickLeapTarget(g, p) {
  let best = null, bestScore = 60;
  for (const src of ownedLands(g, p.id)) {
    if (!src.creature || CARD_BY_ID[src.creature.cardId].ab.includes("immobile")) continue;
    const card = CARD_BY_ID[src.creature.cardId];
    for (const dst of leapDests(g, src)) {
      let s = landValue(dst) - landValue(src)
        + (chainCount(g, p.id, dst.element) - (chainCount(g, p.id, src.element) - 1)) * 40;
      if (card.element === dst.element && card.element !== src.element) s += 30;
      if (s > bestScore) { bestScore = s; best = { src, dst }; }
    }
  }
  return best;
}

// リジェネ: 相手がすぐ踏みそうな高額地の負傷クリーチャーを立て直す（周回全回復を待てない時）
function aiPickRegenTarget(g, p) {
  const wounded = ownedLands(g, p.id).filter(t => t.creature && isWounded(t.creature));
  if (wounded.length === 0) return null;
  // 傷が深く・価値が高い土地を優先
  wounded.sort((a, b) => {
    const wa = CARD_BY_ID[a.creature.cardId].hp - currentHp(a.creature);
    const wb = CARD_BY_ID[b.creature.cardId].hp - currentHp(b.creature);
    return (landValue(b) + wb * 6) - (landValue(a) + wa * 6);
  });
  return wounded[0];
}

// メテオ: 40ダメージで倒せる敵クリーチャー（現在HP<=40）を優先、無ければ高額地を削る
function aiPickMeteorTarget(g, p) {
  const lands = enemyLandsOf(g, p).filter(t => t.creature && !isSanctuaryProtected(g, t) && !isSpellProof(t));
  if (lands.length === 0) return null;
  const killable = lands.filter(t => currentHp(t.creature) <= 40 && landValue(t) >= 240);
  const pool = killable.length ? killable : lands.filter(t => landValue(t) >= 900); // 削る価値のある高額地のみ
  if (pool.length === 0) return null;
  pool.sort((a, b) => landValue(b) - landValue(a));
  return pool[0];
}

// ダイスブースト: 総資産を達成済みで城が近すぎない（倍化で一気に帰城を狙える）時に使う
function aiWantDiceDouble(g, p) {
  if (assetsOf(g, p) < RULES.target) return false; // 勝ち条件を満たしていない間は温存
  if (p.pos === 0) return false;                    // 既に城なら不要
  return true;
}

// フリーズ: 勝ちに近い or 資産で大きく先行している相手の動きを止める。対象プレイヤーを返す（いなければ null）
function aiPickFreezeTarget(g, p) {
  const cands = opponentsOf(g, p).filter(q => !q.skipTurn &&
    (assetsOf(g, q) >= RULES.target * 0.75 || assetsOf(g, q) > assetsOf(g, p) + 800));
  if (cands.length === 0) return null;
  cands.sort((a, b) => assetsOf(g, b) - assetsOf(g, a)); // 最も勝ちに近い相手を止める
  return cands[0];
}

// スティール: 手札の潤沢な相手から奪う。対象プレイヤーを返す（いなければ null）
function aiPickStealTarget(g, p) {
  const cands = opponentsOf(g, p).filter(q => q.hand.length >= 5);
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.hand.length - a.hand.length);
  return cands[0];
}

// アルケミー: 魔力が乏しく手札が渋滞しているとき、使い道の薄い1枚を120Gに変える。
// 返り値: 捨てるカードid（使わないなら null）。selfId＝アルケミー自身（候補から除外）
function aiPickAlchemy(g, p, selfId) {
  if (p.magic >= 300) return null; // 資金に余裕があるうちは温存
  const idx = p.hand.indexOf(selfId);
  const pool = p.hand.slice(0, idx).concat(p.hand.slice(idx + 1)).map(id => CARD_BY_ID[id]);
  if (pool.length < 3) return null; // 手札が細いときは変換しない
  const creatures = pool.filter(c => c.type === "creature");
  // クリーチャーが残り2枚以下なら非クリーチャーから、それ以外は全体から最安を売る
  const cands = (creatures.length <= 2) ? pool.filter(c => c.type !== "creature") : pool;
  if (cands.length === 0) return null;
  cands.sort((a, b) => a.cost - b.cost);
  return cands[0].id;
}

// サルベージ: 手札のクリーチャーが乏しいとき、捨て札から最も強いクリーチャーを回収
function aiPickSalvage(g, p) {
  if (p.discard.length === 0) return null;
  if (aiHandCards(p).filter(c => c.type === "creature").length > 1) return null;
  const cands = [...new Set(p.discard)].map(id => CARD_BY_ID[id]).filter(c => c.type === "creature");
  if (cands.length === 0) return null;
  cands.sort((a, b) => (b.st + b.hp) - (a.st + a.hp));
  return cands[0].id;
}

// リジェネを使う価値があるか: 相手が近づいている高額地に、深く傷ついた防衛クリーチャーがいる
function aiWantRegen(g, p) {
  if (p.magic < CARD_BY_ID.regen.cost + aiProf(p).reserve) return false;
  const near = aiNearTilesOfOpponents(g, p);
  return ownedLands(g, p.id).some(t => {
    if (!t.creature || !isWounded(t.creature)) return false;
    const c = CARD_BY_ID[t.creature.cardId];
    const deep = currentHp(t.creature) <= c.hp * 0.6; // 4割以上削られている
    return deep && landValue(t) >= 480 && near.has(t.id);
  });
}

// グロース: 連鎖2以上の土地でLv3以下のものを育てる
function aiPickGrowthTarget(g, p) {
  const lands = ownedLands(g, p.id).filter(t =>
    t.level <= 3 && chainCount(g, p.id, t.element) >= 2);
  if (lands.length === 0) return null;
  lands.sort((a, b) => b.level - a.level);
  return lands[0];
}

// 相手が1〜6マス以内に踏み得るマスidの集合（v24: 順方向のみ警戒。逆走はスペル/イベント限定＝稀）
function aiNearTiles(g, player) {
  const near = new Set();
  for (let n = 1; n <= 6; n++) near.add(walkAhead(g, player.pos, n).id);
  return near;
}

// スネアトラップ: 相手がすぐ踏みそうな自分の高額地に罠を仕掛け、足止めしつつ通行料を取る
function aiPickEnsnareTarget(g, p) {
  const near = aiNearTilesOfOpponents(g, p);
  const cands = g.tiles.filter(t =>
    t.type === "LAND" && t.owner === p.id && !overlayOf(g, t) &&
    near.has(t.id) && tollOf(g, t) >= 120);
  if (cands.length === 0) return null;
  cands.sort((a, b) => tollOf(g, b) - tollOf(g, a));
  return cands[0];
}

// 引き直し: クリーチャーがほぼ無く手札が渋滞している時に手札をリフレッシュ
function aiWantRenew(g, p) {
  const cost = CARD_BY_ID.renew.cost;
  if (p.magic < cost + aiProf(p).reserve + 60) return false;
  const creatures = aiHandCards(p).filter(c => c.type === "creature").length;
  return creatures <= 1 && p.hand.length >= 4;
}

// 通過地レベルアップ（②通過アクション）: 通過した自分の連鎖土地を育てて通行料を伸ばす
function aiChoosePassLevelUp(g, p) {
  const cands = passLevelupSources(g, p).filter(t =>
    chainCount(g, p.id, t.element) >= 2 && t.level <= 3 &&
    levelUpCost(t) <= p.magic - aiProf(p).reserve);
  if (cands.length === 0) return null;
  cands.sort((a, b) => (chainCount(g, p.id, b.element) - chainCount(g, p.id, a.element)) || (levelUpCost(a) - levelUpCost(b)));
  return cands[0];
}

// クリーチャー交代（②通過アクション）: 通過した自領で属性不一致の駐留を、一致クリーチャーへ入れ替える
// 返り値: { tile, cardId } または null
function aiChoosePassSwap(g, p) {
  const budget = p.magic - aiProf(p).reserve;
  let best = null, bestScore = 60; // 最低限のうまみが無ければ交代しない
  for (const t of passSwapSources(g, p)) {
    const cur = CARD_BY_ID[t.creature.cardId];
    if (cur.element === t.element) continue; // 既に属性一致なら交代不要
    const cands = aiHandCards(p).filter(c =>
      c.type === "creature" && c.element === t.element && c.cost <= budget &&
      c.st + c.hp >= cur.st + cur.hp - 10);
    if (cands.length === 0) continue;
    cands.sort((a, b) => (b.hp - a.hp) || (a.cost - b.cost));
    const pick = cands[0];
    // 属性一致による土地の加護＋連鎖価値をざっくり評価
    const score = landValue(t) * 0.4 + chainCount(g, p.id, t.element) * 40 - pick.cost * 0.5;
    if (score > bestScore) { bestScore = score; best = { tile: t, cardId: pick.id }; }
  }
  return best;
}

// サンクチュアリ: 相手がすぐ踏みそうな自分の高額地(Lv3以上)を結界で守る
function aiPickSanctuaryTarget(g, p) {
  const near = aiNearTilesOfOpponents(g, p);
  const cands = ownedLands(g, p.id).filter(t =>
    !overlayOf(g, t) && landValue(t) >= 480 && near.has(t.id));
  if (cands.length === 0) return null;
  cands.sort((a, b) => landValue(b) - landValue(a));
  return cands[0];
}

// --- クリーチャー侵攻（②通過アクション）: 通過クリーチャーを進める価値があるか ---
// 返り値: { src, dst, itemId: null } または null
function aiChooseMarch(g, p) {
  const sources = marchSources(g, p);
  if (sources.length === 0) return null;

  let best = null, bestScore = 40; // 最低限のうまみが無ければ侵攻しない
  for (const src of sources) {
    const card = CARD_BY_ID[src.creature.cardId];
    const cost = marchCost(card);
    for (const dst of marchTargets(g, p, src)) {
      let score = -cost;
      if (dst.owner === null) {
        // 無血占領: 土地の価値差と連鎖の伸びで評価
        score += landValue(dst) - landValue(src)
          + (chainCount(g, p.id, dst.element) - (chainCount(g, p.id, src.element) - 1)) * 40;
        if (card.element === dst.element && card.element !== src.element) score += 30;
      } else {
        // 敵地: 決定論シミュで勝てる時のみ検討（防衛アイテムで覆る可能性は許容）
        if (!resolveBattle(card, dst, null, null, {
          g, attackerId: p.id, attSrcId: src.id,
          attGrown: card.ab.includes("grow") ? Math.min(5, src.creature.grown || 0) : 0,
        }).attackerWins) continue;
        score += landValue(dst) + tollOf(g, dst) * 0.5 - landValue(src) * 0.3;
      }
      if (score > bestScore) { bestScore = score; best = { src, dst, itemId: null }; }
    }
  }
  return best;
}

// エレメンタルシフト: 連鎖1の孤立土地を、既に連鎖2以上ある属性へ変える
function aiPickShiftTarget(g, p) {
  const mine = ownedLands(g, p.id);
  let bestElem = null, bestN = 1;
  for (const e of Object.keys(ELEMENTS)) {
    const n = chainCount(g, p.id, e);
    if (n > bestN) { bestN = n; bestElem = e; }
  }
  if (!bestElem || bestN < 2) return null;
  const orphan = mine.find(t => t.element !== bestElem && chainCount(g, p.id, t.element) <= 1);
  if (!orphan) return null;
  return { tile: orphan, element: bestElem };
}
