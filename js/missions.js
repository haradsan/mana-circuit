// ============================================================
// missions.js — 🎯 対戦ごとの「挑戦」（v35・原さん要望「ゲーム自体の面白さ・魅力度アップ」）
// ------------------------------------------------------------
// 対戦のたびに、あなた（人間のプレイヤー）に小さな目標が2つ配られる。
//   例: 🔗連鎖の達人＝同じ属性の土地をそろえる ／ 🛡鉄壁＝防衛バトルに2回勝つ ／ 🔄周回の旅人＝3周する
// 勝敗とは別に、達成した挑戦1つにつきカード1枚を決着後に受け取れる（負けても達成分はもらえる）。
// ルールそのもの（勝利条件・通行料・バトルの計算）には一切触れない＝「今回はこれを狙ってみよう」という
// 遊び方の幅だけを足す仕組み。原さんの実プレイで不要と判断されたら、main.js の呼び出し
// （startGame の missionsSetup・notifyReach の checkMissions・showGameOver の grantMissionRewards）を外せば消える。
// 2人対戦（ホットシート）は人間が2人いるので配らない。
//
// 目標値は盤面と目標資産に合わせて決める（param）: 小さな盤面・低い目標資産でも届く値にする。
// feasible が false の挑戦は配らない（例: 🤝絆の相方がデッキに入っていないのに「絆を成立させる」は出さない）。
// ============================================================
"use strict";

const MISSION_COUNT = 2;          // 1対戦に配る挑戦の数
const MISSION_REWARD_CARDS = 1;   // 達成1つあたりの報酬カード枚数

const _round10 = v => Math.max(10, Math.round(v / 10) * 10);
const _landTiles = g => g.tiles.filter(t => t.type === "LAND");
// デッキ（山札＋手札）に「相方ごとそろっている絆」があるか
function _deckHasBondPair(p) {
  const ids = new Set([...(p.deck || []), ...(p.hand || [])]);
  return [...ids].some(id => {
    const c = CARD_BY_ID[id];
    if (!c || !c.bond) return false;
    const partners = c.bond.with || [];
    return c.bond.all ? partners.every(w => ids.has(w)) : partners.some(w => ids.has(w));
  });
}

// param(g, p) … この対戦での目標値 v ／ desc(v) … 説明文 ／ check(g, p, s, v) … 達成したか
const MISSIONS = [
  { id: "chain", icon: "🔗", label: "連鎖の達人",
    // 盤面にある同属性の土地の数（最多の属性）まで。4を上限（連鎖×4＝通行料×2.5）
    param: g => Math.min(4, Math.max(...LAND_ELEMENTS.map(e => _landTiles(g).filter(t => t.element === e).length))),
    feasible: (g, p, v) => v >= 3,
    desc: v => `同じ属性の土地を${v}つ同時に持つ（🔗連鎖×${v}）`,
    check: (g, p, s, v) => LAND_ELEMENTS.some(e => chainCount(g, p.id, e) >= v) },
  { id: "invade2", icon: "⚔", label: "侵略者", param: () => 2,
    desc: v => `侵略・侵攻のバトルに${v}回勝つ`,
    check: (g, p, s, v) => s.battleWins >= v },
  { id: "defend2", icon: "🛡", label: "鉄壁", param: () => 2,
    desc: v => `防衛バトルに${v}回勝つ（撃退・撤退させる）`,
    check: (g, p, s, v) => s.defends >= v },
  { id: "laps", icon: "🔄", label: "周回の旅人", param: g => (g.training ? 2 : 3), // トレーニングは短期戦なので2周
    desc: v => `${v}周する（関門をそろえて城を通過・停止）`,
    check: (g, p, s, v) => p.laps >= v },
  { id: "toll", icon: "💰", label: "大徴収",
    param: () => _round10(RULES.target * 0.07),   // 目標3000G→210G ／ 5000G→350G
    desc: v => `1回で${v}G以上の通行料を受け取る`,
    check: (g, p, s, v) => s.maxTollIn >= v },
  { id: "lv4", icon: "🏯", label: "築城主", param: () => 4,
    desc: v => `Lv${v}以上の土地を持つ`,
    check: (g, p, s, v) => ownedLands(g, p.id).some(t => t.level >= v) },
  { id: "lands", icon: "🏞", label: "大領主",
    param: g => Math.max(5, Math.round(_landTiles(g).length * 0.4)), // 盤面の土地の4割
    desc: v => `領地を${v}つ同時に持つ`,
    check: (g, p, s, v) => ownedLands(g, p.id).length >= v },
  { id: "spell4", icon: "✨", label: "魔導の探究", param: () => 4,
    desc: v => `スペルを${v}回使う`,
    check: (g, p, s, v) => s.spells >= v },
  { id: "bond", icon: "🤝", label: "絆の力", param: () => 1,
    feasible: (g, p) => _deckHasBondPair(p),
    desc: () => "🤝絆を成立させる（相方を自分の領地にそろえる）",
    check: (g, p) => ownedLands(g, p.id).some(t => {
      const c = t.creature && CARD_BY_ID[t.creature.cardId];
      return c && c.bond && typeof bondPartnerTile === "function" && bondPartnerTile(g, p.id, c, t.id);
    }) },
  { id: "rich", icon: "💎", label: "蓄財",
    param: () => _round10(RULES.target * 0.5),
    desc: v => `手持ちの魔力を${v}G以上にする`,
    check: (g, p, s, v) => p.magic >= v },
];

