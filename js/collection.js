// ============================================================
// collection.js — カード収集とデッキ構築（localStorage永続化・第一弾100種アルバム）
// ============================================================
"use strict";

const COLLECTION_KEY = "mana-circuit-collection";
const DECK_SIZE     = 30;   // 構築デッキの枚数（現行の自動デッキと同じ）
const MAX_COPIES    = 3;    // 同名カードの上限
const MIN_CREATURES = 12;   // デッキに必要な最低クリーチャー数（土地を確保できるように）
const DECK_SLOTS    = 5;    // プレイヤーごとに保存できるデッキ数

// レア度（cardRarity / RARITY_WEIGHT / RARITY_META）は cards.js で定義。パックの排出重みに使う。

// ---------- 永続化（プレイヤープロファイル別） ----------
// スターター: コスト75以下のカードを各2枚（最初から30枚デッキを組める）。高コストはパックで集める。
// 無属性クリーチャーはレア以上の特別枠なのでスターターには含めない（パック・工房で入手）
function defaultCollection() {
  const owned = {};
  CARD_DB.forEach(c => { if (c.cost <= 75 && c.element !== "neutral") owned[c.id] = 2; });
  return { owned, decks: Array(DECK_SLOTS).fill(null), activeDeck: 0, packsGiven: {}, trainingWins: 0, shards: 0 };
}
function loadCollection() {
  try {
    const c = JSON.parse(localStorage.getItem(profileStorageKey(COLLECTION_KEY)));
    if (c && typeof c === "object" && c.owned) {
      c.packsGiven = c.packsGiven || {};
      c.shards = Math.max(0, c.shards | 0); // 🔮マナの欠片（工房の分解・生成用）
      // 旧スキーマ（deck 1本）→ デッキスロット5本へ移行（既存デッキはスロット1へ）
      if (!Array.isArray(c.decks)) {
        c.decks = Array(DECK_SLOTS).fill(null);
        if (Array.isArray(c.deck)) c.decks[0] = c.deck;
        delete c.deck;
      }
      while (c.decks.length < DECK_SLOTS) c.decks.push(null);
      c.activeDeck = Math.min(Math.max(0, c.activeDeck | 0), DECK_SLOTS - 1);
      return c;
    }
  } catch (e) { /* 壊れていたら初期化 */ }
  const def = defaultCollection();
  saveCollection(def);
  return def;
}
function saveCollection(c) {
  try { localStorage.setItem(profileStorageKey(COLLECTION_KEY), JSON.stringify(c)); } catch (e) { /* プライベートモード等 */ }
}

function ownedCount(cardId) { return loadCollection().owned[cardId] || 0; }
function distinctOwned() {
  const o = loadCollection().owned;
  return Object.keys(o).filter(id => o[id] > 0 && CARD_BY_ID[id]).length;
}
function addCards(cardIds) {
  const c = loadCollection();
  cardIds.forEach(id => { c.owned[id] = (c.owned[id] || 0) + 1; });
  saveCollection(c);
}

// ---------- パック開封（返り値: cardId配列） ----------
// レア度を重みで抽選（minRarity 指定時はそれ以上のレア度からのみ）
function rollRarity(minRarity = null) {
  let pool = RARITY_ORDER;
  if (minRarity) pool = RARITY_ORDER.slice(RARITY_ORDER.indexOf(minRarity));
  const weights = pool.map(r => RARITY_WEIGHT[r]);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll < 0) return pool[i]; }
  return pool[pool.length - 1];
}
// パックのn枚を引く。ポイントは「先にレア度を決めてから、そのレア度のカードを一様に1枚選ぶ」こと。
// 旧実装はカードごとに重みを積んでいたため、コモンの“種類数”が多いほど排出が全部コモンに偏っていた
// （＝「コモンばかり出る」問題）。レア度先決め方式なら種類数に左右されずレアも顔を出す。
// guarantee: このパックに最低 guaranteeCount 枚は保証するレア度（原さん指定）。
//   ＝5枚報酬はレア1枚保証／3枚はアンコモン1枚保証／初クリア10枚はレア2枚以上保証（枚数が倍なので保証も倍が妥当）。
// 「残り枠を全部使わないと保証枚数に届かない」状況になったら、その枠から保証レア度以上へ格上げする方式。
// お試し重視で希少性は緩め＝毎回の開封に“当たり枠”があるようにして楽しさを優先する。
function drawPack(n = 3, guarantee = "uncommon", guaranteeCount = 1) {
  const out = [];
  const rank = r => RARITY_ORDER.indexOf(r);
  const need = rank(guarantee);
  for (let i = 0; i < n; i++) {
    const slotsLeft = n - i; // この枠を含む残り枠数
    const have = out.filter(id => rank(cardRarity(CARD_BY_ID[id])) >= need).length;
    const min = (guaranteeCount - have >= slotsLeft) ? guarantee : null; // 残り枠を全部使わないと届かないなら格上げ
    const cards = cardsOfRarity(rollRarity(min));
    out.push(cards[Math.floor(Math.random() * cards.length)]);
  }
  return out;
}
// 報酬枚数と保証（原さん指定）: 新規クリア=10枚＋レア2枚保証 / 正規勝利=5枚＋レア1枚保証 / トレーニング=3枚＋アンコモン1枚保証
const REWARD_FIRST_CLEAR = 10;
const REWARD_WIN         = 5;
const REWARD_TRAINING    = 3;
const GUARANTEE_FIRST_CLEAR = 2; // 初クリアはレア以上を2枚保証（10枚パック）
const TRAINING_STREAK_FOR_RARE = 3; // トレーニング連勝ボーナス: この連勝数からは毎回レア以上1枚保証

