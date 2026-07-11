// ============================================================
// ui.js — 描画とユーザー入力（盤面SVG / パネル / 手札 / ログ / ダイアログ）
// ============================================================
"use strict";

const UI = {};
UI.selectableTiles = null; // 盤面で選択候補として光らせるマスidの Set（領地・クリーチャー選択中）
// 決定待ちのダイアログ数。「👁 盤面を確認」でオーバーレイを一時的に閉じている間も 1 のまま。
// これが 0 でないときにヘルプ/捨札/マス情報など別のダイアログを開くと、保留中のダイアログが
// 上書きされて Promise が永遠に解決されず進行が止まる（実際に起きたフリーズバグ）ため、開く側は必ず確認する。
UI.dialogBusy = 0;
// 受け身ダイアログ（🔍マス情報など・ゲーム進行と無関係なもの）を閉じる関数。
// 進行フロー側の新しいダイアログが開くとき、開きっぱなしの受け身ダイアログを自動で閉じて
// 上書き（＝Promise未解決・busyカウンタずれ）を防ぐ。
UI._passiveClose = null;
function closePassiveDialog() {
  if (UI._passiveClose) { const f = UI._passiveClose; UI._passiveClose = null; f(); }
}
function setSelectableTiles(ids) { UI.selectableTiles = ids instanceof Set ? ids : new Set(ids); }
function clearSelectableTiles() { UI.selectableTiles = null; }
const PLAYER_COLORS = ["#4da3ff", "#ff5b5b"];
const CELL = 100, TILE = 90;

// 演出速度の倍率。トレーニングでは小さくして時短にする（startGameで設定）
let GAME_SPEED = 1;
function sleep(ms) { return new Promise(r => setTimeout(r, ms * GAME_SPEED)); }

const TILE_ICONS = { CASTLE: "🏰", GATE: "⛩️", CARD: "🎴", MAGIC: "💎", WARP: "🌀", MAGMA: "🌋", BOOST: "💨" };
const TILE_LABELS = { CASTLE: "城", GATE: "関門", CARD: "カード", MAGIC: "魔力", WARP: "ワープ", MAGMA: "マグマ", BOOST: "疾風" };

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// クリーチャーと土地の属性関係の注記（ダイアログ用）。無属性は一致も不一致もしない（土地の加護なし）
function elemNote(card, tile) {
  if (card.element === "neutral") return "・<b>無属性</b>（土地の加護なし）";
  return card.element !== tile.element ? "・<b>属性不一致</b>" : "・属性一致";
}

// ---------- 盤面 ----------
function tilePx(tile) { return { x: tile.x * CELL + 5, y: tile.y * CELL + 5 }; }

