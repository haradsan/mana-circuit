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
  // マナの回路（マスをつなぐ道）: タイルの下層に描く。外周の太い道＋中央を流れる魔力の点線
  g.tiles.forEach(tile => {
    const c1 = tilePx(tile);
    tile.next.forEach(nid => {
      const c2 = tilePx(g.tiles[nid]);
      const [x1, y1, x2, y2] = [c1.x + TILE / 2, c1.y + TILE / 2, c2.x + TILE / 2, c2.y + TILE / 2];
      html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#241e33" stroke-width="16" stroke-linecap="round"/>`;
      html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#5c5480" stroke-width="2.5" stroke-dasharray="2 9" stroke-linecap="round" opacity="0.9"/>`;
    });
  });
  g.tiles.forEach(tile => {
    const { x, y } = tilePx(tile);
    const isLand = tile.type === "LAND";
    const fill = isLand ? `url(#tg-${tile.element})`
      : tile.type === "CASTLE" ? "url(#tg-castle)"
      : tile.type === "MAGMA" ? "#5a2418"
      : "url(#tg-special)";
    const stroke = tile.owner !== null ? PLAYER_COLORS[tile.owner]
      : tile.type === "CASTLE" ? "#c9a755" : "#5a5470";
    const sw = tile.owner !== null ? 4 : tile.type === "CASTLE" ? 2.5 : 1.5;
    html += `<g class="tile" data-tile="${tile.id}">`;
    // 所有地はプレイヤー色のオーラで一目で分かるように
    if (tile.owner !== null) {
      html += `<rect x="${x - 3}" y="${y - 3}" width="${TILE + 6}" height="${TILE + 6}" rx="13" fill="none" stroke="${PLAYER_COLORS[tile.owner]}" stroke-width="7" opacity="0.22"/>`;
    }
    html += `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    // 内側のハイライト線（タイルの立体感）
    html += `<rect x="${x + 2.5}" y="${y + 2.5}" width="${TILE - 5}" height="${TILE - 5}" rx="8" fill="none" stroke="#fff" stroke-opacity="${tile.type === "CASTLE" ? 0.12 : 0.06}" stroke-width="1"/>`;
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
      // 魔力マスは宝石がきらめき、城は少し大きな紋章で特別感を出す
      const iconSize = tile.type === "CASTLE" ? 34 : 30;
      html += `<text x="${x + TILE / 2}" y="${y + 46}" font-size="${iconSize}" text-anchor="middle">${TILE_ICONS[tile.type]}</text>`;
      if (tile.type === "MAGIC") {
        html += `<text x="${x + TILE - 16}" y="${y + 22}" font-size="11" text-anchor="middle">✨<animate attributeName="opacity" values="1;0.2;1" dur="1.8s" repeatCount="indefinite"/></text>`;
      }
      if (tile.type === "CASTLE") {
        html += `<path d="M${x + TILE / 2 - 16} ${y + 12} h32" stroke="#ffd76a" stroke-width="1.5" opacity="0.7"/>`;
      }
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
  // プレイヤー駒（宝珠風・手番プレイヤーの駒は光が脈動する）
  g.players.forEach(p => {
    if (!p.alive) return;
    const { x, y } = tilePx(g.tiles[p.pos]);
    const off = p.id === 0 ? { dx: 20, dy: -8 } : { dx: TILE - 20, dy: -8 };
    const cx = x + off.dx, cy = y + off.dy;
    const active = g.current === p.id && !g.over;
    html += `<g class="token">`;
    if (active) {
      html += `<circle cx="${cx}" cy="${cy}" r="16" fill="none" stroke="${PLAYER_COLORS[p.id]}" stroke-width="2.5" opacity="0.6">` +
        `<animate attributeName="r" values="14;19;14" dur="1.5s" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" values="0.7;0.15;0.7" dur="1.5s" repeatCount="indefinite"/></circle>`;
    }
    html += `<circle cx="${cx}" cy="${cy + 1.5}" r="13" fill="#000" opacity="0.35"/>`;
    html += `<circle cx="${cx}" cy="${cy}" r="13" fill="url(#tokP${p.id})" stroke="#fff" stroke-width="2"/>`;
    html += `<ellipse cx="${cx - 4}" cy="${cy - 5}" rx="4.5" ry="3" fill="#fff" opacity="0.45"/>`;
    html += `<text x="${cx}" y="${cy + 5}" font-size="13" fill="#fff" text-anchor="middle" font-weight="bold" style="text-shadow:0 1px 2px #000">${g.hotseat ? p.id + 1 : (p.id === 0 ? "P" : "C")}</text>`;
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
  if (opts.fixed) cls.push("fixed"); // フリップ演出用の固定サイズ（表裏のサイズを一致させる）
  const abil = (c.ab || []).map(a => `<span class="ab">${ABILITY_INFO[a].name}</span>`).join("");
  const body = c.type === "creature"
    ? `<div class="c-stats"><span class="c-st">ST ${c.st}</span><span class="c-hp">HP ${c.hp}</span></div><div class="c-ab">${abil}</div>`
    : `<div class="c-desc">${esc(c.desc)}</div>`;
  const elemIcon = c.type === "creature" ? ELEMENTS[c.element].icon
    : c.type === "item" ? (c.st > 0 ? "⚔️" : "🛡️") : "✨";
  const rm = RARITY_META[rar];
  // 額縁＋アート窓＋コスト宝珠＋魔力の光沢（.c-shine）で「魔力の込められたカード」を表現
  return `<div class="${cls.join(" ")}" data-card="${c.id}" title="${esc(c.type === 'spell' ? c.desc : (c.ab || []).map(a => ABILITY_INFO[a].name + ': ' + ABILITY_INFO[a].desc).join(' / '))}">
    <div class="c-art">${typeof cardArtSVG === "function" ? cardArtSVG(c) : ""}</div>
    <span class="c-cost" title="コスト ${c.cost}G">${c.cost}</span>
    <span class="c-rarity" style="color:${rm.color}" title="${rm.label}">${rm.stars}</span>
    <span class="c-elem" title="${c.type === "creature" ? ELEMENTS[c.element].name + "属性" : c.type === "item" ? "アイテム" : "スペル"}">${elemIcon}</span>
    <div class="c-name">${esc(c.name)}</div><div class="c-body">${body}</div>
    <div class="c-shine"></div></div>`;
}