// ステージ初クリアで大型パック（10枚・レア以上2枚保証）。既に付与済みなら null
function grantStageClearPack(stageId, n = REWARD_FIRST_CLEAR) {
  const c = loadCollection();
  if (c.packsGiven[stageId]) return null;
  const pack = drawPack(n, "rare", GUARANTEE_FIRST_CLEAR);
  c.packsGiven[stageId] = true;
  saveCollection(c);
  addCards(pack);
  return pack;
}
// クリア済みステージを正規プレイで再度勝利したときの報酬（5枚・レア保証）
function grantWinCards(n = REWARD_WIN) {
  const pack = drawPack(n, "rare");
  addCards(pack);
  return pack;
}
// トレーニング勝利で3枚（アンコモン保証）。連勝を重ねると保証が格上げされる（負け・投了でリセット）
function grantTrainingCards(n = REWARD_TRAINING) {
  const c = loadCollection();
  c.trainingWins = (c.trainingWins || 0) + 1;
  c.trainingStreak = (c.trainingStreak || 0) + 1;
  saveCollection(c);
  const hot = c.trainingStreak >= TRAINING_STREAK_FOR_RARE; // 3連勝からはレア以上1枚保証
  const pack = drawPack(n, hot ? "rare" : "uncommon");
  addCards(pack);
  return pack;
}
// 現在のトレーニング連勝数（表示用）
function trainingStreakCount() { return loadCollection().trainingStreak || 0; }
// トレーニングの敗北・投了で連勝をリセット
function resetTrainingStreak() {
  const c = loadCollection();
  if (c.trainingStreak) { c.trainingStreak = 0; saveCollection(c); }
}
// 旧名互換
function grantTrainingCard() { return grantTrainingCards(REWARD_TRAINING); }

// ---------- デッキ（プレイヤーごとに5スロット保存・1つを「使用中」に指定） ----------
// スロットの中身（無効・旧カード入りなら null）
function deckInSlot(slot) {
  const c = loadCollection();
  const d = c.decks[slot];
  if (!d || !Array.isArray(d) || d.length !== DECK_SIZE) return null;
  if (d.some(id => !CARD_BY_ID[id])) return null;
  return d.slice();
}
// 対戦で使うデッキ＝「使用中」スロットの中身（未構築なら null → 自動デッキ）
function getPlayerDeck() {
  return deckInSlot(loadCollection().activeDeck);
}
function activeDeckSlot() { return loadCollection().activeDeck; }
function setActiveDeckSlot(slot) {
  const c = loadCollection();
  c.activeDeck = Math.min(Math.max(0, slot | 0), DECK_SLOTS - 1);
  saveCollection(c);
}
// デッキをスロットに保存し、そのスロットを「使用中」にする
function setPlayerDeck(deck, slot = null) {
  const c = loadCollection();
  const s = slot === null ? c.activeDeck : Math.min(Math.max(0, slot | 0), DECK_SLOTS - 1);
  c.decks[s] = deck.slice();
  c.activeDeck = s;
  saveCollection(c);
}
// 指定プロファイルの「使用中デッキ」を読む（2人対戦用。現在プロファイルに依存せず生キーを直接読む）。
// 未構築・無効なら null（→ 自動デッキにフォールバック）
function getPlayerDeckFor(profileIdx) {
  const key = profileIdx === 0 ? COLLECTION_KEY : `${COLLECTION_KEY}-p${profileIdx + 1}`;
  try {
    const c = JSON.parse(localStorage.getItem(key));
    if (!c || !Array.isArray(c.decks)) return null;
    const slot = Math.min(Math.max(0, c.activeDeck | 0), DECK_SLOTS - 1);
    const d = c.decks[slot];
    if (!d || !Array.isArray(d) || d.length !== DECK_SIZE) return null;
    if (d.some(id => !CARD_BY_ID[id])) return null;
    return d.slice();
  } catch (e) { return null; }
}