function renderBoard(g) {
  const svg = document.getElementById("board");
  let html = "";
  g.tiles.forEach(tile => {
    const { x, y } = tilePx(tile);
    const isLand = tile.type === "LAND";
    const fill = isLand ? ELEMENTS[tile.element].color + "33"
      : tile.type === "MAGMA" ? "#5a2418"
      : "#2a2438";
    const stroke = tile.owner !== null ? PLAYER_COLORS[tile.owner] : "#5a5470";
    const sw = tile.owner !== null ? 4 : 1.5;
    html += `<g class="tile" data-tile="${tile.id}">`;
    html += `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (isLand) {
      // 土地の属性は「左上コーナーの角丸チップ」で表示（＝土地の属性だと分かる位置）
      html += `<rect x="${x + 4}" y="${y + 4}" width="26" height="22" rx="6" fill="${ELEMENTS[tile.element].color}cc"/>`;
      html += `<text x="${x + 17}" y="${y + 20}" font-size="15" text-anchor="middle">${ELEMENTS[tile.element].icon}</text>`;
      html += `<text x="${x + TILE - 7}" y="${y + 20}" font-size="14" fill="#cfc9e0" text-anchor="end" font-weight="bold">Lv${tile.level}</text>`;
      // レベルを数字だけでなく「5段階のピップ・メーター」でも表示（一目で強さが分かるように）
      const PIP_N = LAND_VALUE.length, pipGap = 9, pipR = 3.4;
      const pipStartX = x + TILE / 2 - (PIP_N - 1) * pipGap / 2, pipY = y + 31;
      for (let lv = 1; lv <= PIP_N; lv++) {
        const px = pipStartX + (lv - 1) * pipGap;
        const on = lv <= tile.level;
        html += `<circle cx="${px}" cy="${pipY}" r="${pipR}" fill="${on ? "#ffd76a" : "#453f5c"}"${on ? ' stroke="#8a6a12" stroke-width="0.6"' : ""}/>`;
      }
      if (tile.creature) {
        const c = CARD_BY_ID[tile.creature.cardId];
        const ce = ELEMENTS[c.element];
        const cur = tile.creature.hp ?? c.hp;
        const wounded = cur < c.hp;
        const hpStr = wounded ? `${cur}/${c.hp}` : `${c.hp}`;
        const hpFill = wounded ? "#ff8a6a" : "#ffe08a"; // 傷ついていれば赤み
        const cx = x + TILE / 2;
        // クリーチャーの属性は「丸いバッジ」で表示（＝コマ＝クリーチャーの属性。土地チップと形で区別）
        html += `<circle cx="${x + 15}" cy="${y + 46}" r="11" fill="${ce.color}" stroke="#fff" stroke-width="1.5"/>`;
        html += `<text x="${x + 15}" y="${y + 50}" font-size="12" text-anchor="middle">${ce.icon}</text>`;
        html += `<text x="${cx + 9}" y="${y + 44}" font-size="12" fill="#fff" text-anchor="middle" font-weight="bold">${esc(c.name.slice(0, 5))}</text>`;
        // ST（小）＋ HP（大きく・読みやすく）
        html += `<text x="${cx}" y="${y + 66}" text-anchor="middle">` +
          `<tspan font-size="12" fill="#c9c2da">ST${c.st}</tspan>` +
          `<tspan font-size="17" font-weight="bold" fill="${hpFill}"> HP${hpStr}</tspan></text>`;
      }
      if (tile.owner !== null) {
        const toll = tollOf(g, tile);
        html += `<text x="${x + TILE / 2}" y="${y + TILE - 5}" font-size="13" fill="${PLAYER_COLORS[tile.owner]}" text-anchor="middle" font-weight="bold">${toll}G</text>`;
      }
    } else {
      html += `<text x="${x + TILE / 2}" y="${y + 45}" font-size="30" text-anchor="middle">${TILE_ICONS[tile.type]}</text>`;
      html += `<text x="${x + TILE / 2}" y="${y + 70}" font-size="12" fill="#b8b2cc" text-anchor="middle">${TILE_LABELS[tile.type]}</text>`;
    }
    // 盤面エフェクト（🌋溶岩/🛡️結界/💨追い風）のバッジ
    const ov = overlayOf(g, tile);
    if (ov) {
      const ovIcon = ov.kind === "sanctuary" ? "🛡️" : ov.kind === "snare" ? "🕸️" : "✨";
      const ovColor = ov.kind === "sanctuary" ? "#8ecbff" : ov.kind === "snare" ? "#c9a0ff" : "#ddd";
      html += `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" rx="10" fill="none" stroke="${ovColor}" stroke-width="3" stroke-dasharray="7 5" opacity="0.9"/>`;
      html += `<text x="${x + TILE / 2}" y="${y + 16}" font-size="15" text-anchor="middle">${ovIcon}</text>`;
    }
    // 分かれ道の矢印（進める方向を示す）
    if (tile.next.length > 1) {
      tile.next.forEach(nid => {
        const nt = g.tiles[nid];
        const dx = Math.sign(nt.x - tile.x), dy = Math.sign(nt.y - tile.y);
        const cx2 = x + TILE / 2 + dx * (TILE / 2 - 2);
        const cy2 = y + TILE / 2 + dy * (TILE / 2 - 2);
        // 先端 + 垂直方向に開いた底辺の三角形
        const tipX = cx2 + dx * 7, tipY = cy2 + dy * 7;
        const b1X = cx2 - dx * 4 - dy * 6, b1Y = cy2 - dy * 4 - dx * 6;
        const b2X = cx2 - dx * 4 + dy * 6, b2Y = cy2 - dy * 4 + dx * 6;
        html += `<polygon points="${tipX},${tipY} ${b1X},${b1Y} ${b2X},${b2Y}" fill="#ffd76a" opacity="0.9"/>`;
      });
    }
    // マスの通し番号（常時表示）。領地・クリーチャー選択の選択肢と盤面を対応づけるための目印
    html += `<text x="${x + 6}" y="${y + TILE - 6}" font-size="10" fill="#9a92b5" text-anchor="start">#${tile.id}</text>`;
    // 選択対象マスの強調（スペル対象／領地売却／侵攻先など）。盤面から直接クリックして選べる
    if (UI.selectableTiles && UI.selectableTiles.has(tile.id)) {
      html += `<rect x="${x - 2}" y="${y - 2}" width="${TILE + 4}" height="${TILE + 4}" rx="12" fill="none" stroke="#ffe066" stroke-width="5"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></rect>`;
      html += `<rect x="${x + TILE / 2 - 19}" y="${y + TILE / 2 - 15}" width="38" height="28" rx="8" fill="#ffe066" opacity="0.96"/>`;
      html += `<text x="${x + TILE / 2}" y="${y + TILE / 2 + 6}" font-size="18" fill="#1a1526" text-anchor="middle" font-weight="bold">#${tile.id}</text>`;
    }
    html += `</g>`;
  });
  // プレイヤー駒
  g.players.forEach(p => {
    if (!p.alive) return;
    const { x, y } = tilePx(g.tiles[p.pos]);
    const off = p.id === 0 ? { dx: 20, dy: -8 } : { dx: TILE - 20, dy: -8 };
    html += `<g class="token">`;
    html += `<circle cx="${x + off.dx}" cy="${y + off.dy}" r="13" fill="${PLAYER_COLORS[p.id]}" stroke="#fff" stroke-width="2"/>`;
    html += `<text x="${x + off.dx}" y="${y + off.dy + 5}" font-size="13" fill="#fff" text-anchor="middle" font-weight="bold">${g.hotseat ? p.id + 1 : (p.id === 0 ? "P" : "C")}</text>`;
    html += `</g>`;
  });
  svg.innerHTML = html;
}