// 3Dフリップできるカード（裏面=共通のカードバック／表面=カード本体）。
// .revealed を付けると裏→表にめくれる。手札のオープン・ドロー・パック開封で使う。
// 表裏が「同じ1枚のカード」に見えるよう、表面は固定サイズ（.card.fixed）で描画し、
// 裏面はグリッドセル（＝表面と同寸）いっぱいに広がる。
function flipCardHTML(c, opts = {}) {
  return `<div class="flip3d${opts.revealed ? " revealed" : ""}"${c ? ` data-flip="${c.id}"` : ""}>
    <div class="flip3d-inner">
      <div class="flip3d-face flip3d-back">${CARD_BACK_HTML}</div>
      <div class="flip3d-face flip3d-front">${c ? cardHTML(c, { ...opts, fixed: true }) : ""}</div>
    </div>${opts.badge || ""}</div>`;
}

function renderHand(g) {
  // 通常はプレイヤー0（人間）の手札。2人対戦（ホットシート）では手番プレイヤーの手札を表示する
  const p = g.players[g.hotseat ? g.current : 0];
  const el = document.getElementById("hand");
  if (g.hotseat && UI.handHidden) {
    // 手番交代画面の間は伏せて、次のプレイヤーの手札が前のプレイヤーに見えないようにする
    el.innerHTML = p.hand.map(() => `<div class="card facedown" title="交代中は伏せられています">${CARD_BACK_HTML}</div>`).join("");
  } else {
    el.innerHTML = p.hand.map(id => cardHTML(CARD_BY_ID[id])).join("");
  }
  document.getElementById("hand-count").textContent =
    (g.hotseat ? `${p.name}の` : "") + `手札 ${p.hand.length}/${HAND_LIMIT}`;
  updateHandArrows();
}

