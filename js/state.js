// ============================================================
// state.js — ゲーム状態とルール計算
// ============================================================
"use strict";

// 既定ルール。ステージの rules で上書きされ、newGame 時に RULES にセットされる
const DEFAULT_RULES = {
  target: 4000,        // 勝利に必要な総資産
  maxRounds: 40,       // ラウンド上限（超えたら資産勝負）
  startMagic: 600,
  tollRate: 0.6,       // 通行料 = 土地価値 × tollRate × 連鎖倍率
  magicTileG: 150,     // 魔力マス
  gateBonus: 100,      // 関門通過ボーナス
  lapBase: 200,        // 周回ボーナス基本値
  invaderSt: 0,        // 侵略側ST補正（闘技場ステージ用）
  landHpMult: 1,       // 土地HPボーナス倍率
  cpuMagicBonus: 0,    // CPUの初期魔力補正（最終ステージ用）
  magmaLoss: 80,       // マグママスで失う魔力
  minDice: 1,          // ダイスの最小の目（ウィークリールール「疾走の週」で4になる）
};
let RULES = { ...DEFAULT_RULES };

const HAND_LIMIT  = 6;
const LAND_VALUE  = [100, 240, 480, 900, 1600]; // レベル1〜5の土地価値
const SELL_RATE   = 0.7;   // 強制売却の換金率
const COMEBACK_RATIO = 0.7; // 総資産が相手の7割未満なら劣勢（周回ボーナス1.5倍）

// クリーチャー侵攻（march）
const MARCH_COST_MIN  = 30;   // 行軍費の下限
const MARCH_COST_RATE = 0.4;  // 行軍費 = クリーチャーコスト×この率
// 盤面エフェクト（時限オーバーレイ）: sanctuary=結界 / snare=足止めの罠
const OVERLAY_DURATION = 2;   // 効果の持続ラウンド数

// 周回に必要な関門数。gatesNeeded:"all" なら盤面の全関門（＝全て必須通過点）
// これにより「関門を全て通過して城に戻る」＝1周となり、単純な環でない盤面（十字・星型）でも成立する
function gatesNeededOf(g) {
  const gn = g.stage.gatesNeeded ?? 3;
  if (gn === "all") return g.tiles.filter(t => t.type === "GATE").length;
  return gn;
}

// ---------- 盤面エフェクト（tile.overlay = {kind, owner, expiresRound}） ----------
function overlayOf(g, tile) {
  if (!tile.overlay) return null;
  if (g.round > tile.overlay.expiresRound) { tile.overlay = null; return null; }
  return tile.overlay;
}
function setOverlay(g, tile, kind, ownerId) {
  tile.overlay = { kind, owner: ownerId, expiresRound: g.round + OVERLAY_DURATION - 1 };
}
function isSanctuaryProtected(g, tile) {
  const ov = overlayOf(g, tile);
  return !!ov && ov.kind === "sanctuary";
}
// 侵略者を止める罠（術者以外が踏むと発動）
function snareOn(g, tile, moverId) {
  const ov = overlayOf(g, tile);
  return !!ov && ov.kind === "snare" && ov.owner !== moverId;
}

// ---------- 土地の援護（隣接する自軍領地1つにつき防衛ST+10、最大+40） ----------
function landSupportSt(g, tile) {
  if (tile.owner === null) return 0;
  const n = neighborsOf(g, tile).filter(t => t.type === "LAND" && t.owner === tile.owner).length;
  return Math.min(40, n * 10);
}

// クリーチャーの現在HP（傷を負っていれば減少。旧セーブ互換で hp 未設定なら基本値）
function currentHp(creature) {
  return creature.hp ?? CARD_BY_ID[creature.cardId].hp;
}
// クリーチャーが負傷している（現在HP < 基本HP）か
function isWounded(creature) {
  return currentHp(creature) < CARD_BY_ID[creature.cardId].hp;
}