function deckValidity(deck) {
  const counts = {};
  deck.forEach(id => counts[id] = (counts[id] || 0) + 1);
  const creatures = deck.filter(id => CARD_BY_ID[id].type === "creature").length;
  const errors = [];
  if (deck.length !== DECK_SIZE) errors.push(`${DECK_SIZE}枚ちょうどにしてください（現在${deck.length}枚）`);
  if (Object.keys(counts).some(id => counts[id] > MAX_COPIES)) errors.push(`同名カードは${MAX_COPIES}枚まで`);
  if (Object.keys(counts).some(id => counts[id] > ownedCount(id))) errors.push(`所持数を超えたカードがあります`);
  if (creatures < MIN_CREATURES) errors.push(`クリーチャーを${MIN_CREATURES}枚以上入れてください（現在${creatures}枚）`);
  return { ok: errors.length === 0, errors, creatures };
}

// ---------- 表示ヘルパー ----------
function cardIconOf(c) {
  return c.icon || (c.type === "creature" ? ELEMENTS[c.element].icon : c.type === "item" ? (c.st > 0 ? "⚔️" : "🛡️") : "✨");
}
function typeOrder(id) { const t = CARD_BY_ID[id].type; return t === "creature" ? 0 : t === "item" ? 1 : 2; }
function deckTip(c) {
  return c.type === "creature" ? `ST${c.st}/HP${c.hp} ${(c.ab || []).map(a => ABILITY_INFO[a].name).join("/")}` : c.desc;
}

// 所持カードから妥当な30枚デッキを自動生成（構築の下地）
function autoBuildFromCollection() {
  const avail = {}; const owned = loadCollection().owned;
  Object.keys(owned).forEach(id => { if (CARD_BY_ID[id]) avail[id] = owned[id]; });
  const deck = [];
  const pick = (filter, n) => {
    for (let k = 0; k < n; k++) {
      const pool = Object.keys(avail).filter(id => avail[id] > 0 &&
        deck.filter(x => x === id).length < MAX_COPIES && filter(CARD_BY_ID[id]));
      if (!pool.length) break;
      const id = pool[Math.floor(Math.random() * pool.length)];
      deck.push(id); avail[id]--;
    }
  };
  pick(c => c.type === "creature", 18);
  pick(c => c.type === "spell", 6);
  pick(c => c.type === "item", 6);
  pick(() => true, DECK_SIZE - deck.length); // 不足分を何でも埋める
  return deck.slice(0, DECK_SIZE);
}

// ---------- アルバム画面 ----------
function albumTile(c, count) {
  const owned = count > 0;
  const stats = c.type === "creature" ? `ST${c.st}/HP${c.hp}` : `${c.cost}G`;
  const rar = cardRarity(c), rm = RARITY_META[rar];
  // 所持カードはミニアート（造形）を表示、未収集はシルエットの「？」
  const art = owned && typeof cardArtSVG === "function"
    ? `<div class="at-art">${cardArtSVG(c)}</div>`
    : `<div class="at-icon">${owned ? cardIconOf(c) : "❔"}</div>`;
  return `<div class="album-tile rar-${rar} ${owned ? "" : "locked"}" title="${esc(owned ? rm.label + "／" + deckTip(c) : "未収集")}">
    <div class="at-rarity" style="color:${rm.color}">${rm.stars}</div>
    ${art}
    <div class="at-name">${owned ? esc(c.name) : "？？？"}</div>
    <div class="at-sub">${owned ? stats : ""}</div>
    ${owned ? `<div class="at-count">×${count}</div>` : ""}</div>`;
}
function showAlbum() {
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const owned = loadCollection().owned;
    const section = (title, cards) => `<h3 class="album-h">${title}</h3><div class="album-grid">` +
      cards.map(c => albumTile(c, owned[c.id] || 0)).join("") + `</div>`;
    let html = `<h2>📚 カードアルバム <span class="album-count">${distinctOwned()} / ${CARD_DB.length} 種 収集</span></h2>`;
    html += `<div class="album-scroll">`;
    Object.keys(ELEMENTS).forEach(e =>
      html += section(`${ELEMENTS[e].icon} ${ELEMENTS[e].name}属性クリーチャー`, CARD_DB.filter(c => c.type === "creature" && c.element === e)));
    html += section("⚔️ アイテム", CARD_DB.filter(c => c.type === "item"));
    html += section("✨ スペル", CARD_DB.filter(c => c.type === "spell"));
    html += `</div><div class="dlg-buttons"><button class="btn primary" data-value="close">閉じる</button></div>`;
    box.innerHTML = html;
    overlay.classList.add("show");
    box.querySelector("[data-value=close]").addEventListener("click", () => { overlay.classList.remove("show"); resolve(); });
  });
}