// ---------- 手札の矢印送り ----------
// スマホでは手札の横スワイプがAndroidの「戻る」ジェスチャーと衝突してゲームが終了してしまうため、
// はみ出した手札は ◀▶ ボタンで1枚ずつ送れるようにする（オーバーフロー時のみ表示）。
function updateHandArrows() {
  const hand = document.getElementById("hand");
  const prev = document.getElementById("hand-prev");
  const next = document.getElementById("hand-next");
  if (!hand || !prev || !next) return;
  const overflow = hand.scrollWidth > hand.clientWidth + 4;
  prev.classList.toggle("hidden", !overflow);
  next.classList.toggle("hidden", !overflow);
  if (!overflow) return;
  prev.disabled = hand.scrollLeft <= 2;
  next.disabled = hand.scrollLeft >= hand.scrollWidth - hand.clientWidth - 2;
}
function initHandArrows() {
  const hand = document.getElementById("hand");
  const step = () => {
    const card = hand.querySelector(".card, .flip3d");
    return card ? card.getBoundingClientRect().width + 8 : 110; // カード1枚ぶんずつ送る
  };
  // スクロール直後に矢印の有効/無効を更新する（scrollイベントが飛ばない環境があるためクリック側でも直接呼ぶ）
  const go = dir => { hand.scrollBy({ left: dir * step() }); updateHandArrows(); };
  document.getElementById("hand-prev").addEventListener("click", () => go(-1));
  document.getElementById("hand-next").addEventListener("click", () => go(1));
  hand.addEventListener("scroll", updateHandArrows, { passive: true });
  window.addEventListener("resize", updateHandArrows);
}

// ---------- ゲーム開始の手札オープン演出 ----------
// 全カードが表紙（カードバック）側で配られ、1枚ずつめくれて対戦が始まる
async function handIntro(g) {
  const p = g.players[0];
  const el = document.getElementById("hand");
  el.innerHTML = p.hand.map(id => flipCardHTML(CARD_BY_ID[id])).join("");
  await sleep(420);
  for (const f of el.querySelectorAll(".flip3d")) {
    f.classList.add("revealed");
    SFX.flip();
    await sleep(150);
  }
  await sleep(500);
  renderHand(g);
}

// ---------- ドロー演出 ----------
// 山札からカードが現れ、めくれて手札へ吸い込まれる（人間のドロー時のみ）
async function animateDraw(card) {
  const host = document.createElement("div");
  host.id = "draw-fx";
  host.innerHTML = flipCardHTML(card);
  document.body.appendChild(host);
  SFX.draw();
  await sleep(120);
  host.querySelector(".flip3d").classList.add("revealed");
  SFX.flip();
  await sleep(620);
  host.classList.add("to-hand"); // 手札ウィンドウへ吸い込まれる
  await sleep(300);
  host.remove();
}

function renderAll(g) { renderBoard(g); renderPanels(g); renderHand(g); }

// ---------- タイトル画面（起動時の世界観演出） ----------
// マナの粒子が瞬く夜空＋ゆっくり回る大紋章＋地平のクリーチャーシルエット。
// 画面のどこかをクリック／タップでフェードアウトしてメニューへ。
function showTitleScreen() {
  return new Promise(resolve => {
    const el = document.createElement("div");
    el.id = "title-screen";
    // マナの粒子（ランダム配置・明滅）
    const stars = Array.from({ length: 46 }, () => {
      const sz = (Math.random() * 2 + 1).toFixed(1);
      return `<span class="ts-star" style="left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 88).toFixed(1)}%;` +
        `width:${sz}px;height:${sz}px;animation-duration:${(2.2 + Math.random() * 3.4).toFixed(1)}s;animation-delay:-${(Math.random() * 4).toFixed(1)}s"></span>`;
    }).join("");
    el.innerHTML = `
      ${stars}
      <div class="ts-center">
        <div class="ts-emblem">${TITLE_EMBLEM_SVG}</div>
        <h1 class="ts-title">マナサーキット</h1>
        <div class="ts-sub">— MANA CIRCUIT —</div>
        <p class="ts-flavor">大地に張り巡らされた魔力の回路が、いま目を覚ます。<br>
          クリーチャーを従え、土地を繋ぎ、四大のマナを我が手に。<br>
          環を制する者こそ、次代の大魔導師。</p>
        <div class="ts-start">✦ クリック / タップ で始める ✦</div>
      </div>
      <div class="ts-frieze">${TITLE_FRIEZE_SVG}</div>`;
    document.body.appendChild(el);
    el.addEventListener("click", () => {
      if (typeof SFX !== "undefined" && SFX.bless) SFX.bless(); // 荘厳なアルペジオで開幕
      el.classList.add("ts-out");
      setTimeout(() => { el.remove(); resolve(); }, 650);
    }, { once: true });
  });
}

