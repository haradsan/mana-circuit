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
  const opp = opponentOf(g, p);
  for (const id of p.hand) {
    const c = CARD_BY_ID[id];
    if (c.type !== "spell" || c.cost > p.magic - AI_PROFILE.reserve) continue;
    if (c.spell === "recall" && p.pos !== 0 && assetsOf(g, p) - c.cost >= RULES.target) return id;
    // 大きく劣勢で関門が規定数揃っているなら、リコールで即周回（劣勢1.5倍ボーナス＋全回復）して立て直す
    if (c.spell === "recall" && p.pos !== 0 && p.gates.size >= gatesNeededOf(g) &&
        assetsOf(g, p) < assetsOf(g, opp) * COMEBACK_RATIO) return id;
    if (c.spell === "revenge" && assetsOf(g, opp) - assetsOf(g, p) >= 600 && opp.magic >= 150) return id;
    if (c.spell === "drain" && opp.magic >= 150) return id;
    if (c.spell === "plunder" && opp.magic >= 260) return id; // 相手が富んでいる時ほど半額奪取が刺さる
    if (c.spell === "dicedouble" && aiWantDiceDouble(g, p)) return id;
    if (c.spell === "vanish" && aiPickVanishTarget(g, p)) return id;
    if (c.spell === "gust" && aiPickGustTarget(g, p)) return id;
    if (c.spell === "quake" && ownedLands(g, opp.id).some(t => t.level >= 3)) return id;
    if (c.spell === "growth" && aiPickGrowthTarget(g, p)) return id;
    if (c.spell === "eleshift" && aiPickShiftTarget(g, p)) return id;
    if (c.spell === "sanctuary" && aiPickSanctuaryTarget(g, p)) return id;
    if (c.spell === "ensnare" && aiPickEnsnareTarget(g, p)) return id;
    if (c.spell === "regen" && aiWantRegen(g, p)) return id;
    if (c.spell === "meteor" && aiPickMeteorTarget(g, p)) return id;
    if (c.spell === "freeze" && aiWantFreeze(g, p)) return id;
    if (c.spell === "treasure" && ownedLands(g, p.id).length >= 3) return id;
    if (c.spell === "steal" && opp.hand.length >= 5) return id;
    if (c.spell === "salvage" && aiPickSalvage(g, p)) return id;
    if (c.spell === "alchemy" && aiPickAlchemy(g, p, id)) return id;
    if (c.spell === "renew" && aiWantRenew(g, p)) return id;
    if (c.spell === "draw" && p.hand.length <= 3) return id;
    if (c.spell === "holyword") {
      const n = aiPickHolywordDice(g, p, c.cost);
      if (n) { p.aiHolyword = n; return id; }
    }
  }
  return null;
}

// ホーリーワードで狙う価値のある目（1〜6）を探す。なければ null
// 「連鎖が伸びる空き地」に一致属性クリーチャーを置ける場合のみ使う
function aiPickHolywordDice(g, p, spellCost) {
  const budget = p.magic - spellCost - AI_PROFILE.reserve;
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
  const budget = p.magic - AI_PROFILE.reserve;
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
  for (const c of creatures) {
    if (resolveBattle(c, tile, null, null, { g }).attackerWins) {
      combos.push({ cardId: c.id, itemId: null, cost: c.cost });
    } else {
      for (const it of items) {
        if (c.cost + it.cost <= budget && resolveBattle(c, tile, it, null, { g }).attackerWins) {
          combos.push({ cardId: c.id, itemId: it.id, cost: c.cost + it.cost });
        }
      }
    }
  }
  if (combos.length === 0) return null;
  combos.sort((a, b) => a.cost - b.cost);
  const best = combos[0];
  const gain = landValue(tile) + toll; // 奪う価値 + 払わずに済む通行料
  if (gain > best.cost * AI_PROFILE.invadeRatio) {
    // 弱い相手は「勝てる戦い」でも一定確率で見送る（＝冷徹に最善手を取り続けない）
    if (AI_PROFILE.hesitateProb && Math.random() < AI_PROFILE.hesitateProb) return null;
    return best;
  }
  return null;
}