// ---------- クリーチャー侵攻（march） ----------
function marchCost(card) {
  return Math.max(MARCH_COST_MIN, Math.floor(card.cost * MARCH_COST_RATE));
}

// 隣接マス（グラフの前後両方向）
function neighborsOf(g, tile) {
  const ids = new Set(tile.next);
  g.tiles.forEach(t => { if (t.next.includes(tile.id)) ids.add(t.id); });
  ids.delete(tile.id);
  return [...ids].map(id => g.tiles[id]);
}

// srcTile のクリーチャーが侵攻できる隣接マス（空き地 or 敵の土地。結界は不可）
function marchTargets(g, p, srcTile) {
  return neighborsOf(g, srcTile).filter(t =>
    t.type === "LAND" && t.owner !== p.id &&
    !(t.owner !== null && isSanctuaryProtected(g, t)));
}

// ガスト（強制移動スペル）で敵クリーチャーを押し出せる先＝隣接する空き地（未所有のLAND）
function gustDests(g, srcTile) {
  return neighborsOf(g, srcTile).filter(t => t.type === "LAND" && t.owner === null);
}

// ②通過アクションの対象になる自領のtile id列。
// 「このターン通過した自領」（lastPath の末尾＝停止マスは除く）のみが対象。
// 出発マス（ターン開始時にいたマス）は含めない——前のターンに①（到達アクション）で命令できたマスなので、
// 含めると同じマスが2ターン連続で対象になってしまう（v13で出発マス扱いを撤回）。
// 周回達成ターン・城ぴったり停止（passAllLands）は「全ての自領」を対象にする（領地コントロール・リコール）。
function passActionTileIds(g, p) {
  if (p.passAllLands) return ownedLands(g, p.id).map(t => t.id);
  return (p.lastPath || []).slice(0, -1);
}

// 護法（spellproof）: 敵の対象指定スペル（メテオ・バニッシュ・ガスト）の対象にならないクリーチャーか
function isSpellProof(tile) {
  return !!(tile.creature && CARD_BY_ID[tile.creature.cardId].ab.includes("spellproof"));
}

// 通過アクションの出撃元/対象になる自分のクリーチャー土地のうち、侵攻を出せるもの
// （lastPath の最後の要素＝停止マスは除外。周回達成ターンは全自領が対象）
function marchSources(g, p) {
  const passed = passActionTileIds(g, p);
  const seen = new Set();
  const out = [];
  for (const id of passed) {
    if (id === p.pos || seen.has(id)) continue;
    seen.add(id);
    const t = g.tiles[id];
    if (t.type !== "LAND" || t.owner !== p.id || !t.creature) continue;
    if (CARD_BY_ID[t.creature.cardId].ab.includes("immobile")) continue; // 不動は侵攻に出せない
    if (p.magic < marchCost(CARD_BY_ID[t.creature.cardId])) continue;
    if (marchTargets(g, p, t).length === 0) continue;
    out.push(t);
  }
  return out;
}

// 通過アクションで レベルアップできる自分の土地（停止マス自体は除外。周回達成ターンは全自領が対象）
function passLevelupSources(g, p) {
  const passed = passActionTileIds(g, p);
  const seen = new Set();
  const out = [];
  for (const id of passed) {
    if (id === p.pos || seen.has(id)) continue;
    seen.add(id);
    const t = g.tiles[id];
    if (t.type !== "LAND" || t.owner !== p.id) continue;
    if (levelUpCost(t) > p.magic) continue; // 最大Lvは levelUpCost=Infinity で自動除外
    out.push(t);
  }
  return out;
}