// ---------- プレイヤーパネル ----------
function renderPanels(g) {
  g.players.forEach(p => {
    const el = document.getElementById(`panel-${p.id}`);
    const assets = assetsOf(g, p);
    const chains = Object.keys(ELEMENTS)
      .map(e => ({ e, n: chainCount(g, p.id, e) }))
      .filter(c => c.n > 0)
      .map(c => `${ELEMENTS[c.e].icon}${c.n}`).join(" ") || "－";
    const needed = gatesNeededOf(g);
    const gates = "●".repeat(Math.min(p.gates.size, needed)) + "○".repeat(Math.max(0, needed - p.gates.size));
    el.classList.toggle("active", g.current === p.id && !g.over);
    el.classList.toggle("dead", !p.alive);
    el.innerHTML = `
      <div class="p-name" style="color:${PLAYER_COLORS[p.id]}">${p.id === 0 ? "🔵" : "🔴"} ${esc(p.name)}</div>
      <div class="p-row"><span>魔力</span><b>${p.magic}G</b></div>
      <div class="p-row big"><span>総資産</span><b>${assets}G / ${RULES.target}G</b></div>
      <div class="p-bar"><div style="width:${Math.min(100, assets / RULES.target * 100)}%; background:${PLAYER_COLORS[p.id]}"></div></div>
      <div class="p-row"><span>連鎖</span><b>${chains}</b></div>
      <div class="p-row"><span>関門 ${gates}</span><span>周回 ${p.laps} / 山札 ${p.deck.length}</span></div>
    `;
  });
  const diff = DIFFICULTIES[loadDifficulty()];
  const mode = g.hotseat ? "🎮 2人対戦" : `難易度 ${diff.icon}${diff.label}`;
  document.getElementById("round-info").textContent =
    `${g.stage.icon} STAGE ${g.stageIdx + 1}｜ラウンド ${Math.min(g.round, RULES.maxRounds)} / ${RULES.maxRounds}｜${mode}` +
    (g.weekly ? `｜🎪 ${g.weekly.name}` : "");
}

// ---------- 手札 ----------
function cardHTML(c, opts = {}) {
  const typeCls = c.type === "creature" ? `el-${c.element}` : c.type;
  const rar = cardRarity(c);
  const cls = ["card", typeCls, `rar-${rar}`];
  if (opts.disabled) cls.push("disabled");
  if (opts.selectable) cls.push("selectable");
  const abil = (c.ab || []).map(a => `<span class="ab">${ABILITY_INFO[a].name}</span>`).join("");
  const body = c.type === "creature"
    ? `<div class="c-stats">ST ${c.st} / HP ${c.hp}</div><div class="c-ab">${abil}</div>`
    : `<div class="c-desc">${esc(c.desc)}</div>`;
  const icon = c.icon || (c.type === "creature" ? ELEMENTS[c.element].icon
    : c.type === "item" ? (c.st > 0 ? "⚔️" : "🛡️") : "✨");
  const rm = RARITY_META[rar];
  return `<div class="${cls.join(" ")}" data-card="${c.id}" title="${esc(c.type === 'spell' ? c.desc : (c.ab || []).map(a => ABILITY_INFO[a].name + ': ' + ABILITY_INFO[a].desc).join(' / '))}">
    <div class="c-head"><span class="c-icon">${icon}</span><span class="c-cost">${c.cost}G</span></div>
    <div class="c-name">${esc(c.name)}</div>${body}
    <div class="c-rarity" style="color:${rm.color}" title="${rm.label}">${rm.stars}</div></div>`;
}