// 対戦開始時に挑戦を配る（人間が1人のときだけ）
function missionsSetup(g) {
  g.missions = null;
  g.missionsPaid = false;
  const humans = g.players.filter(p => !p.isCPU);
  if (g.hotseat || humans.length !== 1) return;
  const p = humans[0];
  const pool = MISSIONS.map(m => ({ m, v: m.param(g, p) })).filter(x => !x.m.feasible || x.m.feasible(g, p, x.v));
  const picked = [];
  while (picked.length < MISSION_COUNT && pool.length) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  g.missions = {
    pid: p.id,
    list: picked.map(x => ({ id: x.m.id, v: x.v, done: false })),
    stats: { battleWins: 0, defends: 0, spells: 0, maxTollIn: 0 },
  };
}
function missionDef(id) { return MISSIONS.find(m => m.id === id); }
function missionDesc(m) { const d = missionDef(m.id); return d ? d.desc(m.v) : ""; }
function missionStatsOf(g) { return g && g.missions ? g.missions.stats : null; }

// ---- 成績を数えるフック（main.js から呼ばれる） ----
function missionBattle(g, attacker, defender, result) {
  const s = missionStatsOf(g);
  if (!s || !result || result.escaped) return;
  if (attacker.id === g.missions.pid && result.attackerWins) s.battleWins++;
  if (defender.id === g.missions.pid && !result.attackerWins) s.defends++;
}
function missionToll(g, receiver, amount) {
  const s = missionStatsOf(g);
  if (s && receiver && receiver.id === g.missions.pid) s.maxTollIn = Math.max(s.maxTollIn, amount);
}
function missionSpell(g, p) {
  const s = missionStatsOf(g);
  if (s && p.id === g.missions.pid) s.spells++;
}

// 達成チェック（ターンの終わりごと・決着時）。新しく達成したら大見出しで祝う
function checkMissions(g) {
  if (!g || !g.missions) return;
  const p = g.players[g.missions.pid];
  let changed = false;
  g.missions.list.forEach(m => {
    if (m.done) return;
    const def = missionDef(m.id);
    if (!def || !def.check(g, p, g.missions.stats, m.v)) return;
    m.done = true;
    changed = true;
    if (typeof SFX !== "undefined") SFX.coin();
    log(`🎯 挑戦達成！ ${def.icon}${def.label}（${def.desc(m.v)}）— 決着後にカード${MISSION_REWARD_CARDS}枚`, "sys", { toast: true });
    if (typeof bigAnnounce === "function") bigAnnounce(`🎯 挑戦達成！`, `${def.icon} ${def.label} — ${def.desc(m.v)}`, "mission");
  });
  if (changed && typeof renderPanels === "function") renderPanels(g);
}

// 挑戦の一覧（HTML）。対戦前の口上・情報窓の詳細・決着ダイアログで共用
function missionListHTML(g) {
  if (!g || !g.missions) return "";
  return `<div class="mission-list">` + g.missions.list.map(m => {
    const d = missionDef(m.id);
    return `<div class="ms-row${m.done ? " done" : ""}"><span class="ms-check">${m.done ? "✅" : "⬜"}</span>` +
      `<span class="ms-main"><b>${d.icon} ${d.label}</b><small>${esc(d.desc(m.v))}</small></span></div>`;
  }).join("") + `</div>`;
}
function missionProgressText(g) {
  if (!g || !g.missions) return "";
  const n = g.missions.list.filter(m => m.done).length;
  return `🎯${n}/${g.missions.list.length}`;
}
// 決着ダイアログに載せる「今回の挑戦」の結果
function missionResultHTML(g) {
  if (!g || !g.missions) return "";
  const n = g.missions.list.filter(m => m.done).length;
  return `<div class="mission-result"><div class="mr-head">🎯 今回の挑戦 <b>${n} / ${g.missions.list.length}</b> 達成` +
    (n ? `（カード${n * MISSION_REWARD_CARDS}枚獲得）` : "") + `</div>${missionListHTML(g)}</div>`;
}

// 決着後: 達成した挑戦ぶんのカードを渡す（勝敗に関係なく）。受け取った枚数を返す
async function grantMissionRewards(g, set = null) {
  if (!g || !g.missions || g.missionsPaid) return 0;
  checkMissions(g);
  g.missionsPaid = true;
  const done = g.missions.list.filter(m => m.done);
  if (!done.length || typeof drawPack !== "function" || typeof addCards !== "function") return 0;
  const s = set || (1 + Math.floor(Math.random() * (typeof CARD_SETS !== "undefined" ? CARD_SETS.length : 1)));
  const pack = drawPack(done.length * MISSION_REWARD_CARDS, "common", 0, s);
  addCards(pack);
  if (typeof showPackReveal === "function") {
    await showPackReveal(pack, "🎯 挑戦達成ボーナス！",
      `${done.map(m => { const d = missionDef(m.id); return d.icon + d.label; }).join("・")} を達成——カードを${pack.length}枚手に入れた！`);
  }
  return pack.length;
}