// このターンに通過した自分の土地のうち、駐留クリーチャーを手札のクリーチャーと交代できるもの
// （②通過アクション用。停止マス自体は除外。交代に出せる手札クリーチャーが1枚も無ければ空）
function passSwapSources(g, p) {
  const hasAffordable = p.hand.some(id => {
    const c = CARD_BY_ID[id];
    return c.type === "creature" && c.cost <= p.magic;
  });
  if (!hasAffordable) return [];
  const passed = passActionTileIds(g, p);
  const seen = new Set();
  const out = [];
  for (const id of passed) {
    if (id === p.pos || seen.has(id)) continue;
    seen.add(id);
    const t = g.tiles[id];
    if (t.type !== "LAND" || t.owner !== p.id || !t.creature) continue;
    out.push(t);
  }
  return out;
}

// 既定ルート（分岐は最初の道）を steps マス進んだ先のタイル
function walkAhead(g, startId, steps) {
  let cur = startId;
  for (let i = 0; i < steps; i++) cur = g.tiles[cur].next[0];
  return g.tiles[cur];
}

// ダイスを振る（ホーリーワードの指定目を優先。minDice はウィークリールール「疾走の週」用）
function rollDice(p) {
  if (p.forcedDice) return p.forcedDice;
  const lo = RULES.minDice || 1;
  return lo + Math.floor(Math.random() * (7 - lo));
}

// opts.training: トレーニング（ウィークリールールを適用しない）
// opts.versus:   2人対戦（ホットシート）。{p0, p1}＝両プレイヤーのプロファイルindex
function newGame(stageIdx = 0, opts = {}) {
  const stage = STAGES[stageIdx];
  RULES = { ...DEFAULT_RULES, ...(stage.rules || {}) };
  // ウィークリールール（ONのとき・トレーニング以外）: RULES をさらに上書きして週替わりの対戦にする
  const weekly = (!opts.training && typeof activeWeeklyRule === "function") ? activeWeeklyRule() : null;
  if (weekly && weekly.apply) weekly.apply(RULES);
  const versus = opts.versus || null;
  // CPUの実効プロファイル（相手ごとのプロファイル × 全体難易度）。デッキ上限・初期魔力補正に使う
  const cpuProfile = (typeof resolveAIProfile === "function") ? resolveAIProfile(stage.ai)
    : ((typeof AI_PROFILES !== "undefined" && AI_PROFILES[stage.ai]) || null);
  const cpuMaxCost = (cpuProfile && cpuProfile.deckMaxCost) || Infinity;
  // CPU初期魔力＝基準 + ステージ補正(cpuMagicBonus) + プロファイル/難易度補正(magicBonus)。最低150を保証
  const cpuMagicBonus = RULES.cpuMagicBonus + ((cpuProfile && cpuProfile.magicBonus) || 0);
  const cpuStartMagic = Math.max(150, RULES.startMagic + cpuMagicBonus);
  const mkPlayer = (id, name, isCPU, bias, deckOverride) => {
    // 人間側は構築デッキがあればそれを使う（未構築なら従来の自動デッキ・上限なし）。CPUは常に自動デッキ（難易度で上限）
    // deckOverride: 2人対戦で各プロファイルのデッキを指定する（null＝自動デッキ）
    const custom = deckOverride !== undefined ? deckOverride
      : (!isCPU && typeof getPlayerDeck === "function") ? getPlayerDeck() : null;
    return {
      id, name, isCPU,
      magic: isCPU ? cpuStartMagic : RULES.startMagic,
      pos: 0,
      deck: custom ? shuffle(custom) : buildDeck(bias, isCPU ? cpuMaxCost : Infinity),
      hand: [],
      discard: [],        // 使用済みカード（山札切れ時に再利用）
      gates: new Set(),   // 通過済み関門ID
      laps: 0,
      alive: true,
      forcedDice: null,   // ホーリーワードで指定した目
      diceMult: null,     // ダイスブーストで次の出目を倍にする（2）
      lastPath: [],       // このターンの移動で通過したマスid（クリーチャー侵攻の出撃元判定用）
      passAllLands: false,// 周回達成ターンは全ての自領を②通過アクションの対象にする（城ぴったり到達・リコール）
      skipTurn: false,    // 次のターン休みか（捕縛/フリーズ）
      skipReason: null,   // skipTurnの理由: "capture"=🕸️捕縛 / "freeze"=❄️フリーズ（表示メッセージの出し分け用）
    };
  };
  const g = {
    stageIdx,
    stage,
    tiles: buildBoard(stage),
    players: versus
      // 2人対戦（ホットシート）: 両者とも人間。各プロファイルの名前と使用中デッキ（未構築なら自動デッキ）を使う
      ? [
        mkPlayer(0, profileName(versus.p0), false, null, getPlayerDeckFor(versus.p0)),
        mkPlayer(1, profileName(versus.p1), false, null, getPlayerDeckFor(versus.p1)),
      ]
      : [
        // 人間側の名前は選択中のプレイヤープロファイル名（👤プレイヤー選択で切替・変更できる）
        mkPlayer(0, (typeof currentProfileName === "function" && currentProfileName()) || "あなた", false, null),
        mkPlayer(1, stage.cpuName || "CPU", true, stage.cpuBias),
      ],
    current: 0,
    round: 1,
    over: false,
    winner: null,
    weekly, // 適用中のウィークリールール（OFF/トレーニングなら null）
  };
  // 初期手札5枚
  g.players.forEach(p => { for (let i = 0; i < 5; i++) drawCard(g, p); });
  // 英雄の週: 初期手札にレジェンドが無ければ、ランダムな1枚をランダムなレジェンドと入れ替える（両者対象で公平）
  if (weekly && weekly.hook === "legendHand") {
    g.players.forEach(p => {
      if (p.hand.some(id => cardRarity(CARD_BY_ID[id]) === "legendary")) return;
      const legends = cardsOfRarity("legendary");
      const pick = legends[Math.floor(Math.random() * legends.length)];
      const i = Math.floor(Math.random() * p.hand.length);
      p.deck.unshift(p.hand[i]); // 入れ替えたカードは山札の底へ戻す
      p.hand[i] = pick;
    });
  }
  return g;
}