function renderHand(g) {
  // 通常はプレイヤー0（人間）の手札。2人対戦（ホットシート）では手番プレイヤーの手札を表示する
  const p = g.players[g.hotseat ? g.current : 0];
  const el = document.getElementById("hand");
  if (g.hotseat && UI.handHidden) {
    // 手番交代画面の間は伏せて、次のプレイヤーの手札が前のプレイヤーに見えないようにする
    el.innerHTML = p.hand.map(() => `<div class="card facedown" title="交代中は伏せられています">🎴</div>`).join("");
  } else {
    el.innerHTML = p.hand.map(id => cardHTML(CARD_BY_ID[id])).join("");
  }
  document.getElementById("hand-count").textContent =
    (g.hotseat ? `${p.name}の` : "") + `手札 ${p.hand.length}/${HAND_LIMIT}`;
}

function renderAll(g) { renderBoard(g); renderPanels(g); renderHand(g); }

// ---------- 盤面ズーム（拡大縮小して読みやすく） ----------
let BOARD_ZOOM = 1;
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.6, ZOOM_STEP = 0.2;
function applyZoom() {
  const svg = document.getElementById("board");
  if (svg) svg.style.setProperty("--zoom", BOARD_ZOOM.toFixed(2));
  const lbl = document.getElementById("zoom-label");
  if (lbl) lbl.textContent = `${Math.round(BOARD_ZOOM * 100)}%`;
}
function zoomBoard(delta) {
  BOARD_ZOOM = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(BOARD_ZOOM + delta).toFixed(2)));
  applyZoom();
}
function resetZoom() { BOARD_ZOOM = 1; applyZoom(); }

// ---------- 固定フローティングウィンドウ（ステータス／ログ／手札） ----------
// 盤面をスクロールしても常に見える固定ウィンドウ。各ウィンドウは「✕」で一時的に隠せ、
// 隠すと画面右下の再表示チップから戻せる。
const HUD_WINDOWS = [
  { id: "win-p0",   chip: "🔵 あなた" },
  { id: "win-p1",   chip: "🔴 相手" },
  { id: "win-log",  chip: "📜 ログ" },
  { id: "win-hand", chip: "🃏 手札" },
];
function renderHudTabs() {
  const tabs = document.getElementById("hud-tabs");
  if (!tabs) return;
  tabs.innerHTML = HUD_WINDOWS
    .filter(w => { const el = document.getElementById(w.id); return el && el.classList.contains("hidden"); })
    .map(w => `<button class="hud-tab" data-win="${w.id}">${w.chip}</button>`).join("");
  tabs.querySelectorAll(".hud-tab").forEach(btn => btn.addEventListener("click", () => {
    const win = document.getElementById(btn.dataset.win);
    if (win) { win.classList.remove("hidden"); renderHudTabs(); }
  }));
}
function initHudWindows() {
  HUD_WINDOWS.forEach(w => {
    const win = document.getElementById(w.id);
    if (!win) return;
    const closeBtn = win.querySelector(".win-close");
    if (closeBtn) closeBtn.addEventListener("click", () => { win.classList.add("hidden"); renderHudTabs(); });
  });
  renderHudTabs();
}