// ---------- デッキ構築画面 ----------
function showDeckBuilder() {
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const owned = loadCollection().owned;
    const ownedIds = Object.keys(owned).filter(id => owned[id] > 0 && CARD_BY_ID[id])
      .sort((a, b) => typeOrder(a) - typeOrder(b) || CARD_BY_ID[a].cost - CARD_BY_ID[b].cost);
    // 編集対象スロット（初期値＝使用中スロット）と作業用デッキ
    let slot = activeDeckSlot();
    let deck = (deckInSlot(slot) || []).filter(id => CARD_BY_ID[id]);
    const cnt = id => deck.filter(x => x === id).length;

    const render = () => {
      const v = deckValidity(deck);
      const active = activeDeckSlot();
      const slotTabs = Array.from({ length: DECK_SLOTS }, (_, i) => {
        const d = deckInSlot(i);
        const mark = i === active ? "✔" : "";
        return `<button class="btn small deck-slot ${i === slot ? "primary" : ""}" data-slot="${i}"
          title="${d ? `保存済み（${DECK_SIZE}枚）` : "未保存（空きスロット）"}${i === active ? "・対戦で使用中" : ""}">
          ${mark}デッキ${i + 1}${d ? "" : "（空）"}</button>`;
      }).join("");
      const poolHtml = ownedIds.map(id => {
        const c = CARD_BY_ID[id], avail = owned[id] - cnt(id);
        return `<div class="pool-item ${avail <= 0 ? "exhausted" : ""}" data-add="${id}" title="${esc(deckTip(c))}">
          <span class="pi-icon">${cardIconOf(c)}</span><span class="pi-name">${esc(c.name)}</span>
          <span class="pi-cost">${c.cost}G</span><span class="pi-have">残${avail}/${owned[id]}</span></div>`;
      }).join("");
      const dc = {}; deck.forEach(id => dc[id] = (dc[id] || 0) + 1);
      const deckHtml = Object.keys(dc).sort((a, b) => typeOrder(a) - typeOrder(b) || CARD_BY_ID[a].cost - CARD_BY_ID[b].cost)
        .map(id => { const c = CARD_BY_ID[id]; return `<div class="deck-item" data-remove="${id}" title="クリックで1枚外す">
          <span class="pi-icon">${cardIconOf(c)}</span><span class="pi-name">${esc(c.name)}</span>
          <span class="di-count">×${dc[id]}</span></div>`; }).join("")
        || `<div class="deck-empty">左の所持カードをクリックして追加</div>`;
      box.innerHTML = `<h2>🛠 デッキ構築 <span class="album-count">👤 ${esc(currentProfileName())}｜編集中: デッキ${slot + 1}｜${deck.length} / ${DECK_SIZE} 枚</span></h2>
        <div class="deck-slots">${slotTabs}</div>
        <p class="dlg-body">デッキは<b>5つまで保存</b>できます（✔＝対戦で使用中）。タブでスロットを切り替え（未保存の編集は破棄）、<b>保存するとそのデッキが使用中</b>になります。<br>
        左の所持カードをクリックで追加、右のデッキをクリックで外す。同名は${MAX_COPIES}枚まで／クリーチャーは${MIN_CREATURES}枚以上。</p>
        <div class="builder">
          <div class="builder-col"><div class="bc-title">📦 所持カード（${ownedIds.length}種）</div><div class="pool-list">${poolHtml}</div></div>
          <div class="builder-col"><div class="bc-title">🎴 デッキ（クリーチャー ${v.creatures}）</div><div class="deck-list">${deckHtml}</div></div>
        </div>
        <div class="builder-status ${v.ok ? "ok" : "ng"}">${v.ok ? "✅ 構築OK！ 保存できます" : "⚠ " + v.errors.join("／")}</div>
        <div class="dlg-buttons">
          <button class="btn" data-value="auto">🎲 おまかせ構築</button>
          <button class="btn" data-value="clear">全部外す</button>
          <button class="btn" data-value="cancel">保存せず戻る</button>
          <button class="btn primary" data-value="save" ${v.ok ? "" : "disabled"}>💾 デッキ${slot + 1}に保存して使用</button>
        </div>`;
      wire();
    };
    const wire = () => {
      box.querySelectorAll("[data-slot]").forEach(el => el.addEventListener("click", () => {
        slot = Number(el.dataset.slot);
        deck = (deckInSlot(slot) || []).filter(id => CARD_BY_ID[id]);
        render();
      }));
      box.querySelectorAll("[data-add]").forEach(el => el.addEventListener("click", () => {
        const id = el.dataset.add;
        if (deck.length >= DECK_SIZE || cnt(id) >= Math.min(MAX_COPIES, owned[id])) return;
        deck.push(id); render();
      }));
      box.querySelectorAll("[data-remove]").forEach(el => el.addEventListener("click", () => {
        const i = deck.lastIndexOf(el.dataset.remove); if (i >= 0) deck.splice(i, 1); render();
      }));
      box.querySelector("[data-value=auto]").addEventListener("click", () => { deck = autoBuildFromCollection(); render(); });
      box.querySelector("[data-value=clear]").addEventListener("click", () => { deck = []; render(); });
      box.querySelector("[data-value=cancel]").addEventListener("click", () => { overlay.classList.remove("show"); resolve(false); });
      const saveBtn = box.querySelector("[data-value=save]");
      if (saveBtn && !saveBtn.disabled) saveBtn.addEventListener("click", () => {
        if (!deckValidity(deck).ok) return;
        setPlayerDeck(deck, slot); overlay.classList.remove("show"); resolve(true);
      });
    };
    render();
    overlay.classList.add("show");
  });
}