// ---------- 盤面ズーム（拡大縮小して読みやすく） ----------
let BOARD_ZOOM = 1;
// ZOOM_MIN は「⛶ 全体」フィットで大きな盤面を1画面に収められるよう低め（0.3）にしてある
const ZOOM_MIN = 0.3, ZOOM_MAX = 2.6, ZOOM_STEP = 0.2;
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
// 「⛶ 全体」: 盤面全体が #board-wrap に収まる倍率へ調整する（見えないマスを無くす）。
// opts.max を指定すると倍率の上限（対戦開始時は 1＝拡大はしない）
function fitBoard(opts = {}) {
  const wrap = document.getElementById("board-wrap");
  const svg = document.getElementById("board");
  if (!wrap || !svg) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const baseW = rect.width / BOARD_ZOOM, baseH = rect.height / BOARD_ZOOM; // 等倍時のサイズを逆算
  let z = Math.min((wrap.clientWidth - 10) / baseW, (wrap.clientHeight - 10) / baseH);
  if (opts.max !== undefined) z = Math.min(z, opts.max);
  BOARD_ZOOM = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +z.toFixed(2)));
  applyZoom();
  wrap.scrollTo({ left: 0, top: 0 });
}

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
  initHandArrows();
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
        <span class="st-bg" aria-hidden="true">${unlocked ? s.icon : "🔒"}</span>
        <span class="st-icon">${unlocked ? s.icon : "🔒"}</span>
        <span class="st-main"><b><span class="st-no">STAGE ${i + 1}</span>${unlocked ? esc(s.name) : "？？？"}</b><small>${desc}</small></span>
        <span class="st-star">${cleared ? "⭐" : ""}</span>
      </button>`;
    }).join("");
    const diff = DIFFICULTIES[loadDifficulty()];
    const streak = (typeof trainingStreakCount === "function") ? trainingStreakCount() : 0;
    const wr = currentWeeklyRule();
    const wOn = weeklyEnabled();
    // 世界観ヘッダー（紋章＋題字＋口上＋状態チップ）
    const chips = arr => `<div class="ss-chips">${arr.filter(Boolean).map(t => `<span class="ss-chip">${t}</span>`).join("")}</div>`;
    const hero = (title, flavor, chipArr) => `
      <div class="ss-hero">
        <div class="ss-crest">${typeof TITLE_EMBLEM_SVG !== "undefined" ? TITLE_EMBLEM_SVG : ""}</div>
        <div class="ss-hero-main">
          <h2>${title}</h2>
          <p class="ss-flavor">${flavor}</p>
          ${chips(chipArr)}
        </div>
      </div>`;
    const weeklyChip = wOn ? `🎪 今週のルール: <b>${esc(wr.name)}</b>` : "";
    const header = versus
      ? hero("🎮 決闘の間",
        `同じ卓を囲み、端末を手渡して覇を競う——友との真剣勝負。<b>全ステージから選択可</b>（報酬・進行度は変化しません）。`,
        [`🔵 <b>${esc(versus.names[0])}</b> vs 🔴 <b>${esc(versus.names[1])}</b>`, weeklyChip])
      : training
      ? hero("🎯 修練の間",
        `腕とデッキを磨く練習対戦。<b>勝つとカードを${REWARD_TRAINING}枚獲得</b>（何度でも）。` +
        `🔥<b>${TRAINING_STREAK_FOR_RARE}連勝から</b>は毎回<b>レア以上1枚保証</b>（負け・投了でリセット）。`,
        [streak >= 1 ? `🔥 <b>${streak}連勝中</b>` : "", `⚙ 難易度: <b>${diff.icon} ${diff.label}</b>`])
      : hero("✦ 遠征の書 — 旅路を選べ ✦",
        `大地に張り巡らされた魔力の回路。クリーチャーを従えて土地を繋ぎ、連鎖で通行料を吊り上げ、
         目標資産を成して🏰城へ帰還せよ。初クリアの<b>カードパック</b>と勝利の<b>カード</b>で、自分だけのデッキを組み上げろ。`,
        [`👤 <b>${esc(currentProfileName())}</b>`, `⚙ 難易度: <b>${diff.icon} ${diff.label}</b>`, weeklyChip]);
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

// ---------- バトル演出（フルスクリーンのカットイン・スキップ可） ----------
// 侵略側が左から、防衛側が右から突撃してくるカットイン。攻撃のたびにカードが突進し、
// 被弾側が揺れる。「⏩ スキップ」で残りのログを一括表示して即座に決着へ進める。
UI.battleSkip = false;
UI.battleCtx = null; // { attName, defName } — ログ行からどちらの攻撃かを判定する

function openBattleView(g, attackerName, attCard, attItem, tile, defItem) {
  closePassiveDialog(); // 🔍マス情報などが開いていたら閉じてから（上書きでbusyカウンタが狂うのを防ぐ）
  const defCard = CARD_BY_ID[tile.creature.cardId];
  const defBonus = attCard.ab.includes("pierce") ? 0 : landHpBonus(tile, defCard);
  const support = landSupportSt(g, tile);
  const dCur = tile.creature.hp ?? defCard.hp;
  UI.battleSkip = false;
  UI.battleCtx = { attName: attCard.name, defName: defCard.name };
  const cutin = document.getElementById("battle-cutin");
  const fighter = (c, item, extraHp, side, extraMods = "") => `
    <div class="fighter ${side === "att" ? "bc-att" : "bc-def"}" id="bc-${side}">
      <div class="f-side">${side === "att" ? "⚔ 侵略" : "🛡 防衛"}</div>
      ${cardHTML(c)}
      <div class="f-mods">
        ${item ? `<span class="f-mod">${item.st > 0 ? "⚔️" : "🛡️"} ${esc(item.name)}</span>` : ""}
        ${extraHp > 0 ? `<span class="f-mod">🏞 土地HP+${extraHp}</span>` : ""}
        ${extraMods}
      </div>
    </div>`;
  // 物理/魔法の攻防に関わる要素はカットインにバッジで明示（魔法攻撃はアイテム由来も含む）
  const typeMods = (c, item) =>
    (c.ab.includes("physnull") ? `<span class="f-mod">🌫 物理無効</span>` : "") +
    (c.ab.includes("physreflect") ? `<span class="f-mod">🪞 物理反射</span>` : "") +
    ((c.ab.includes("magicatk") || (item && item.magicatk)) ? `<span class="f-mod">✨ 魔法攻撃</span>` : "");
  const defMods =
    (support > 0 ? `<span class="f-mod">🏰 援護ST+${support}</span>` : "") +
    (dCur < defCard.hp ? `<span class="f-mod">🩹 HP残${dCur}</span>` : "") +
    (defCard.ab.includes("capture") ? `<span class="f-mod">🕸️ 捕縛</span>` : "") +
    typeMods(defCard, defItem);
  cutin.innerHTML = `
    <div class="bc-flash" id="bc-flash"></div>
    <div class="bc-inner">
      <h2 class="bc-title">⚔ バトル！ <small>${esc(ELEMENTS[tile.element].name)}の土地 Lv${tile.level}</small></h2>
      <div class="battle-arena">
        ${fighter(attCard, attItem, 0, "att", typeMods(attCard, attItem))}
        <div class="vs">VS</div>
        ${fighter(defCard, defItem, defBonus, "def", defMods)}
      </div>
      <div id="battle-log"></div>
      <div class="bc-actions"><button id="battle-skip" class="btn small" title="残りの演出を飛ばして決着まで進めます">⏩ 演出をスキップ</button></div>
    </div>`;
  cutin.classList.remove("hidden", "bc-out");
  document.getElementById("battle-skip").addEventListener("click", () => {
    UI.battleSkip = true;
    cutin.classList.add("bc-skipping");
  });
}

// ログ行に応じたカットインの動き（突進・被弾・会心フラッシュ・撃破）
function _battleLineFx(line) {
  const ctx = UI.battleCtx || {};
  const att = document.getElementById("bc-att");
  const def = document.getElementById("bc-def");
  const flash = document.getElementById("bc-flash");
  const pulse = (el, cls) => {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // アニメを再発火させるためのリフロー
    el.classList.add(cls);
  };
  if (line.includes("会心")) { pulse(flash, "go-crit"); return; }
  if (line.startsWith(`${ctx.attName}の攻撃`) || line.startsWith(`${ctx.attName}の魔法攻撃`)) { pulse(att, "bc-lunge-r"); pulse(def, "bc-hurt"); pulse(flash, "go"); return; }
  if (line.startsWith(`${ctx.defName}の攻撃`) || line.startsWith(`${ctx.defName}の魔法攻撃`)) { pulse(def, "bc-lunge-l"); pulse(att, "bc-hurt"); pulse(flash, "go"); return; }
  if (line.includes("物理無効！") || line.includes("物理反射！")) { pulse(flash, "go"); return; }
  if (line.includes("跳ね返った")) { // 物理反射のダメージが攻撃側に返った行（行頭は被弾した側の名前）
    if (line.startsWith(ctx.attName)) pulse(att, "bc-hurt");
    else if (line.startsWith(ctx.defName)) pulse(def, "bc-hurt");
    pulse(flash, "go"); return;
  }
  if (line.includes("倒された")) {
    if (line.startsWith(ctx.defName)) pulse(def, "bc-dead");
    else if (line.startsWith(ctx.attName)) pulse(att, "bc-dead");
  }
}

async function playBattleLines(lines, interval = 700) {
  const el = document.getElementById("battle-log");
  for (const line of lines) {
    const instant = UI.battleSkip; // スキップ後は残りを一括表示
    if (el) {
      const div = document.createElement("div");
      div.textContent = line;
      if (line.includes("会心")) div.className = "crit";
      else if (line.startsWith("📊")) div.className = "formula";
      el.appendChild(div);
      el.scrollTop = el.scrollHeight;
    }
    log(line, "battle");
    if (instant) continue;
    if (line.includes("倒された")) SFX.destroy();
    else if (line.includes("会心")) SFX.destroy();
    else if (line.includes("攻撃！")) SFX.hit();
    _battleLineFx(line);
    await sleep(interval);
  }
}

function closeBattleView() {
  const cutin = document.getElementById("battle-cutin");
  cutin.classList.add("bc-out"); // フェードアウトしてから消す
  setTimeout(() => { cutin.classList.add("hidden"); cutin.classList.remove("bc-out", "bc-skipping"); }, 320);
}

// ---------- 勝利の祝福演出 ----------
// 金色の光条＋舞い散る紙吹雪＋祝福の鐘の音。演出中もクリックは透過する（pointer-events:none）ので
// 続く報酬ダイアログの操作を妨げない。opts.grand で紙吹雪を増量（初クリア用）。
async function playVictoryFx(title, sub, opts = {}) {
  const old = document.getElementById("victory-fx");
  if (old) old.remove();
  const host = document.createElement("div");
  host.id = "victory-fx";
  const colors = ["#ffd76a", "#ffe9a0", "#4da3ff", "#ff8a6a", "#8ee0a0", "#d9a6ff", "#fff"];
  const n = opts.grand ? 110 : 70;
  let confetti = "";
  for (let i = 0; i < n; i++) {
    const left = Math.random() * 100;
    const delay = Math.random() * 1.6;
    const dur = 2.2 + Math.random() * 1.6;
    const c = colors[Math.floor(Math.random() * colors.length)];
    const w = 6 + Math.random() * 7, h = 8 + Math.random() * 9;
    const rot = Math.floor(Math.random() * 360);
    confetti += `<i class="vf-confetti" style="left:${left}vw;width:${w}px;height:${h}px;background:${c};animation-delay:${delay}s;animation-duration:${dur}s;transform:rotate(${rot}deg)"></i>`;
  }
  host.innerHTML = `
    <div class="vf-rays"></div>
    <div class="vf-title">${esc(title)}</div>
    <div class="vf-sub">${esc(sub || "")}</div>
    ${confetti}`;
  document.body.appendChild(host);
  SFX.bless();
  await sleep(1700); // タイトルの余韻まで待ってから次へ（紙吹雪は背後で降り続ける）
  (async () => {   // 後片付けは待たずに進める（ダイアログの背後で静かにフェードアウト）
    await sleep(2600);
    host.classList.add("vf-fade");
    await sleep(1100);
    host.remove();
  })();
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