// ---------- ログ ----------
function log(msg, cls = "") {
  const el = document.getElementById("log");
  const div = document.createElement("div");
  div.className = `log-line ${cls}`;
  div.textContent = msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ---------- メッセージ（中央の大きな表示） ----------
function setMessage(msg) {
  document.getElementById("message").textContent = msg;
}

// ---------- 汎用ダイアログ（Promiseベース） ----------
// opts: { title, body?, cards?: [{card, disabled, note}], buttons: [{label, value, primary}], peek? }
// peek:true を渡すと「👁 盤面を確認」ボタンが付き、決定を保留したまま一旦閉じて盤面/手札を見られる
// 解決値: { action: value } または { action: "card", cardId }
function showDialog(opts) {
  return new Promise(resolve => {
    closePassiveDialog(); // 開きっぱなしの受け身ダイアログ（🔍マス情報など）は自動で閉じる
    UI.dialogBusy++;
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const restoreBtn = document.getElementById("peek-restore");
    let html = `<h2>${esc(opts.title)}</h2>`;
    if (opts.body) html += `<p class="dlg-body">${opts.body}</p>`;
    if (opts.cards && opts.cards.length) {
      html += `<div class="dlg-cards">` +
        opts.cards.map(ci => cardHTML(ci.card, { disabled: ci.disabled, selectable: !ci.disabled })).join("") +
        `</div>`;
    }
    html += `<div class="dlg-buttons">`;
    if (opts.peek) html += `<button class="btn dlg-peek" data-peek="1" title="このウインドウを一旦閉じて盤面・手札を確認します（選択はそのまま保留されます）">👁 盤面を確認</button>`;
    html += opts.buttons.map(b => `<button class="btn ${b.primary ? "primary" : ""}" data-value="${esc(b.value)}">${esc(b.label)}</button>`).join("") +
      `</div>`;
    box.innerHTML = html;
    overlay.classList.add("show");

    // 「👁 盤面を確認」: ダイアログを一旦隠し、フローティングの「選択に戻る」ボタンを出す（決定は保留）
    const clearPeek = () => { restoreBtn.classList.add("hidden"); restoreBtn.onclick = null; };
    const peek = () => {
      overlay.classList.remove("show");
      restoreBtn.classList.remove("hidden");
      restoreBtn.onclick = () => { overlay.classList.add("show"); clearPeek(); };
    };
    const close = result => {
      if (opts.passive && UI._passiveClose === closeSelf) UI._passiveClose = null;
      UI.dialogBusy = Math.max(0, UI.dialogBusy - 1);
      overlay.classList.remove("show");
      clearPeek();
      resolve(result);
    };
    const closeSelf = () => close({ action: "dismiss" });
    if (opts.passive) UI._passiveClose = closeSelf; // 受け身ダイアログとして登録（後続のダイアログが自動で閉じられる）
    const peekBtn = box.querySelector("[data-peek]");
    if (peekBtn) peekBtn.addEventListener("click", peek);
    box.querySelectorAll(".dlg-cards .card.selectable").forEach(cardEl => {
      cardEl.addEventListener("click", () => close({ action: "card", cardId: cardEl.dataset.card }));
    });
    box.querySelectorAll(".dlg-buttons .btn:not(.dlg-peek)").forEach(btn => {
      btn.addEventListener("click", () => close({ action: btn.dataset.value }));
    });
  });
}

// ---------- 盤面から選べるタイルピッカー（領地・クリーチャー選択） ----------
// 候補マスを盤面で光らせ、①ダイアログのボタン ②「👁 盤面から選ぶ」→光ったマスを直接クリック、
// のどちらでも選べる。どのマスを指しているかは #番号（盤面＆ボタン）で対応づく。
// candidates: tile配列 / opts: { title, body, labelFn(tile)->string, cancelable?, cancelLabel? }
// 解決値: 選んだ tile（キャンセルなら null）
function humanPickTileOnMap(candidates, opts) {
  return new Promise(resolve => {
    closePassiveDialog(); // 開きっぱなしの受け身ダイアログは自動で閉じる
    UI.dialogBusy++;
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const restoreBtn = document.getElementById("peek-restore");
    const svg = document.getElementById("board");
    const ids = new Set(candidates.map(t => t.id));
    setSelectableTiles(ids);
    renderBoard(G);

    const onBoardClick = e => {
      const gEl = e.target.closest && e.target.closest(".tile");
      if (!gEl) return;
      const id = Number(gEl.dataset.tile);
      if (ids.has(id)) finish(G.tiles[id]);
    };
    function finish(tile) {
      UI.dialogBusy = Math.max(0, UI.dialogBusy - 1);
      svg.removeEventListener("click", onBoardClick);
      restoreBtn.classList.add("hidden");
      restoreBtn.onclick = null;
      clearSelectableTiles();
      overlay.classList.remove("show");
      renderBoard(G);
      resolve(tile);
    }
    const peek = () => {
      overlay.classList.remove("show");
      restoreBtn.classList.remove("hidden");
      restoreBtn.textContent = "▲ 選択ウインドウに戻る";
      restoreBtn.onclick = () => { overlay.classList.add("show"); restoreBtn.classList.add("hidden"); };
    };

    let html = `<h2>${esc(opts.title)}</h2>`;
    html += `<p class="dlg-body">${opts.body}<br>🖱 <b>盤面で光っているマス（#番号）を直接クリック</b>しても選べます（「👁 盤面から選ぶ」で盤面へ）。</p>`;
    html += `<div class="dlg-buttons">`;
    html += `<button class="btn dlg-peek" data-peek="1" title="盤面を表示して、光っているマスを直接クリックで選べます">👁 盤面から選ぶ</button>`;
    html += candidates.map(t => `<button class="btn" data-id="${t.id}">${opts.labelFn(t)}</button>`).join("");
    if (opts.cancelable) html += `<button class="btn" data-cancel="1">${esc(opts.cancelLabel || "やめる")}</button>`;
    html += `</div>`;
    box.innerHTML = html;
    overlay.classList.add("show");

    box.querySelector("[data-peek]").addEventListener("click", peek);
    box.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => finish(G.tiles[Number(b.dataset.id)])));
    const cancelBtn = box.querySelector("[data-cancel]");
    if (cancelBtn) cancelBtn.addEventListener("click", () => finish(null));
    svg.addEventListener("click", onBoardClick);
  });
}