// ---------- ♻️ カード工房（分解・生成） ----------
// 同名4枚目以降（MAX_COPIES=3を超える余剰分）を🔮マナの欠片に分解し、欠片で好きなカードを生成できる。
// レートは「同レア度なら4枚分解で1枚生成」（分解×4＝生成コスト）。アルバムのコンプリートの出口になる。
const SHARD_DISMANTLE = { common: 1, uncommon: 2, rare: 4, legendary: 8 };
const SHARD_CRAFT     = { common: 4, uncommon: 8, rare: 16, legendary: 32 };
function shardCount() { return loadCollection().shards || 0; }
function extraCopies(id) { return Math.max(0, ownedCount(id) - MAX_COPIES); }
// 余剰分から最大n枚を分解して欠片を得る。戻り値＝得た欠片数（分解できなければ0）
function dismantleCard(id, n = 1) {
  const c = loadCollection();
  const extra = Math.max(0, (c.owned[id] || 0) - MAX_COPIES);
  const take = Math.min(n, extra);
  if (take <= 0) return 0;
  c.owned[id] -= take;
  const gain = SHARD_DISMANTLE[cardRarity(CARD_BY_ID[id])] * take;
  c.shards = (c.shards || 0) + gain;
  saveCollection(c);
  return gain;
}
// 欠片を消費してカードを1枚生成。足りなければ false
function craftCard(id) {
  const c = loadCollection();
  const cost = SHARD_CRAFT[cardRarity(CARD_BY_ID[id])];
  if ((c.shards || 0) < cost) return false;
  c.shards -= cost;
  c.owned[id] = (c.owned[id] || 0) + 1;
  saveCollection(c);
  return true;
}