function drawCard(g, p) {
  if (p.deck.length === 0 && p.discard.length > 0) {
    // 山札切れ→捨札を切り直して山札を再生成。プレイヤーに「合図」する（ログ＋効果音）
    p.deck = shuffle(p.discard);
    p.discard = [];
    if (typeof log === "function") log(`🔀 ${p.name}の山札が一巡！ 捨札(${p.deck.length}枚)を切り直して山札に戻した`, "warn");
    if (typeof SFX !== "undefined" && SFX.dice) SFX.dice();
  }
  if (p.deck.length === 0) return null;
  const id = p.deck.pop();
  p.hand.push(id);
  return id;
}

function opponentOf(g, p) { return g.players[1 - p.id]; }

// 同属性の所有土地数（連鎖数）
function chainCount(g, playerId, element) {
  return g.tiles.filter(t => t.type === "LAND" && t.owner === playerId && t.element === element).length;
}

function chainMult(n) {
  if (n >= 4) return 2.5;
  return [0, 1.0, 1.5, 2.0][n] || 1.0;
}

function tollOf(g, tile) {
  if (tile.type !== "LAND" || tile.owner === null) return 0;
  const chain = chainCount(g, tile.owner, tile.element);
  return Math.floor(LAND_VALUE[tile.level - 1] * RULES.tollRate * chainMult(chain));
}

function landValue(tile) { return LAND_VALUE[tile.level - 1]; }

// 投資額 ≒ 価値上昇（資産的に中立、通行料の伸びがリターン）
function levelUpCost(tile) {
  if (tile.level >= 5) return Infinity;
  return LAND_VALUE[tile.level] - LAND_VALUE[tile.level - 1];
}

function assetsOf(g, p) {
  const lands = g.tiles.filter(t => t.type === "LAND" && t.owner === p.id)
    .reduce((s, t) => s + landValue(t), 0);
  return p.magic + lands;
}