// ---------- ステージ選択画面 ----------
// opts.training: トレーニング（練習対戦）モードのステージ選択
// opts.versus:   2人対戦のステージ選択 {names:[1P名, 2P名]}（全ステージ選択可）
// 解決値: ステージ index（数値）／ "help" / "album" / "deck" / "training" / "versus" / "workshop" / "weekly" / "back"
function showStageSelect(opts = {}) {
  const training = !!opts.training;
  const versus = opts.versus || null;
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const prog = loadProgress();
    const rows = STAGES.map((s, i) => {
      const unlocked = versus || isStageUnlocked(i); // 2人対戦は全ステージから選べる
      const cleared = !!prog.cleared[s.id];
      const desc = unlocked
        ? `${versus ? "" : `VS ${esc(s.cpuName)}｜`}${buildBoard(s).length}マス｜目標 ${((s.rules && s.rules.target) || 4000)}G<br>${esc(s.desc)}`
        : "？？？（前のステージをクリアで解放）";
      return `<button class="stage-btn ${unlocked ? "" : "locked"}" data-idx="${i}" ${unlocked ? "" : "disabled"}>
        <span class="st-icon">${unlocked ? s.icon : "🔒"}</span>
        <span class="st-main"><b>STAGE ${i + 1}｜${unlocked ? esc(s.name) : "？？？"}</b><small>${desc}</small></span>
        <span class="st-star">${cleared ? "⭐" : ""}</span>
      </button>`;
    }).join("");
    const diff = DIFFICULTIES[loadDifficulty()];
    const streak = (typeof trainingStreakCount === "function") ? trainingStreakCount() : 0;
    const wr = currentWeeklyRule();
    const wOn = weeklyEnabled();
    const header = versus
      ? `<h2>🎮 2人対戦 — ステージ選択</h2><p class="dlg-body"><b>🔵 ${esc(versus.names[0])}</b> vs <b>🔴 ${esc(versus.names[1])}</b> — 同じ端末で交互に操作します。<br>` +
        `<b>全ステージから選択可</b>（報酬カード・進行度は変化しません）${wOn ? `｜🎪 今週のルール「${esc(wr.name)}」適用` : ""}</p>`
      : training
      ? `<h2>🎯 トレーニング</h2><p class="dlg-body">好きな解放済みステージを選んで練習対戦。<b>勝つとカードを${REWARD_TRAINING}枚獲得</b>できます（何度でも）。` +
        `🔥<b>${TRAINING_STREAK_FOR_RARE}連勝から</b>は毎回<b>レア以上1枚保証</b>（負け・投了でリセット）${streak >= 1 ? `｜現在 🔥<b>${streak}連勝中</b>` : ""}。<br>` +
        `現在のゲーム難易度: <b>${diff.icon} ${diff.label}</b>（下の「⚙ 難易度」で変更）</p>`
      : `<h2>✦ マナサーキット ✦</h2>
         <p class="dlg-body">クリーチャーを召喚して土地を支配し、連鎖で通行料を吊り上げろ。目標資産を築いて🏰城に帰還すれば勝利！<br>
         ステージ初クリアで<b>カードパック</b>、トレーニングで<b>カード</b>を集め、<b>自分だけのデッキ</b>を組もう。<br>
         プレイヤー: <b>👤 ${esc(currentProfileName())}</b>｜現在のゲーム難易度: <b>${diff.icon} ${diff.label}</b>${wOn ? `｜🎪 <b>${esc(wr.name)}</b> 適用中` : ""}</p>`;
    const buttons = (versus || training)
      ? (training ? `<button class="btn" data-value="difficulty">⚙ 難易度: ${diff.icon}${diff.label}</button>` : "") +
        `<button class="btn" data-value="back">← 戻る</button>`
      : `<button class="btn" data-value="profile">👤 ${esc(currentProfileName())}</button>
         <button class="btn" data-value="difficulty">⚙ 難易度: ${diff.icon}${diff.label}</button>
         <button class="btn" data-value="album">📚 アルバム（${distinctOwned()}/${CARD_DB.length}）</button>
         <button class="btn" data-value="deck">🛠 デッキ構築</button>
         <button class="btn" data-value="workshop">♻️ 工房（🔮${shardCount()}）</button>
         <button class="btn" data-value="training">🎯 トレーニング</button>
         <button class="btn" data-value="versus">🎮 2人対戦</button>
         <button class="btn" data-value="weekly">🎪 週替り: ${wr.icon}${esc(wr.name)}${wOn ? "" : "（OFF）"}</button>
         <button class="btn" data-value="help">❓ 遊び方</button>`;
    box.innerHTML = `${header}<div class="stage-list">${rows}</div><div class="dlg-buttons">${buttons}</div>`;
    overlay.classList.add("show");
    const close = v => { overlay.classList.remove("show"); resolve(v); };
    box.querySelectorAll(".stage-btn:not(.locked)").forEach(btn =>
      btn.addEventListener("click", () => close(Number(btn.dataset.idx))));
    box.querySelectorAll(".dlg-buttons .btn").forEach(btn =>
      btn.addEventListener("click", () => close(btn.dataset.value)));
  });
}