function showWorkshop() {
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const rarRank = c => RARITY_ORDER.indexOf(cardRarity(c));
    const render = () => {
      const col = loadCollection();
      const shards = col.shards || 0;
      // 分解: 余剰（4枚目以降）のあるカード
      const dis = CARD_DB.filter(c => (col.owned[c.id] || 0) > MAX_COPIES)
        .sort((a, b) => rarRank(a) - rarRank(b) || a.cost - b.cost);
      const totalGain = dis.reduce((s, c) => s + SHARD_DISMANTLE[cardRarity(c)] * (col.owned[c.id] - MAX_COPIES), 0);
      const disHtml = dis.length ? dis.map(c => {
        const rm = RARITY_META[cardRarity(c)];
        return `<div class="pool-item" data-dis="${c.id}" title="クリックで1枚分解（+${SHARD_DISMANTLE[cardRarity(c)]}🔮）">
          <span class="pi-icon">${cardIconOf(c)}</span>
          <span class="pi-name">${esc(c.name)} <span style="color:${rm.color}">${rm.stars}</span></span>
          <span class="pi-cost">+${SHARD_DISMANTLE[cardRarity(c)]}🔮</span>
          <span class="pi-have">余剰${col.owned[c.id] - MAX_COPIES}</span></div>`;
      }).join("") : `<div class="deck-empty">分解できる余剰カード（同名${MAX_COPIES + 1}枚目以降）はありません</div>`;
      // 生成: 全カード（未所持は NEW 表示＝アルバムのコンプリートの出口）
      const crHtml = CARD_DB.slice().sort((a, b) => rarRank(a) - rarRank(b) || a.cost - b.cost).map(c => {
        const cost = SHARD_CRAFT[cardRarity(c)];
        const have = col.owned[c.id] || 0;
        const rm = RARITY_META[cardRarity(c)];
        return `<div class="pool-item ${shards >= cost ? "" : "exhausted"}" data-craft="${c.id}" title="${esc(deckTip(c))}">
          <span class="pi-icon">${cardIconOf(c)}</span>
          <span class="pi-name">${esc(c.name)} <span style="color:${rm.color}">${rm.stars}</span>${have === 0 ? ` <b class="ws-new">NEW</b>` : ""}</span>
          <span class="pi-cost">${cost}🔮</span>
          <span class="pi-have">所持${have}</span></div>`;
      }).join("");
      box.innerHTML = `<h2>♻️ カード工房 <span class="album-count">🔮 マナの欠片: <b>${shards}</b></span></h2>
        <p class="dlg-body">同名<b>${MAX_COPIES + 1}枚目以降の余剰カード</b>（デッキには${MAX_COPIES}枚までしか入りません）を分解すると<b>🔮マナの欠片</b>になり、
        欠片で<b>好きなカードを生成</b>できます — 未所持カードも作れるので<b>アルバムのコンプリート</b>にも！<br>
        分解: ★+1 ／ ★★+2 ／ ★★★+4 ／ ★★★★+8　→　生成: ★4 ／ ★★8 ／ ★★★16 ／ ★★★★32（同レア度4枚分解＝1枚生成）</p>
        <div class="builder">
          <div class="builder-col"><div class="bc-title">🔨 分解（余剰 ${dis.length}種）</div><div class="pool-list">${disHtml}</div>
            ${dis.length ? `<button class="btn small ws-all" data-value="disall">🔨 余剰をまとめて分解（+${totalGain}🔮）</button>` : ""}</div>
          <div class="builder-col"><div class="bc-title">✨ 生成（全 ${CARD_DB.length}種）</div><div class="pool-list">${crHtml}</div></div>
        </div>
        <div class="dlg-buttons"><button class="btn primary" data-value="close">閉じる</button></div>`;
      box.querySelectorAll("[data-dis]").forEach(el => el.addEventListener("click", () => {
        if (dismantleCard(el.dataset.dis, 1) > 0) SFX.hit();
        render();
      }));
      box.querySelectorAll("[data-craft]").forEach(el => el.addEventListener("click", () => {
        if (craftCard(el.dataset.craft)) { SFX.summon(); render(); }
      }));
      const allBtn = box.querySelector("[data-value=disall]");
      if (allBtn) allBtn.addEventListener("click", () => {
        CARD_DB.forEach(c => dismantleCard(c.id, 999));
        SFX.coin();
        render();
      });
      box.querySelector("[data-value=close]").addEventListener("click", () => { overlay.classList.remove("show"); resolve(); });
    };
    render();
    overlay.classList.add("show");
  });
}

// ---------- 🎮 2人対戦（ホットシート）のセットアップ ----------
// 1P（青）・2P（赤）に使うプレイヤープロファイルを選ぶ。戻り値 {p0, p1}（キャンセルなら null）
async function showVersusSetup() {
  const pickOne = (title, note, exclude) => new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const prof = loadProfiles();
    const rows = prof.names.map((name, i) => {
      if (i === exclude) return "";
      const st = profileStats(i);
      const deck = getPlayerDeckFor(i);
      const info = (st.hasData ? `カード ${st.cards}種` : "新規") +
        `｜デッキ: ${deck ? "🛠 構築デッキ" : "🎲 おまかせ（自動）"}`;
      return `<button class="stage-btn" data-prof="${i}">
        <span class="st-icon">👤</span>
        <span class="st-main"><b>${esc(name)}</b><small>${info}</small></span>
        <span class="st-star"></span>
      </button>`;
    }).join("");
    box.innerHTML = `<h2>${title}</h2>
      <p class="dlg-body">${note}<br>それぞれのプレイヤーは自分の<b>使用中デッキ</b>（未構築ならおまかせデッキ）で戦います。</p>
      <div class="stage-list">${rows}</div>
      <div class="dlg-buttons"><button class="btn" data-value="back">← 戻る</button></div>`;
    overlay.classList.add("show");
    box.querySelectorAll("[data-prof]").forEach(btn => btn.addEventListener("click", () => {
      overlay.classList.remove("show");
      resolve(Number(btn.dataset.prof));
    }));
    box.querySelector("[data-value=back]").addEventListener("click", () => { overlay.classList.remove("show"); resolve(null); });
  });
  const p0 = await pickOne("🎮 2人対戦 — 🔵 1P を選択", "同じ端末で交互に操作する<b>人間同士の対戦</b>です（報酬・進行度は変化しません）。");
  if (p0 === null) return null;
  const p1 = await pickOne("🎮 2人対戦 — 🔴 2P を選択", `🔵 1P: <b>${esc(profileName(p0))}</b>。対戦相手のプレイヤーを選んでください。`, p0);
  if (p1 === null) return null;
  return { p0, p1 };
}