function ownedLands(g, playerId) {
  return g.tiles.filter(t => t.type === "LAND" && t.owner === playerId);
}

// 周回ボーナス（所有土地が多いほど増える）。大きく劣勢なら1.5倍の「逆転の風」
function lapBonus(g, p) {
  const base = RULES.lapBase + ownedLands(g, p.id).length * 25;
  const comeback = assetsOf(g, p) < assetsOf(g, opponentOf(g, p)) * COMEBACK_RATIO;
  return { gold: comeback ? Math.floor(base * 1.5) : base, comeback };
}

// 土地の防衛HPボーナス（属性一致時のみ）
function landHpBonus(tile, creatureCard) {
  if (!creatureCard || creatureCard.element !== tile.element) return 0;
  return tile.level * 10 * RULES.landHpMult;
}

// 支払い。足りなければ土地を売却。それでも足りなければ破産(falseを返す)。
// chooseFn(lands, amount) -> Promise<tile>|tile : 売却する土地を選ぶ（人間は選択可）。
//   省略/nullを返すと既定＝最高額の土地を自動売却。UIに依存しないよう state.js からはコールバックで受ける。
async function forcePay(g, payer, amount, receiver, logFn, chooseFn = null) {
  while (payer.magic < amount) {
    const lands = ownedLands(g, payer.id);
    if (lands.length === 0) break;
    let t = chooseFn ? await chooseFn(lands, amount) : null;
    if (!t || t.owner !== payer.id) t = lands.slice().sort((a, b) => landValue(b) - landValue(a))[0]; // 既定＝最高額
    const gain = Math.floor(landValue(t) * SELL_RATE);
    if (t.creature) payer.discard.push(t.creature.cardId);
    t.owner = null; t.creature = null; t.level = 1;
    payer.magic += gain;
    logFn(`${payer.name}は魔力不足！ ${tileName(t)}を売却して${gain}Gを得た`);
  }
  if (payer.magic < amount) {
    receiver && (receiver.magic += payer.magic);
    payer.magic = 0;
    payer.alive = false;
    logFn(`${payer.name}は支払い不能… 破産した！`);
    return false;
  }
  payer.magic -= amount;
  if (receiver) receiver.magic += amount;
  return true;
}

// 人間プレイヤー用の「売却する土地を選ぶ」コールバックを作る（CPUはnull＝自動売却）。
// main.js の humanPickTileOnMap を使い、盤面からも選べる。キャンセル可（その場合は自動売却にフォールバック）。
function landSellChooser(payer) {
  if (payer.isCPU) return null;
  return (lands, amount) => humanPickTileOnMap(lands, {
    title: "💸 魔力不足 — 売却する領地を選択",
    body: `支払いに <b>${amount}G</b> が必要ですが魔力が足りません（現在 ${payer.magic}G）。売却する自分の領地を選んでください。<br>売値＝土地価値 × ${Math.round(SELL_RATE * 100)}%（駐留クリーチャーは捨札へ）。<b>足りるまで繰り返し売却</b>します。`,
    cancelable: true, cancelLabel: "おまかせ（高額地から自動売却）",
    labelFn: t => `${ELEMENTS[t.element].icon} ${tileName(t)}（Lv${t.level}・価値${landValue(t)}G → 売値${Math.floor(landValue(t) * SELL_RATE)}G${t.creature ? "・駐留" + CARD_BY_ID[t.creature.cardId].name : ""}）`,
  });
}

function tileName(tile) {
  switch (tile.type) {
    case "CASTLE": return "城";
    case "GATE":   return `関門`;
    case "CARD":   return "カードマス";
    case "MAGIC":  return "魔力マス";
    case "WARP":   return "ワープマス";
    case "MAGMA":  return "マグママス";
    case "BOOST":  return "疾風マス";
    default:       return `${ELEMENTS[tile.element].name}の土地 #${tile.id}`;
  }
}