// ---------- 難易度選択（イージー/ノーマル/ハード） ----------
function showDifficultyPicker() {
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const cur = loadDifficulty();
    const rows = Object.keys(DIFFICULTIES).map(k => {
      const d = DIFFICULTIES[k];
      return `<button class="stage-btn ${k === cur ? "diff-current" : ""}" data-diff="${k}">
        <span class="st-icon">${d.icon}</span>
        <span class="st-main"><b>${d.label}${k === cur ? "（現在）" : ""}</b><small>${esc(d.desc)}</small></span>
        <span class="st-star">${k === cur ? "✔" : ""}</span>
      </button>`;
    }).join("");
    box.innerHTML = `<h2>⚙ ゲーム難易度</h2>
      <p class="dlg-body">相手ごとの強さの違いはそのままに、<b>全体の手ごたえ</b>を調整します（CPUの積極性・デッキの強さ・資金力が変わります）。次の対戦から反映されます。</p>
      <div class="stage-list">${rows}</div>
      <div class="dlg-buttons"><button class="btn" data-value="back">← 戻る</button></div>`;
    overlay.classList.add("show");
    const close = () => { overlay.classList.remove("show"); resolve(); };
    box.querySelectorAll("[data-diff]").forEach(btn => btn.addEventListener("click", () => {
      saveDifficulty(btn.dataset.diff); close();
    }));
    box.querySelector("[data-value=back]").addEventListener("click", close);
  });
}

// ---------- バトル演出 ----------
function openBattleView(g, attackerName, attCard, attItem, tile, defItem) {
  closePassiveDialog(); // 🔍マス情報などが開いていたら閉じてから（上書きでbusyカウンタが狂うのを防ぐ）
  const defCard = CARD_BY_ID[tile.creature.cardId];
  const defBonus = attCard.ab.includes("pierce") ? 0 : landHpBonus(tile, defCard);
  const support = landSupportSt(g, tile);
  const dCur = tile.creature.hp ?? defCard.hp;
  const overlay = document.getElementById("overlay");
  const box = document.getElementById("dialog");
  const fighter = (c, item, extraHp, side, extraMods = "") => `
    <div class="fighter ${side}">
      <div class="f-side">${side === "att" ? "⚔ 侵略" : "🛡 防衛"}</div>
      ${cardHTML(c)}
      <div class="f-mods">
        ${item ? `<span class="f-mod">${item.st > 0 ? "⚔️" : "🛡️"} ${esc(item.name)}</span>` : ""}
        ${extraHp > 0 ? `<span class="f-mod">🏞 土地HP+${extraHp}</span>` : ""}
        ${extraMods}
      </div>
    </div>`;
  const defMods =
    (support > 0 ? `<span class="f-mod">🏰 援護ST+${support}</span>` : "") +
    (dCur < defCard.hp ? `<span class="f-mod">🩹 HP残${dCur}</span>` : "") +
    (defCard.ab.includes("capture") ? `<span class="f-mod">🕸️ 捕縛</span>` : "");
  box.innerHTML = `<h2>⚔ バトル！ ${esc(ELEMENTS[tile.element].name)}の土地 Lv${tile.level}</h2>
    <div class="battle-arena">
      ${fighter(attCard, attItem, 0, "att")}
      <div class="vs">VS</div>
      ${fighter(defCard, defItem, defBonus, "def", defMods)}
    </div>
    <div id="battle-log"></div>`;
  overlay.classList.add("show");
}