// ---------- プレイヤー選択（5人がコレクション・デッキ・進行度を別々に持てる） ----------
// 各プロファイルの概況（現在プロファイルに依存せず生キーを直接読む）
function profileStats(i) {
  const ck = i === 0 ? COLLECTION_KEY : `${COLLECTION_KEY}-p${i + 1}`;
  const pk = i === 0 ? PROGRESS_KEY : `${PROGRESS_KEY}-p${i + 1}`;
  let cards = 0, cleared = 0, hasData = false;
  try {
    const c = JSON.parse(localStorage.getItem(ck));
    if (c && c.owned) { hasData = true; cards = Object.keys(c.owned).filter(id => c.owned[id] > 0 && CARD_BY_ID[id]).length; }
  } catch (e) { /* 無視 */ }
  try {
    const p = JSON.parse(localStorage.getItem(pk));
    if (p && p.cleared) cleared = Object.keys(p.cleared).filter(k => p.cleared[k]).length;
  } catch (e) { /* 無視 */ }
  return { cards, cleared, hasData };
}

function showProfilePicker() {
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const render = () => {
      const prof = loadProfiles();
      const rows = prof.names.map((name, i) => {
        const st = profileStats(i);
        const info = st.hasData
          ? `カード ${st.cards}/${CARD_DB.length}種 ・ クリア ${st.cleared}/${STAGES.length}面`
          : "まだ遊んでいません（新規）";
        return `<div class="profile-row">
          <button class="stage-btn ${i === prof.current ? "diff-current" : ""}" data-prof="${i}">
            <span class="st-icon">👤</span>
            <span class="st-main"><b>${esc(name)}${i === prof.current ? "（使用中）" : ""}</b><small>${info}</small></span>
            <span class="st-star">${i === prof.current ? "✔" : ""}</span>
          </button>
          <button class="btn small" data-rename="${i}" title="このプレイヤーの名前を変更">✎</button>
        </div>`;
      }).join("");
      box.innerHTML = `<h2>👤 プレイヤー選択</h2>
        <p class="dlg-body">${PROFILE_COUNT}人までが<b>別々のコレクション・デッキ（各5つ）・ステージ進行度</b>で遊べます。プレイヤーを選んでください。</p>
        <div class="stage-list">${rows}</div>
        <div class="dlg-buttons"><button class="btn primary" data-value="back">← 戻る</button></div>`;
      box.querySelectorAll("[data-prof]").forEach(btn => btn.addEventListener("click", () => {
        setCurrentProfile(Number(btn.dataset.prof));
        overlay.classList.remove("show");
        resolve();
      }));
      box.querySelectorAll("[data-rename]").forEach(btn => btn.addEventListener("click", () => {
        const i = Number(btn.dataset.rename);
        const nm = prompt("新しい名前（12文字まで）", profileName(i));
        if (nm !== null) renameProfile(i, nm);
        render();
      }));
      box.querySelector("[data-value=back]").addEventListener("click", () => { overlay.classList.remove("show"); resolve(); });
    };
    render();
    overlay.classList.add("show");
  });
}

// ---------- 捨てカード確認（対戦中・両者の捨札を見る） ----------
// 山札が尽きると drawCard が捨札を切り直して山札に戻す（そのときはログで合図する）。
function showDiscardViewer() {
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const section = p => {
      const counts = {};
      (p.discard || []).forEach(id => { if (CARD_BY_ID[id]) counts[id] = (counts[id] || 0) + 1; });
      const ids = Object.keys(counts).sort((a, b) => typeOrder(a) - typeOrder(b) || CARD_BY_ID[a].cost - CARD_BY_ID[b].cost);
      const list = ids.length
        ? ids.map(id => { const c = CARD_BY_ID[id]; return `<div class="disc-item" title="${esc(deckTip(c))}">
            <span class="pi-icon">${cardIconOf(c)}</span><span class="pi-name">${esc(c.name)}</span><span class="di-count">×${counts[id]}</span></div>`; }).join("")
        : `<div class="deck-empty">捨札はまだありません</div>`;
      return `<div class="builder-col">
        <div class="bc-title" style="color:${PLAYER_COLORS[p.id]}">${P_ICONS[p.id]} ${esc(p.name)}｜山札 ${p.deck.length} ／ 捨札 ${p.discard.length}</div>
        <div class="deck-list">${list}</div></div>`;
    };
    box.innerHTML = `<h2>🗑 捨てカード確認</h2>
      <p class="dlg-body">全員の捨札（使用済み・失ったカード）の一覧です。<b>山札が尽きると捨札を切り直して山札に戻り</b>、そのときはログ（📜）で「🔀 山札が一巡！」と合図します。</p>
      <div class="builder">${G.players.map(section).join("")}</div>
      <div class="dlg-buttons"><button class="btn primary" data-value="close">閉じる</button></div>`;
    overlay.classList.add("show");
    box.querySelector("[data-value=close]").addEventListener("click", () => { overlay.classList.remove("show"); resolve(); });
  });
}