// --- 防衛時: アイテムを使うか。使うならカードid、使わないなら null ---
function aiChooseDefenseItem(g, defender, tile, attCard, attItem) {
  if (!AI_PROFILE.useDefItems) return null;
  const noItem = resolveBattle(attCard, tile, attItem, null, { g });
  if (!noItem.attackerWins) return null; // 素で守れるなら温存
  const items = aiHandCards(defender).filter(c => c.type === "item" && c.cost <= defender.magic - 50);
  const savers = items.filter(it => !resolveBattle(attCard, tile, attItem, it, { g }).attackerWins);
  if (savers.length === 0) return null;
  savers.sort((a, b) => a.cost - b.cost);
  // 守る価値がある土地か（アイテム代 < 土地価値）
  if (savers[0].cost < landValue(tile)) return savers[0].id;
  return null;
}

// --- 自分の土地: クリーチャー交代 or レベルアップ or 駐留クリーチャーの侵攻 or 何もしない ---
// 返り値: { action: "swap", cardId } / { action: "up" } / { action: "march", dst } / null
function aiOwnLand(g, p, tile) {
  const cur = CARD_BY_ID[tile.creature.cardId];
  // 属性不一致なら、一致するクリーチャーへの交代を検討（土地の加護で守りが固くなる）
  if (cur.element !== tile.element) {
    const budget = p.magic - AI_PROFILE.reserve;
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
  if (!src.creature) return null;
  const card = CARD_BY_ID[src.creature.cardId];
  if (card.ab.includes("immobile")) return null;
  const cost = marchCost(card);
  if (p.magic - AI_PROFILE.reserve < cost) return null;
  let best = null, bestScore = 40; // 最低限のうまみが無ければ動かさない
  for (const dst of marchTargets(g, p, src)) {
    let score = -cost;
    if (dst.owner === null) {
      score += landValue(dst) - landValue(src)
        + (chainCount(g, p.id, dst.element) - (chainCount(g, p.id, src.element) - 1)) * 40;
      if (card.element === dst.element && card.element !== src.element) score += 30;
    } else {
      if (!resolveBattle(card, dst, null, null, { g }).attackerWins) continue;
      score += landValue(dst) + tollOf(g, dst) * 0.5 - landValue(src) * 0.3;
    }
    if (score > bestScore) { bestScore = score; best = { dst }; }
  }
  return best;
}

// --- 自分の土地: レベルアップするか ---
function aiChooseLevelUp(g, p, tile) {
  const cost = levelUpCost(tile);
  if (!isFinite(cost) || cost > p.magic - AI_PROFILE.reserve * 2) return false;
  const chain = chainCount(g, p.id, tile.element);
  // 連鎖のある土地を優先的に伸ばす。単発土地もある程度は投資する
  if (chain >= 2) return true;
  return tile.level < AI_PROFILE.levelSingle && p.magic > cost + 300;
}

// --- 分かれ道: どちらへ進むか。next のタイルidを返す ---
function aiChooseDirection(g, p, tile, stepsLeft) {
  let best = tile.next[0], bestScore = -Infinity;
  for (const nid of tile.next) {
    let score = Math.random() * 20; // 同点時のゆらぎ
    let cur = nid;
    for (let s = 0; s < stepsLeft; s++) {
      const t = g.tiles[cur];
      if (t.type === "GATE" && !p.gates.has(t.id)) score += RULES.gateBonus * 0.5;
      if (t.type === "CASTLE") {
        if (assetsOf(g, p) >= RULES.target) score += 5000;         // 勝ちに行く
        else if (p.gates.size >= gatesNeededOf(g)) score += 150;   // 周回ボーナス
      }
      if (s === stepsLeft - 1) score += aiLandingScore(g, p, t);
      else cur = t.next[0];
    }
    if (score > bestScore) { bestScore = score; best = nid; }
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
    case "LAND":
      if (t.owner === null) return 60 + chainCount(g, p.id, t.element) * 30;
      if (t.owner === p.id) return 30;
      return -tollOf(g, t) * 0.8;
    default: return 0;
  }
}

// ---------- スペルのターゲット選択ヘルパー ----------
function aiPickQuakeTarget(g, p) {
  const opp = opponentOf(g, p);
  const lands = ownedLands(g, opp.id).filter(t => t.level > 1 && !isSanctuaryProtected(g, t));
  if (lands.length === 0) return null;
  lands.sort((a, b) => b.level - a.level);
  return lands[0];
}

// バニッシュ: 敵の最も価値の高い（＝主力の）土地のクリーチャーを無条件で消滅させる（HP不問）。
// レジェンド級の確定除去なので、相手の要となる高額地・連鎖地に温存して撃つ。
function aiPickVanishTarget(g, p) {
  const opp = opponentOf(g, p);
  const lands = ownedLands(g, opp.id).filter(t =>
    t.creature && landValue(t) >= 480 && !isSanctuaryProtected(g, t) && !isSpellProof(t));
  if (lands.length === 0) return null;
  lands.sort((a, b) =>
    (landValue(b) + chainCount(g, opp.id, b.element) * 200) -
    (landValue(a) + chainCount(g, opp.id, a.element) * 200));
  return lands[0];
}

// ガスト（強制移動）: 敵の連鎖地・高額地のクリーチャーを、隣接する最も安い空き地へ押し出して連鎖・防衛を崩す
// 返り値: { src, dst } または null
function aiPickGustTarget(g, p) {
  const opp = opponentOf(g, p);
  let best = null, bestScore = 60; // 最低限のうまみが無ければ撃たない
  for (const src of ownedLands(g, opp.id)) {
    if (!src.creature || isSanctuaryProtected(g, src) || isSpellProof(src)) continue;
    if (CARD_BY_ID[src.creature.cardId].ab.includes("immobile")) continue;
    const dests = gustDests(g, src);
    if (dests.length === 0) continue;
    dests.sort((a, b) => landValue(a) - landValue(b)); // 相手の得を最小化＝最も安い空き地へ
    const dst = dests[0];
    const chain = chainCount(g, opp.id, src.element);
    const score = landValue(src) * 0.4 + (chain >= 2 ? chain * 120 : 0) - landValue(dst) * 0.3;
    if (score > bestScore) { bestScore = score; best = { src, dst }; }
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
  const opp = opponentOf(g, p);
  const lands = ownedLands(g, opp.id).filter(t => t.creature && !isSanctuaryProtected(g, t) && !isSpellProof(t));
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

// フリーズ: 相手が勝ちに近い or 資産で大きく先行しているとき、動きを止める
function aiWantFreeze(g, p) {
  const opp = opponentOf(g, p);
  if (opp.skipTurn) return false;
  return assetsOf(g, opp) >= RULES.target * 0.75 || assetsOf(g, opp) > assetsOf(g, p) + 800;
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
  if (p.magic < CARD_BY_ID.regen.cost + AI_PROFILE.reserve) return false;
  const opp = opponentOf(g, p);
  const near = aiNearTiles(g, opp);
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

// 相手が既定ルートで1〜6マス以内に踏み得るマスidの集合
function aiNearTiles(g, player) {
  const near = new Set();
  for (let n = 1; n <= 6; n++) near.add(walkAhead(g, player.pos, n).id);
  return near;
}

// スネアトラップ: 相手がすぐ踏みそうな自分の高額地に罠を仕掛け、足止めしつつ通行料を取る
function aiPickEnsnareTarget(g, p) {
  const opp = opponentOf(g, p);
  const near = aiNearTiles(g, opp);
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
  if (p.magic < cost + AI_PROFILE.reserve + 60) return false;
  const creatures = aiHandCards(p).filter(c => c.type === "creature").length;
  return creatures <= 1 && p.hand.length >= 4;
}

// 通過地レベルアップ（②通過アクション）: 通過した自分の連鎖土地を育てて通行料を伸ばす
function aiChoosePassLevelUp(g, p) {
  const cands = passLevelupSources(g, p).filter(t =>
    chainCount(g, p.id, t.element) >= 2 && t.level <= 3 &&
    levelUpCost(t) <= p.magic - AI_PROFILE.reserve);
  if (cands.length === 0) return null;
  cands.sort((a, b) => (chainCount(g, p.id, b.element) - chainCount(g, p.id, a.element)) || (levelUpCost(a) - levelUpCost(b)));
  return cands[0];
}

// クリーチャー交代（②通過アクション）: 通過した自領で属性不一致の駐留を、一致クリーチャーへ入れ替える
// 返り値: { tile, cardId } または null
function aiChoosePassSwap(g, p) {
  const budget = p.magic - AI_PROFILE.reserve;
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
  const opp = opponentOf(g, p);
  const near = aiNearTiles(g, opp);
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
        if (!resolveBattle(card, dst, null, null, { g }).attackerWins) continue;
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