async function playBattleLines(lines, interval = 700) {
  const el = document.getElementById("battle-log");
  for (const line of lines) {
    if (el) {
      const div = document.createElement("div");
      div.textContent = line;
      if (line.includes("会心")) div.className = "crit";
      el.appendChild(div);
      el.scrollTop = el.scrollHeight;
    }
    if (line.includes("倒された")) SFX.destroy();
    else if (line.includes("会心")) SFX.destroy();
    else if (line.includes("攻撃！")) SFX.hit();
    log(line, "battle");
    await sleep(interval);
  }
}

function closeBattleView() {
  document.getElementById("overlay").classList.remove("show");
}

// ---------- 分かれ道の選択（人間用） ----------
function dirArrow(from, to) {
  const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
  if (dx > 0) return "➡";
  if (dx < 0) return "⬅";
  return dy > 0 ? "⬇" : "⬆";
}

// startId から既定ルートで進んだ場合のマスアイコン列（【】=止まる予定のマス）
function routePreview(g, startId, steps) {
  const icons = [];
  const shown = Math.min(steps, 6);
  let cur = startId;
  for (let s = 0; s < shown; s++) {
    const t = g.tiles[cur];
    let ic = t.type === "LAND" ? ELEMENTS[t.element].icon : TILE_ICONS[t.type];
    if (t.type === "LAND" && t.owner !== null) ic += t.owner === 0 ? "🔹" : "🔸";
    icons.push(s === steps - 1 ? `【${ic}】` : ic);
    cur = t.next[0];
  }
  return icons.join(" ") + (steps > shown ? " …" : "");
}

async function humanChooseDirection(p, tile, stepsLeft) {
  const res = await showDialog({
    title: "🔀 分かれ道",
    body: `残り${stepsLeft}マス。進む方向を選んでください（【】=止まる予定のマス、${G.hotseat ? "🔹=🔵1P 🔸=🔴2P" : "🔹=自分 🔸=敵"}の土地）`,
    peek: true,
    buttons: tile.next.map(nid => ({
      label: `${dirArrow(tile, G.tiles[nid])} ${routePreview(G, nid, stepsLeft)}`,
      value: String(nid),
    })),
  });
  return Number(res.action);
}

// ダイスの目を選ぶ（ホーリーワード用）
async function showDicePicker() {
  return new Promise(resolve => {
    closePassiveDialog();
    UI.dialogBusy++;
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    box.innerHTML = `<h2>ホーリーワード</h2><p class="dlg-body">次のダイスの目を選んでください</p>
      <div class="dlg-buttons dice-pick">` +
      [1, 2, 3, 4, 5, 6].map(n => `<button class="btn primary" data-n="${n}">${n}</button>`).join("") +
      `</div>`;
    overlay.classList.add("show");
    box.querySelectorAll("[data-n]").forEach(btn => btn.addEventListener("click", () => {
      UI.dialogBusy = Math.max(0, UI.dialogBusy - 1);
      overlay.classList.remove("show");
      resolve(Number(btn.dataset.n));
    }));
  });
}

// メインの操作ボタン（1つだけ表示して押されるのを待つ）
function waitButton(label) {
  return new Promise(resolve => {
    const btn = document.getElementById("action-btn");
    btn.textContent = label;
    btn.classList.remove("hidden");
    const handler = () => {
      btn.classList.add("hidden");
      btn.removeEventListener("click", handler);
      resolve();
    };
    btn.addEventListener("click", handler);
  });
}

// ダイス演出
async function animateDice(finalValue) {
  const el = document.getElementById("dice");
  el.classList.add("rolling");
  for (let i = 0; i < 8; i++) {
    el.textContent = 1 + Math.floor(Math.random() * 6);
    SFX.dice();
    await sleep(60);
  }
  el.textContent = finalValue;
  el.classList.remove("rolling");
  await sleep(350);
}