// ---------- カード獲得の演出（パック開封 → 1枚ずつめくる） ----------
// ① 封のされたカードパックをクリックで開封（封が弾け飛ぶ）
// ② 全カードが表紙（カードバック）側で並び、クリックで1枚ずつめくる（🃏全てめくるも可）
// ③ レア以上はめくった瞬間に光の演出、初入手のカードには NEW リボン
function showPackReveal(cardIds, title, sub) {
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    // addCards は既に適用済みなので「現在の所持数 == このパック内の枚数」なら今回が初入手
    const packCount = {};
    cardIds.forEach(id => { packCount[id] = (packCount[id] || 0) + 1; });
    const isNew = id => ownedCount(id) === packCount[id];
    let opened = false;

    const cardsHTML = cardIds.map(id => {
      const c = CARD_BY_ID[id];
      const badge = isNew(id) ? `<span class="pr-new">NEW</span>` : "";
      return `<div class="pr-slot" data-rar="${cardRarity(c)}" title="クリックでめくる">${flipCardHTML(c, { badge })}</div>`;
    }).join("");

    // ② めくりフェーズ
    const renderCards = allRevealed => {
      box.innerHTML = `<h2>${esc(title)}</h2>
        <p class="dlg-body">${esc(sub || "新しいカードを手に入れた！")}${allRevealed ? "" : " — <b>カードをクリックしてめくろう！</b>"}</p>
        <div class="pack-reveal">${cardsHTML}</div>
        <div class="dlg-buttons">
          <button class="btn" data-value="flipall">🃏 全てめくる</button>
          <button class="btn primary" data-value="ok">受け取る</button>
        </div>`;
      const slots = [...box.querySelectorAll(".pr-slot")];
      const reveal = slot => {
        const f = slot.querySelector(".flip3d");
        if (f.classList.contains("revealed")) return;
        f.classList.add("revealed");
        const rar = slot.dataset.rar;
        SFX.reveal(rar);
        if (rar === "rare" || rar === "legendary") slot.classList.add(`pr-glow-${rar}`);
      };
      const flipAll = async () => { for (const s of slots) { if (!s.querySelector(".flip3d").classList.contains("revealed")) { reveal(s); await sleep(100); } } };
      if (allRevealed) slots.forEach(reveal);
      slots.forEach(slot => slot.addEventListener("click", () => reveal(slot)));
      box.querySelector("[data-value=flipall]").addEventListener("click", flipAll);
      box.querySelector("[data-value=ok]").addEventListener("click", async () => {
        await flipAll(); // 伏せたまま受け取ろうとしたら、見せてから閉じる
        overlay.classList.remove("show");
        resolve();
      });
    };

    // ① 開封フェーズ
    box.innerHTML = `<h2>${esc(title)}</h2>
      <p class="dlg-body">${esc(sub || "新しいカードを手に入れた！")}</p>
      <div class="pack-stage">
        <button class="pack-btn" title="クリックで開封">${typeof PACK_SVG !== "undefined" ? PACK_SVG : "🎁"}</button>
        <div class="pack-hint">✨ パックをクリックして開封！（${cardIds.length}枚入り）</div>
      </div>
      <div class="dlg-buttons"><button class="btn" data-value="skipall">⏩ 開封してすべて表示</button></div>`;
    overlay.classList.add("show");
    if (typeof SFX !== "undefined" && SFX.coin) SFX.coin();
    box.querySelector(".pack-btn").addEventListener("click", async e => {
      if (opened) return;
      opened = true;
      SFX.pack();
      e.currentTarget.classList.add("burst");
      await sleep(560);
      renderCards(false);
    });
    box.querySelector("[data-value=skipall]").addEventListener("click", () => {
      if (opened) return;
      opened = true;
      SFX.pack();
      renderCards(true);
    });
  });
}
