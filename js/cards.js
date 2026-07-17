// ============================================================
// cards.js — カードデータベースとデッキ構築
// ============================================================
"use strict";

// 属性は4種。相性の輪（水＞火＞木＞地＞水 ＝ 火→木→地→水→火）に沿った並び順にしてある
// （アルバム・パネルの表示順や色の割り当てが相性の輪と一致して分かりやすい）。
// 色は4色を明確に見分けられるように設定（木=緑 / 地=茶で木と区別）。
const ELEMENTS = {
  fire:  { name: "火", icon: "🔥", color: "#e05537" },
  wood:  { name: "木", icon: "🌳", color: "#4e9a2f" },
  earth: { name: "地", icon: "⛰️", color: "#8a6b3a" },
  water: { name: "水", icon: "💧", color: "#3d7de0" },
  // 無属性（クリーチャー専用・土地には存在しない）: 相性の輪の外＝有利も不利も取らない。
  // 土地の加護（属性一致HPボーナス）も一切受けない代わりに、素のコスト効率がやや高くユニークな能力を持つ。
  neutral: { name: "無", icon: "⚪", color: "#9d97b5" },
};
// 土地として存在できる属性（盤面・エレメンタルシフト・デッキの属性枠は無属性を除く4種）
const LAND_ELEMENTS = ["fire", "wood", "earth", "water"];

// 属性相性（4すくみ）: 火→木→地→水→火（左が右に強い）＝「水＞火＞木＞地＞水」。バトル時 ST+10
// 火は木を焼き、木は地を痩せさせ（根が土を割る）、地は水を堰き止め、水は火を消す。
const ELEM_ADVANTAGE = { fire: "wood", wood: "earth", earth: "water", water: "fire" };
const ELEM_ADV_ST = 10;
function hasElemAdvantage(attElem, defElem) { return ELEM_ADVANTAGE[attElem] === defElem; }

// 能力: first=先制 / pierce=貫通 / assault=強襲(侵略時ST+20)
//       guard=守護(防衛時HP+20) / lucky=豪運(会心率10%→25%)
//       capture=捕縛(防衛で撃退した侵略者を1ターン拘束) / immobile=不動(侵略・侵攻に出せない防御専用)
//       physnull=物理無効(物理攻撃が効かない) / physreflect=物理反射(物理攻撃を攻撃側へ跳ね返す)
//       magicatk=魔法攻撃(攻撃が魔法＝物理無効・反射を貫く。magicatk:true のアイテムでも付与できる)
const ABILITY_INFO = {
  first:    { name: "先制", desc: "防衛時でも先に攻撃する" },
  pierce:   { name: "貫通", desc: "土地のHPボーナスを無視する" },
  assault:  { name: "強襲", desc: "侵略時にST+20" },
  guard:    { name: "守護", desc: "防衛時にHP+20" },
  lucky:    { name: "豪運", desc: "会心の一撃(ダメージ1.5倍)が出やすい(25%)" },
  capture:  { name: "捕縛", desc: "防衛して撃退すると、侵略してきた相手を次の1ターン拘束する" },
  immobile: { name: "不動", desc: "侵略・侵攻には出せない防御専用（そのぶんHPが高い）" },
  spellproof: { name: "護法", desc: "敵の対象指定スペル（メテオ・バニッシュ・ガスト）の対象にならない" },
  double:   { name: "連撃", desc: "バトルで続けて2回攻撃する（1撃目で相手が倒れなければもう1撃）" },
  // v15: 物理/魔法の攻撃タイプを導入。「物理攻撃」＝魔法攻撃でない通常の攻撃すべて。
  physnull:    { name: "物理無効", desc: "物理攻撃（魔法攻撃以外）を無効化する＝ダメージ0。魔法攻撃は通る" },
  physreflect: { name: "物理反射", desc: "物理攻撃を無効化し、そのダメージをそっくり攻撃側へ跳ね返す。魔法攻撃は通る" },
  magicatk:    { name: "魔法攻撃", desc: "攻撃が魔法になる。物理無効・物理反射に妨げられず、通常どおりダメージを与える" },
  // v17: 模倣＝バトル時に相手カードの基本値をそっくりコピーする（ドッペルゲンガー）
  mimic:       { name: "模倣", desc: "バトル時、相手クリーチャーの基本ST・基本HP・能力をそっくり写し取って戦う（属性は無のまま・装備や土地の加護はコピーしない）" },
  // ---------- 第二弾「時流の回路」の新能力（v19） ----------
  grow:     { name: "成長", desc: "自分のターン開始ごとに ST+5／最大HP+5（上限+25）。時間をかけるほど強くなる" },
  pack:     { name: "群れ", desc: "盤面にいる自分の同属性クリーチャー1体につき ST+5（上限+30）。仲間が多いほど強い" },
  ranged:   { name: "遠隔", desc: "侵略・侵攻のバトルで相手の反撃を受けない（相手が先制でも）。撃ち逃げの一撃" },
  absorb:   { name: "吸収", desc: "与えたダメージの半分だけ自分のHPを回復する（そのバトル開始時のHPが上限）" },
  armor:    { name: "硬殻", desc: "受けるダメージを常に10軽減する（最低0）。手数の多い相手に強い" },
  lastward: { name: "背水", desc: "HPが半分以下のとき ST+25。追い詰められてからが本番" },
  mine:     { name: "採掘", desc: "盤面にいる間、自分のターン開始時に魔力を得る（+15G）" },
  merchant: { name: "商魂", desc: "駐留する土地の通行料が1.3倍になる" },
  rebirth:  { name: "転生", desc: "バトルで倒されても消滅せず手札に戻る（土地は失う）" },
  fly:      { name: "飛翔", desc: "侵攻（march）で2マス先まで移動できる" },
  dispel:   { name: "看破", desc: "バトルで相手のアイテムを打ち消す（ディスペルワードを内蔵）" },
  // 建造物のオーラ（個別効果）。建造物はST0・不動・バトルで反撃しない据え付けの施設
  beacon:   { name: "烽火", desc: "隣接する自領の防衛クリーチャーの ST+10（援護に加算）" },
  garden:   { name: "癒しの庭", desc: "隣接する自軍クリーチャーは自分のターン開始時に HP+10 回復する" },
  harbor:   { name: "港湾", desc: "自分がこのマスを通過・停止するたび +40G" },
  warfire:  { name: "戦意", desc: "自軍が侵略・侵攻のバトルに勝つたび +40G" },
  festival: { name: "祝祭", desc: "自分の周回ボーナスが1.5倍になる" },
};

// レア度: カードの希少度。card.rarity で個別指定、無ければコストとタイプから推定。
// パックの排出重み（weight）と、カード/アルバムでの見た目（stars/color）に使う。
const RARITY_META = {
  common:    { label: "コモン",     stars: "★",     color: "#9aa0b5", weight: 8 },
  uncommon:  { label: "アンコモン", stars: "★★",    color: "#57c26a", weight: 4 },
  rare:      { label: "レア",       stars: "★★★",   color: "#4da3ff", weight: 2 },
  legendary: { label: "レジェンド", stars: "★★★★",  color: "#ffb14d", weight: 1 },
};
function cardRarity(card) {
  if (card.rarity) return card.rarity;
  const c = card.cost;
  if (c >= 135) return "legendary";
  if (c >= 110) return "rare";
  if (c >= 75)  return "uncommon";
  return "common";
}
const RARITY_WEIGHT = Object.fromEntries(Object.entries(RARITY_META).map(([k, v]) => [k, v.weight]));
const RARITY_ORDER = ["common", "uncommon", "rare", "legendary"];
// カードの弾（set）。第一弾＝set未指定（=1）、第二弾＝set:2（v19）。パック・アルバムの仕切りに使う
function cardSet(card) { return card.set || 1; }
const CARD_SETS = [
  { set: 1, name: "第一弾", icon: "✦" },
  { set: 2, name: "第二弾「時流の回路」", icon: "⏳" },
];
// レア度 → そのレア度のカードid一覧（パック排出で「レア度を決めてから一様に1枚選ぶ」ために使う）。
// set指定（1/2）でその弾だけに絞る（null＝全弾。ウィークリー英雄の週などデッキ注入用）
let _cardsByRarity = null;
function cardsOfRarity(rarity, set = null) {
  if (!_cardsByRarity) {
    _cardsByRarity = { all: {}, 1: {}, 2: {} };
    ["all", 1, 2].forEach(k => RARITY_ORDER.forEach(r => { _cardsByRarity[k][r] = []; }));
    CARD_DB.forEach(c => {
      const r = cardRarity(c);
      _cardsByRarity.all[r].push(c.id);
      _cardsByRarity[cardSet(c)][r].push(c.id);
    });
  }
  const table = set === null ? _cardsByRarity.all : (_cardsByRarity[set] || _cardsByRarity.all);
  return table[rarity] || [];
}

const CARD_DB = [
  // --- 火（攻撃寄り） ---
  { id: "imp",         name: "インプ",           type: "creature", element: "fire",  cost: 40,  st: 20, hp: 30, ab: ["lucky"] },
  { id: "firelizard",  name: "ファイアリザード", type: "creature", element: "fire",  cost: 50,  st: 30, hp: 30, ab: [] },
  { id: "bombeetle",   name: "ボムビートル",     type: "creature", element: "fire",  cost: 45,  st: 40, hp: 20, ab: [] }, // v13: 55→45（同コストのブランブルハウンドに完全に劣っていたため値下げ）
  { id: "flamewolf",   name: "フレイムウルフ",   type: "creature", element: "fire",  cost: 60,  st: 40, hp: 30, ab: ["assault"] },
  { id: "hellhound",   name: "ヘルハウンド",     type: "creature", element: "fire",  cost: 70,  st: 40, hp: 40, ab: ["pierce"] },
  { id: "salamander",  name: "サラマンダー",     type: "creature", element: "fire",  cost: 80,  st: 50, hp: 40, ab: [] },
  { id: "flamedancer", name: "フレイムダンサー", type: "creature", element: "fire",  cost: 85,  st: 40, hp: 40, ab: ["first"] },
  { id: "lavagolem",   name: "ラーヴァゴーレム", type: "creature", element: "fire",  cost: 100, st: 50, hp: 60, ab: [] },
  { id: "minotaur",    name: "ミノタウロス",     type: "creature", element: "fire",  cost: 105, st: 60, hp: 40, ab: ["assault"] },
  { id: "phoenix",     name: "フェニックス",     type: "creature", element: "fire",  cost: 120, st: 60, hp: 50, ab: ["first"] },
  { id: "efreet",      name: "イフリート",       type: "creature", element: "fire",  cost: 130, st: 70, hp: 40, ab: ["pierce"] },
  { id: "reddragon",   name: "レッドドラゴン",   type: "creature", element: "fire",  cost: 140, st: 70, hp: 60, ab: ["lucky"] },
  // --- 水（バランス・守り） ---
  { id: "aquasprite",  name: "アクアスピリット", type: "creature", element: "water", cost: 40,  st: 20, hp: 40, ab: [] },
  { id: "merman",      name: "マーマン",         type: "creature", element: "water", cost: 50,  st: 30, hp: 40, ab: [] },
  { id: "frostnaga",   name: "フロストナーガ",   type: "creature", element: "water", cost: 60,  st: 40, hp: 30, ab: ["first"] },
  { id: "shellcrab",   name: "シェルクラブ",     type: "creature", element: "water", cost: 65,  st: 20, hp: 60, ab: ["guard"] },
  { id: "undine",      name: "ウンディーネ",     type: "creature", element: "water", cost: 65,  st: 30, hp: 50, ab: ["guard"] }, // v13: 70→65（同コスト帯のドリアードに見劣りしていたため値下げ）
  { id: "mermaid",     name: "マーメイドナイト", type: "creature", element: "water", cost: 80,  st: 30, hp: 65, ab: [] }, // v13: HP60→65（同コストのロックゴーレムに完全に劣っていたため）
  { id: "seaserpent",  name: "シーサーペント",   type: "creature", element: "water", cost: 90,  st: 50, hp: 60, ab: [] }, // v13: HP50→60（同コストのバジリスク(貫通付き)に完全に劣っていたため）
  { id: "sirene",      name: "セイレーン",       type: "creature", element: "water", cost: 95,  st: 40, hp: 50, ab: ["first"] },
  { id: "frostgiant",  name: "フロストジャイアント", type: "creature", element: "water", cost: 110, st: 55, hp: 65, ab: [] }, // v13: 50/60→55/65（同コストのフォレストロード(捕縛付き)に完全に劣っていたため）
  { id: "kraken",      name: "クラーケン",       type: "creature", element: "water", cost: 120, st: 60, hp: 60, ab: ["capture"] }, // v13: 捕縛を付与（同コストのグリーンドラゴン(貫通)に完全に劣っていた。触腕で搦め捕るイメージ）
  { id: "tidallord",   name: "タイダルロード",   type: "creature", element: "water", cost: 135, st: 65, hp: 75, ab: ["first"] },
  { id: "leviathan",   name: "リヴァイアサン",   type: "creature", element: "water", cost: 140, st: 70, hp: 60, ab: ["pierce"] },
  { id: "abyssturtle", name: "アビスタートル",   type: "creature", element: "water", cost: 100, st: 10, hp: 90, ab: ["immobile", "guard"] },
  { id: "netjelly",    name: "ネットジェリー",   type: "creature", element: "water", cost: 65,  st: 20, hp: 55, ab: ["capture"] },
  // --- 地（HP・防衛） ---
  { id: "mudman",      name: "マッドマン",       type: "creature", element: "earth", cost: 40,  st: 20, hp: 40, ab: [] },
  { id: "dwarfguard",  name: "ドワーフガード",   type: "creature", element: "earth", cost: 50,  st: 20, hp: 50, ab: ["guard"] },
  { id: "stonewall",   name: "ストーンウォール", type: "creature", element: "earth", cost: 60,  st: 10, hp: 80, ab: [] },
  { id: "needlemole",  name: "ニードルモール",   type: "creature", element: "earth", cost: 65,  st: 40, hp: 40, ab: [] },
  { id: "rockgolem",   name: "ロックゴーレム",   type: "creature", element: "earth", cost: 80,  st: 30, hp: 70, ab: [] },
  { id: "basilisk",    name: "バジリスク",       type: "creature", element: "earth", cost: 90,  st: 50, hp: 50, ab: ["pierce"] },
  { id: "ogre",        name: "オーガ",           type: "creature", element: "earth", cost: 95,  st: 60, hp: 40, ab: ["assault"] },
  { id: "ironturtle",  name: "アイアンタートル", type: "creature", element: "earth", cost: 105, st: 30, hp: 90, ab: ["guard"] },
  { id: "earthdragon", name: "アースドラゴン",   type: "creature", element: "earth", cost: 120, st: 50, hp: 70, ab: [] },
  { id: "behemoth",    name: "ベヒーモス",       type: "creature", element: "earth", cost: 135, st: 70, hp: 50, ab: ["assault"] },
  { id: "gaiatitan",   name: "ガイアタイタン",   type: "creature", element: "earth", cost: 140, st: 65, hp: 85, ab: ["guard"] },
  { id: "greatwall",   name: "グレートウォール", type: "creature", element: "earth", cost: 90,  st: 10, hp: 100, ab: ["immobile"] },
  { id: "maneater",    name: "マンイーター",     type: "creature", element: "earth", cost: 75,  st: 40, hp: 55, ab: ["capture"] },
  // --- v4追加クリーチャー（各属性に追加） ---
  { id: "hellcat",     name: "ヘルキャット",     type: "creature", element: "fire",  cost: 45,  st: 30, hp: 20, ab: ["first"] },
  { id: "cerberus",    name: "ケルベロス",       type: "creature", element: "fire",  cost: 110, st: 60, hp: 50, ab: ["assault"] },
  { id: "magmagolem",  name: "マグマゴーレム",   type: "creature", element: "fire",  cost: 95,  st: 40, hp: 60, ab: [] },
  { id: "vulcandrake", name: "ヴォルカンドレイク", type: "creature", element: "fire", cost: 150, st: 80, hp: 55, ab: ["pierce"] },
  { id: "icesprite",   name: "アイススプライト", type: "creature", element: "water", cost: 45,  st: 20, hp: 40, ab: [] },
  { id: "kappa",       name: "カッパ",           type: "creature", element: "water", cost: 60,  st: 30, hp: 45, ab: ["guard"] },
  { id: "seawitch",    name: "シーウィッチ",     type: "creature", element: "water", cost: 90,  st: 50, hp: 45, ab: ["first"] },
  { id: "waterdragon", name: "ウォータードラゴン", type: "creature", element: "water", cost: 125, st: 60, hp: 65, ab: [] },
  { id: "gnome",       name: "ノーム",           type: "creature", element: "earth", cost: 45,  st: 20, hp: 45, ab: [] },
  { id: "goblinaxe",   name: "ゴブリンアックス", type: "creature", element: "earth", cost: 60,  st: 40, hp: 35, ab: ["assault"] },
  { id: "clayhulk",    name: "クレイハルク",     type: "creature", element: "earth", cost: 100, st: 40, hp: 75, ab: ["guard"] },
  // --- 木（生命と搦め手：capture／firstが主軸の中量級。地の「純HP壁・守護」とは役割を変えてある）---
  //     地＝重装の高HP壁で受ける。木＝先制と絡め手（捕縛）で手数を取り、相手を拘束して立ち回る。
  //     トレント／タイタンオークは樹木モチーフのため木属性（旧地属性からの名実一致移籍。数値・能力は不変）。
  { id: "treant",      name: "トレント",         type: "creature", element: "wood",  cost: 70,  st: 30, hp: 65, ab: [] }, // v13: HP60→65（守護付きドリアードと差別化＝素のHPで上回る壁に）
  { id: "titanoak",    name: "タイタンオーク",   type: "creature", element: "wood",  cost: 130, st: 60, hp: 70, ab: [] },
  { id: "kodama",      name: "コダマ",           type: "creature", element: "wood",  cost: 45,  st: 20, hp: 35, ab: ["lucky"] },
  { id: "sprout",      name: "スプラウト",       type: "creature", element: "wood",  cost: 40,  st: 20, hp: 40, ab: [] },
  { id: "thornvine",   name: "ソーンヴァイン",   type: "creature", element: "wood",  cost: 55,  st: 30, hp: 40, ab: ["capture"] },
  { id: "pixie",       name: "ピクシー",         type: "creature", element: "wood",  cost: 60,  st: 30, hp: 40, ab: ["first"] },
  { id: "bramblehound",name: "ブランブルハウンド", type: "creature", element: "wood", cost: 55, st: 40, hp: 30, ab: ["assault"] },
  { id: "mandrake",    name: "マンドレイク",     type: "creature", element: "wood",  cost: 65,  st: 40, hp: 40, ab: ["capture"] },
  { id: "dryad",       name: "ドリアード",       type: "creature", element: "wood",  cost: 70,  st: 30, hp: 55, ab: ["guard"] },
  { id: "woodwolf",    name: "ウッドウルフ",     type: "creature", element: "wood",  cost: 75,  st: 50, hp: 40, ab: ["first"] },
  { id: "mossgiant",   name: "モスジャイアント", type: "creature", element: "wood",  cost: 90,  st: 40, hp: 65, ab: ["capture"] },
  { id: "worldtree",   name: "ワールドツリー",   type: "creature", element: "wood",  cost: 100, st: 20, hp: 85, ab: ["immobile", "capture"] },
  { id: "forestlord",  name: "フォレストロード", type: "creature", element: "wood",  cost: 110, st: 50, hp: 60, ab: ["capture"] },
  { id: "greendragon", name: "グリーンドラゴン", type: "creature", element: "wood",  cost: 120, st: 60, hp: 60, ab: ["pierce"] },
  { id: "elderent",    name: "エンシェントエント", type: "creature", element: "wood", cost: 135, st: 60, hp: 75, ab: ["capture"] },
  // --- v13追加クリーチャー ---
  { id: "alraune",     name: "アルラウネ",       type: "creature", element: "wood",  cost: 85,  st: 40, hp: 50, ab: ["capture"] },
  // --- v15追加: 各属性に「元から魔法攻撃を備えた」術士を1種ずつ。
  //     無属性の物理無効・物理反射（ファントム/ミラージュ）を素で掃討できる対抗札。そのぶんHPは低め ---
  { id: "flamemage",   name: "フレイムメイジ",   type: "creature", element: "fire",  cost: 75,  st: 45, hp: 25, ab: ["magicatk"], rarity: "uncommon" },
  { id: "druid",       name: "ドルイド",         type: "creature", element: "wood",  cost: 70,  st: 35, hp: 35, ab: ["magicatk"], rarity: "uncommon" },
  { id: "runedwarf",   name: "ルーンドワーフ",   type: "creature", element: "earth", cost: 70,  st: 35, hp: 40, ab: ["magicatk"], rarity: "uncommon" },
  { id: "frostwizard", name: "フロストウィザード", type: "creature", element: "water", cost: 75, st: 40, hp: 30, ab: ["magicatk"], rarity: "uncommon" },
  // --- 無属性（v13追加）: 土地の加護を一切受けず属性相性の輪の外＝どの土地でも同じ強さ。
  //     そのぶんコスト効率がやや高く、全員レア以上でユニークな能力（護法/連撃/二重能力）を持つ ---
  { id: "gargoyle",     name: "ガーゴイル",       type: "creature", element: "neutral", cost: 60,  st: 35, hp: 55, ab: ["guard", "spellproof"], rarity: "rare" },
  { id: "unicorn",      name: "ユニコーン",       type: "creature", element: "neutral", cost: 75,  st: 45, hp: 45, ab: ["first", "lucky"],      rarity: "rare" },
  { id: "mithrilgolem", name: "ミスリルゴーレム", type: "creature", element: "neutral", cost: 95,  st: 50, hp: 70, ab: ["spellproof"],           rarity: "rare" },
  { id: "chimera",      name: "キメラ",           type: "creature", element: "neutral", cost: 115, st: 45, hp: 60, ab: ["double"],               rarity: "legendary" },
  // --- 無属性（v15追加）: 物理/魔法の攻撃タイプを軸にしたトリックスター。
  //     物理攻撃しか持たない相手には鉄壁だが、魔法攻撃（✨アイテム/クリーチャー）や除去スペルにはあっさり沈む
  //     ＝「対策を積んでいるか」で強さが激変するメタカード。HPは意図的に低い（物理無効=低め／物理反射=極小）---
  { id: "phantom",      name: "ファントム",       type: "creature", element: "neutral", cost: 75,  st: 30, hp: 35, ab: ["physnull"],    rarity: "rare" },
  { id: "mirage",       name: "ミラージュ",       type: "creature", element: "neutral", cost: 55,  st: 10, hp: 15, ab: ["physreflect"], rarity: "rare" },
  // --- 無属性（v17追加）: ドッペルゲンガー＝相手をそっくり真似るトリックスター（原さん要望）。
  //     素のST/HPは最弱クラスだが、バトルでは常に「相手と同じ強さ」＝強敵ほど良い写し身になる。
  //     スフィンクス＝無属性初の魔法攻撃持ち。守護も併せ持つ万能の番人（ファントム/ミラージュ対策にもなる）
  { id: "doppelganger", name: "ドッペルゲンガー", type: "creature", element: "neutral", cost: 90,  st: 10, hp: 30, ab: ["mimic"],               rarity: "legendary" },
  { id: "sphinx",       name: "スフィンクス",     type: "creature", element: "neutral", cost: 95,  st: 45, hp: 50, ab: ["magicatk", "guard"],   rarity: "rare" },
  // --- アイテム（バトル時に装備、使い切り） ---
  { id: "longsword",     name: "ロングソード",     type: "item", cost: 40,  st: 20, hp: 0,  desc: "バトル時 ST+20" },
  { id: "battleaxe",     name: "バトルアックス",   type: "item", cost: 70,  st: 40, hp: 0,  desc: "バトル時 ST+40" },
  { id: "greatsword",    name: "グレートソード",   type: "item", cost: 100, st: 55, hp: 0,  desc: "バトル時 ST+55" },
  { id: "assassindagger",name: "アサシンダガー",   type: "item", cost: 80,  st: 15, hp: 0,  grant: ["first"], desc: "ST+15・先制を得る" },
  { id: "leathershield", name: "レザーシールド",   type: "item", cost: 40,  st: 0,  hp: 20, desc: "バトル時 HP+20" },
  { id: "towershield",   name: "タワーシールド",   type: "item", cost: 70,  st: 0,  hp: 40, desc: "バトル時 HP+40" },
  { id: "platemail",     name: "プレートメイル",   type: "item", cost: 100, st: 0,  hp: 55, desc: "バトル時 HP+55" },
  { id: "elementalorb",  name: "エレメンタルオーブ", type: "item", cost: 60, st: 15, hp: 15, desc: "バトル時 ST+15 / HP+15" },
  // --- v4追加アイテム ---
  { id: "claymore",      name: "クレイモア",       type: "item", cost: 130, st: 70, hp: 0,  desc: "バトル時 ST+70" },
  { id: "mithrilshield", name: "ミスリルシールド", type: "item", cost: 130, st: 0,  hp: 70, desc: "バトル時 HP+70" },
  { id: "dualblade",     name: "デュアルブレード", type: "item", cost: 95,  st: 35, hp: 0,  grant: ["first"], desc: "ST+35・先制を得る" },
  { id: "luckycharm",    name: "ラックチャーム",   type: "item", cost: 50,  st: 10, hp: 10, grant: ["lucky"], desc: "ST+10/HP+10・会心率アップ" },
  { id: "vampirelance",  name: "ヴァンパイアランス", type: "item", cost: 75, st: 30, hp: 0,  grant: ["pierce"], desc: "ST+30・貫通を得る" },
  { id: "saintarmor",    name: "セイントアーマー", type: "item", cost: 110, st: 0,  hp: 45, grant: ["guard"], desc: "HP+45・守護を得る" },
  // --- v13追加アイテム ---
  { id: "warbanner",     name: "ウォーバナー",     type: "item", cost: 65,  st: 25, hp: 10, desc: "バトル時 ST+25 / HP+10" },
  // --- v15追加: 魔法攻撃アイテム。同コスト帯の武器よりST補正は低いが、装備者の攻撃が魔法になる
  //     ＝物理無効・物理反射（ファントム/ミラージュ）を貫いて掃討できる（防衛時の反撃にも有効） ---
  { id: "magicwand",     name: "マジックワンド",   type: "item", cost: 50,  st: 15, hp: 0,  magicatk: true, rarity: "uncommon", desc: "バトル時 ST+15・攻撃が魔法になる（物理無効・物理反射を貫く）" },
  { id: "arcanarod",     name: "アルカナロッド",   type: "item", cost: 90,  st: 35, hp: 0,  magicatk: true, rarity: "rare",     desc: "バトル時 ST+35・攻撃が魔法になる（物理無効・物理反射を貫く）" },
  // --- v17追加: 吸奪武器（原さん要望「攻撃したポイント分×2倍の魔力を強奪する武器」）。
  //     drainMagic=与えたダメージに掛ける倍率。実際の魔力移動は fightFor（main.js）が行う ---
  { id: "greedfang",     name: "グリードファング", type: "item", cost: 85,  st: 25, hp: 0,  drainMagic: 2, rarity: "rare", desc: "バトル時 ST+25・与えたダメージ×2倍の魔力を相手から強奪する（攻撃が通らなければ強奪もなし）" },
  // --- スペル ---
  { id: "manadrain", name: "マナドレイン",   type: "spell", cost: 50,  spell: "drain",    desc: "相手から200Gを奪う（低コスト高効率）" },
  { id: "holyword",  name: "ホーリーワード", type: "spell", cost: 60,  spell: "holyword", desc: "次のダイスの目を自由に選ぶ" },
  { id: "drawmist",  name: "ドローミスト",   type: "spell", cost: 70,  spell: "draw",     desc: "カードを2枚引く" },
  { id: "quake",     name: "クエイク",       type: "spell", cost: 120, spell: "quake",    desc: "敵の土地1つのレベルを1下げる" },
  { id: "growth",    name: "グロース",       type: "spell", cost: 150, spell: "growth",   rarity: "rare", desc: "自分のLv3以下の土地1つをLv+1" },
  { id: "recall",    name: "リコール",       type: "spell", cost: 100, spell: "recall",   desc: "城へテレポート（総資産達成なら勝利！ 関門を規定数すべて通過済みなら周回ボーナスも得る）" },
  { id: "revenge",   name: "リベンジ",       type: "spell", cost: 80,  spell: "revenge",  desc: "総資産で負けている時、差額の25%（最大500G）を相手から奪う" },
  { id: "eleshift",  name: "エレメンタルシフト", type: "spell", cost: 90, spell: "eleshift", desc: "自分の土地1つの属性を変える（連鎖の組み替えに）" },
  { id: "vanish",    name: "バニッシュ",     type: "spell", cost: 160, spell: "vanish",   desc: "敵クリーチャー1体を無条件で消滅させ土地を解放する（HP不問＝どんな相手でも確実に破壊／土地レベルは残る）" },
  { id: "gust",      name: "ガスト",         type: "spell", cost: 90,  spell: "gust", rarity: "rare", icon: "🌬️", desc: "敵クリーチャー1体を隣接する空き地へ強制的に押し出す（元の土地は空き地に戻る＝連鎖崩し・防衛どかしに／不動・結界は対象外）" },
  { id: "regen",     name: "リジェネ",       type: "spell", cost: 60,  spell: "regen", icon: "💚", desc: "負傷した自分のクリーチャー1体のHPを全回復する" },
  { id: "renew",     name: "引き直し",       type: "spell", cost: 40,  spell: "renew",    desc: "手札をすべて捨て、新たに6枚引く（手札事故のリセットに）" },
  // --- v4追加スペル ---
  { id: "meteor",    name: "メテオ",         type: "spell", cost: 110, spell: "meteor",   icon: "☄️", desc: "敵クリーチャー1体に40ダメージ（現在HPが0以下になれば破壊し土地を解放／高HPの相手は削って弱らせる）。バニッシュより安価で小回りが利く" },
  { id: "freeze",    name: "フリーズ",       type: "spell", cost: 100, spell: "freeze",   icon: "❄️", desc: "相手を凍らせ、次のターンを1回休みにする" },
  { id: "treasure",  name: "トレジャー",     type: "spell", cost: 50,  spell: "treasure", icon: "💰", desc: "所有する土地1つにつき+40G（土地が多いほど得）" },
  { id: "steal",     name: "スティール",     type: "spell", cost: 80,  spell: "steal",    icon: "🎭", desc: "相手の手札からランダムに1枚奪う" },
  { id: "salvage",   name: "サルベージ",     type: "spell", cost: 40,  spell: "salvage",  icon: "♻️", desc: "自分の捨て札からカード1枚を選んで手札に戻す" },
  // --- v13追加スペル ---
  { id: "alchemy",   name: "アルケミー",     type: "spell", cost: 40,  spell: "alchemy",  icon: "⚗️", desc: "手札から1枚を選んで捨て、120Gに変える（使わないカードを資金に）" },
  // --- v17追加スペル: 移動3種（原さん要望）。自分を飛ばす／配下を好きな空き地へ／配下を2マス先へ ---
  { id: "teleport",  name: "テレポート",     type: "spell", cost: 90,  spell: "teleport",  rarity: "rare",     icon: "💫", desc: "自分のコマを盤面の好きなマス（城以外）へ飛ばす。そのあと通常どおりダイスで移動する（飛んだだけではマスの効果・関門通過は発生しない）" },
  { id: "transport", name: "トランスポート", type: "spell", cost: 80,  spell: "transport", rarity: "rare",     icon: "🚪", desc: "自分のクリーチャー1体を盤面の好きな空き地へ転送する（現在HPのまま移動・元の土地は空き地に戻りレベルは残る／不動は対象外）" },
  { id: "leap",      name: "リープ",         type: "spell", cost: 45,  spell: "leap",      rarity: "uncommon", icon: "🐇", desc: "自分のクリーチャー1体を2マス先の空き地へ跳躍させる（元の土地は空き地に戻りレベルは残る／不動は対象外）" },
  // --- v5追加スペル/アイテム ---
  { id: "plunder",     name: "プランダー",       type: "spell", cost: 95, spell: "plunder",    rarity: "rare",     icon: "💰", desc: "相手の所持金の半分を奪う（相手が富むほど大きい）" },
  { id: "hyperdice",   name: "ダイスブースト",   type: "spell", cost: 50, spell: "dicedouble", rarity: "uncommon", icon: "🎲", desc: "次のダイスの出目を2倍にする（最大12マス進む）" },
  { id: "dispelward",  name: "ディスペルワード", type: "item", cost: 55, st: 0, hp: 0,  nullify: true,  rarity: "rare", desc: "バトル時、相手のアイテムの効果を打ち消す（相手のアイテムを無効化）" },
  { id: "mirrorshield",name: "ミラーシールド",   type: "item", cost: 95, st: 0, hp: 20, reflect: 0.5, rarity: "rare", desc: "バトル時 HP+20・受けた攻撃ダメージの50%を相手に反射する" },
  // --- 盤面エフェクト（スペル枠で発動、2ラウンドの時限効果でマスそのものを変化させる） ---
  { id: "sanctuary", name: "サンクチュアリ", type: "spell", cost: 140, spell: "sanctuary", fx: true, icon: "🛡️",
    desc: "【盤面】自分の土地1つに2Rの結界。侵略・クリーチャー侵攻・敵スペルの対象にならない" },
  { id: "ensnare",   name: "スネアトラップ", type: "spell", cost: 110, spell: "ensnare",   fx: true, icon: "🕸️",
    desc: "【盤面】土地1つに2Rの罠。相手が通過・停止するとその場で足止め（移動終了）される" },

  // ============================================================
  // 第二弾「時流の回路」（v19・set:2）
  // テーマ: 時間・成長・経済・連携。詳細は CARD_SET2_PLAN.md
  // スペル約55種はフェーズ2で追加予定（このブロックはクリーチャー113＋アイテム32）
  // ============================================================
  // --- 火（遠隔・背水・会心） ---
  { id: "firebaby",     name: "火の子トカゲ",     type: "creature", element: "fire", set: 2, cost: 30,  st: 20, hp: 20, ab: ["grow"] },
  { id: "sparkimp",     name: "スパークインプ",   type: "creature", element: "fire", set: 2, cost: 35,  st: 25, hp: 20, ab: ["lucky"] },
  { id: "cinderrat",    name: "シンダーラット",   type: "creature", element: "fire", set: 2, cost: 40,  st: 25, hp: 25, ab: ["pack"] },
  { id: "heathawk",     name: "ヒートホーク",     type: "creature", element: "fire", set: 2, cost: 50,  st: 35, hp: 25, ab: [] },
  { id: "hellbat",      name: "ヘルバット",       type: "creature", element: "fire", set: 2, cost: 55,  st: 30, hp: 30, ab: ["first"] },
  { id: "blazesoldier", name: "ブレイズソルジャー", type: "creature", element: "fire", set: 2, cost: 60, st: 40, hp: 30, ab: [] },
  { id: "flameboar",    name: "フレイムボア",     type: "creature", element: "fire", set: 2, cost: 65,  st: 45, hp: 30, ab: ["lastward"] },
  { id: "firearcher",   name: "ファイアアーチャー", type: "creature", element: "fire", set: 2, cost: 60, st: 30, hp: 25, ab: ["ranged"], rarity: "uncommon" },
  { id: "lavalizard",   name: "ラヴァリザード",   type: "creature", element: "fire", set: 2, cost: 70,  st: 45, hp: 35, ab: [] },
  { id: "flarewitch",   name: "フレアウィッチ",   type: "creature", element: "fire", set: 2, cost: 80,  st: 45, hp: 30, ab: ["magicatk", "lucky"], rarity: "rare" },
  { id: "bombturtle",   name: "ボムタートル",     type: "creature", element: "fire", set: 2, cost: 85,  st: 30, hp: 60, ab: ["guard"], rarity: "uncommon" },
  { id: "flameogre",    name: "フレイムオーガ",   type: "creature", element: "fire", set: 2, cost: 90,  st: 55, hp: 40, ab: ["assault"], rarity: "uncommon" },
  { id: "burstgriffon", name: "バーストグリフォン", type: "creature", element: "fire", set: 2, cost: 95, st: 50, hp: 45, ab: ["first"], rarity: "uncommon" },
  { id: "ignislancer",  name: "イグニスランサー", type: "creature", element: "fire", set: 2, cost: 100, st: 55, hp: 45, ab: ["pierce"], rarity: "uncommon" },
  { id: "calderagolem", name: "カルデラゴーレム", type: "creature", element: "fire", set: 2, cost: 105, st: 45, hp: 65, ab: [], rarity: "uncommon" },
  { id: "amphisbaena",  name: "アンフィスバエナ", type: "creature", element: "fire", set: 2, cost: 110, st: 55, hp: 50, ab: ["double"], rarity: "rare" },
  { id: "crimsonknight",name: "クリムゾンナイト", type: "creature", element: "fire", set: 2, cost: 115, st: 60, hp: 55, ab: ["lastward"], rarity: "rare" },
  { id: "cannondrake",  name: "砲竜キャノンドレイク", type: "creature", element: "fire", set: 2, cost: 120, st: 60, hp: 50, ab: ["ranged"], rarity: "rare" },
  { id: "suzaku",       name: "炎鳥スザク",       type: "creature", element: "fire", set: 2, cost: 130, st: 65, hp: 55, ab: ["first", "lucky"], rarity: "rare" },
  { id: "hellflamedemon", name: "ヘルフレイムデーモン", type: "creature", element: "fire", set: 2, cost: 140, st: 75, hp: 50, ab: ["assault"], rarity: "rare" },
  { id: "glendragon",   name: "焔竜グレンドラゴン", type: "creature", element: "fire", set: 2, cost: 150, st: 75, hp: 60, ab: ["ranged", "pierce"], rarity: "legendary" },
  // --- 木（群れ・成長・捕縛） ---
  { id: "leafrabbit",   name: "リーフラビット",   type: "creature", element: "wood", set: 2, cost: 30,  st: 15, hp: 25, ab: ["pack"] },
  { id: "spriggan",     name: "スプリガン",       type: "creature", element: "wood", set: 2, cost: 40,  st: 20, hp: 30, ab: ["grow"] },
  { id: "honeybee",     name: "ハニービー",       type: "creature", element: "wood", set: 2, cost: 45,  st: 30, hp: 25, ab: ["first"] },
  { id: "mycolon",      name: "マイコロン",       type: "creature", element: "wood", set: 2, cost: 50,  st: 25, hp: 40, ab: [] },
  { id: "matango",      name: "胞子撒きマタンゴ", type: "creature", element: "wood", set: 2, cost: 50,  st: 25, hp: 35, ab: ["rebirth"] },
  { id: "ivysnake",     name: "アイビースネーク", type: "creature", element: "wood", set: 2, cost: 55,  st: 30, hp: 40, ab: ["capture"] },
  { id: "youngent",     name: "若木のエント",     type: "creature", element: "wood", set: 2, cost: 60,  st: 25, hp: 50, ab: ["grow"] },
  { id: "forestarcher", name: "フォレストアーチャー", type: "creature", element: "wood", set: 2, cost: 60, st: 30, hp: 30, ab: ["ranged"], rarity: "uncommon" },
  { id: "packwolf",     name: "パックウルフ",     type: "creature", element: "wood", set: 2, cost: 65,  st: 35, hp: 35, ab: ["pack"] },
  { id: "sylph",        name: "シルフ",           type: "creature", element: "wood", set: 2, cost: 70,  st: 40, hp: 35, ab: ["first"] },
  { id: "barkbeetle",   name: "バークビートル",   type: "creature", element: "wood", set: 2, cost: 75,  st: 30, hp: 55, ab: ["armor"], rarity: "uncommon" },
  { id: "mossshaman",   name: "モスシャーマン",   type: "creature", element: "wood", set: 2, cost: 80,  st: 40, hp: 40, ab: ["magicatk"], rarity: "uncommon" },
  { id: "vinestrangler",name: "ヴァインストラングラー", type: "creature", element: "wood", set: 2, cost: 85, st: 45, hp: 45, ab: ["capture"], rarity: "uncommon" },
  { id: "elvenhunter",  name: "エルヴンハンター", type: "creature", element: "wood", set: 2, cost: 90,  st: 45, hp: 40, ab: ["ranged", "pack"], rarity: "rare" },
  { id: "treeguardian", name: "巨木の守り手",     type: "creature", element: "wood", set: 2, cost: 95,  st: 30, hp: 75, ab: ["guard"], rarity: "uncommon" },
  { id: "greenhydra",   name: "グリーンヒュドラ", type: "creature", element: "wood", set: 2, cost: 100, st: 50, hp: 55, ab: ["grow"], rarity: "rare" },
  { id: "fairyqueen",   name: "フェアリークイーン", type: "creature", element: "wood", set: 2, cost: 105, st: 45, hp: 50, ab: ["pack", "first"], rarity: "rare" },
  { id: "kingmantis",   name: "キングマンティス", type: "creature", element: "wood", set: 2, cost: 110, st: 60, hp: 45, ab: ["first", "capture"], rarity: "rare" },
  { id: "sequoiagiant", name: "セコイアジャイアント", type: "creature", element: "wood", set: 2, cost: 115, st: 55, hp: 70, ab: [], rarity: "uncommon" },
  { id: "leafdragon",   name: "森竜リーフドラゴン", type: "creature", element: "wood", set: 2, cost: 125, st: 60, hp: 60, ab: ["pack"], rarity: "rare" },
  { id: "spiritelder",  name: "翁樹スピリットエルダー", type: "creature", element: "wood", set: 2, cost: 145, st: 55, hp: 85, ab: ["grow", "capture"], rarity: "legendary" },
  // --- 地（硬殻・採掘・重装） ---
  { id: "pebbling",     name: "ペブルリング",     type: "creature", element: "earth", set: 2, cost: 35,  st: 15, hp: 30, ab: ["armor"] },
  { id: "molminer",     name: "モールマイナー",   type: "creature", element: "earth", set: 2, cost: 45,  st: 25, hp: 30, ab: ["mine"] },
  { id: "sandlizard",   name: "サンドリザード",   type: "creature", element: "earth", set: 2, cost: 45,  st: 30, hp: 35, ab: [] },
  { id: "goblinsapper", name: "ゴブリンサッパー", type: "creature", element: "earth", set: 2, cost: 50,  st: 35, hp: 30, ab: ["assault"] },
  { id: "quartzbeetle", name: "クォーツビートル", type: "creature", element: "earth", set: 2, cost: 55,  st: 25, hp: 45, ab: ["armor"] },
  { id: "catapultdwarf",name: "カタパルトドワーフ", type: "creature", element: "earth", set: 2, cost: 65, st: 35, hp: 30, ab: ["ranged"], rarity: "uncommon" },
  { id: "spikearmadillo", name: "スパイクアルマジロ", type: "creature", element: "earth", set: 2, cost: 70, st: 30, hp: 50, ab: ["armor"], rarity: "uncommon" },
  { id: "gemeater",     name: "宝石喰いジェムイーター", type: "creature", element: "earth", set: 2, cost: 70, st: 30, hp: 45, ab: ["mine"], rarity: "uncommon" },
  { id: "duneworm",     name: "デューンウォーム", type: "creature", element: "earth", set: 2, cost: 75,  st: 45, hp: 40, ab: ["pierce"] },
  { id: "dwarfforeman", name: "ドワーフフォアマン", type: "creature", element: "earth", set: 2, cost: 80, st: 30, hp: 50, ab: ["mine", "guard"], rarity: "uncommon" },
  { id: "gaiashaman",   name: "ガイアシャーマン", type: "creature", element: "earth", set: 2, cost: 85,  st: 40, hp: 45, ab: ["magicatk"], rarity: "uncommon" },
  { id: "terracotta",   name: "テラコッタソルジャー", type: "creature", element: "earth", set: 2, cost: 85, st: 40, hp: 55, ab: [] },
  { id: "hillgiant",    name: "ヒルジャイアント", type: "creature", element: "earth", set: 2, cost: 90,  st: 50, hp: 50, ab: [] },
  { id: "stonesentinel",name: "ストーンセンチネル", type: "creature", element: "earth", set: 2, cost: 80, st: 20, hp: 70, ab: ["immobile"], rarity: "uncommon" },
  { id: "mountainogre", name: "マウンテンオーガ", type: "creature", element: "earth", set: 2, cost: 95,  st: 55, hp: 45, ab: ["assault"], rarity: "uncommon" },
  { id: "crystalgolem", name: "クリスタルゴーレム", type: "creature", element: "earth", set: 2, cost: 95, st: 40, hp: 65, ab: ["armor"], rarity: "rare" },
  { id: "landturtle",   name: "ランドタートル",   type: "creature", element: "earth", set: 2, cost: 100, st: 20, hp: 80, ab: ["immobile", "armor"], rarity: "rare" },
  { id: "earthwyvern",  name: "アースワイバーン", type: "creature", element: "earth", set: 2, cost: 110, st: 55, hp: 55, ab: ["pierce"], rarity: "uncommon" },
  { id: "obsidianknight", name: "オブシディアンナイト", type: "creature", element: "earth", set: 2, cost: 115, st: 55, hp: 60, ab: ["armor"], rarity: "rare" },
  { id: "terradragon",  name: "大地竜テラドラゴン", type: "creature", element: "earth", set: 2, cost: 130, st: 60, hp: 70, ab: ["grow"], rarity: "rare" },
  { id: "atlas",        name: "山峰の巨人アトラス", type: "creature", element: "earth", set: 2, cost: 150, st: 70, hp: 85, ab: ["armor", "guard"], rarity: "legendary" },
  // --- 水（吸収・魔法・流転） ---
  { id: "bubblefish",   name: "バブルフィッシュ", type: "creature", element: "water", set: 2, cost: 30,  st: 15, hp: 30, ab: [] },
  { id: "coralcrab",    name: "コーラルクラブ",   type: "creature", element: "water", set: 2, cost: 45,  st: 20, hp: 40, ab: ["armor"] },
  { id: "streamotter",  name: "ストリームオター", type: "creature", element: "water", set: 2, cost: 45,  st: 30, hp: 30, ab: ["first"] },
  { id: "snowfairy",    name: "スノーフェアリー", type: "creature", element: "water", set: 2, cost: 50,  st: 25, hp: 40, ab: ["pack"] },
  { id: "leechslime",   name: "リーチスライム",   type: "creature", element: "water", set: 2, cost: 55,  st: 25, hp: 35, ab: ["absorb"] },
  { id: "shellknight",  name: "シェルナイト",     type: "creature", element: "water", set: 2, cost: 55,  st: 30, hp: 45, ab: [] },
  { id: "mistwisp",     name: "ミストウィスプ",   type: "creature", element: "water", set: 2, cost: 55,  st: 25, hp: 35, ab: ["magicatk"], rarity: "uncommon" },
  { id: "frostwolf",    name: "フロストウルフ",   type: "creature", element: "water", set: 2, cost: 60,  st: 40, hp: 30, ab: ["first"] },
  { id: "harpoonmerman",name: "ハープーンマーマン", type: "creature", element: "water", set: 2, cost: 65, st: 35, hp: 35, ab: ["ranged"], rarity: "uncommon" },
  { id: "snowharpy",    name: "スノーハーピー",   type: "creature", element: "water", set: 2, cost: 70,  st: 40, hp: 35, ab: ["first"] },
  { id: "nereid",       name: "水霊ネレイド",     type: "creature", element: "water", set: 2, cost: 75,  st: 35, hp: 45, ab: ["rebirth"], rarity: "uncommon" },
  { id: "tidemaiden",   name: "潮の巫女タイドメイデン", type: "creature", element: "water", set: 2, cost: 75, st: 40, hp: 40, ab: ["magicatk"], rarity: "uncommon" },
  { id: "abyssangler",  name: "アビスアングラー", type: "creature", element: "water", set: 2, cost: 80,  st: 45, hp: 45, ab: ["capture"], rarity: "uncommon" },
  { id: "frostlancer",  name: "フロストランサー", type: "creature", element: "water", set: 2, cost: 90,  st: 50, hp: 45, ab: ["pierce"], rarity: "uncommon" },
  { id: "tideserpent",  name: "タイドサーペント", type: "creature", element: "water", set: 2, cost: 95,  st: 50, hp: 55, ab: [] },
  { id: "kelpie",       name: "ケルピー",         type: "creature", element: "water", set: 2, cost: 85,  st: 45, hp: 50, ab: [] },
  { id: "glaciergolem", name: "グレイシャーゴーレム", type: "creature", element: "water", set: 2, cost: 105, st: 45, hp: 70, ab: ["armor"], rarity: "rare" },
  { id: "oceanpriestess", name: "オーシャンプリーステス", type: "creature", element: "water", set: 2, cost: 110, st: 50, hp: 50, ab: ["absorb", "magicatk"], rarity: "rare" },
  { id: "umibozu",      name: "ウミボウズ",       type: "creature", element: "water", set: 2, cost: 120, st: 60, hp: 60, ab: ["absorb"], rarity: "rare" },
  { id: "frostdragon",  name: "氷竜フロストドラゴン", type: "creature", element: "water", set: 2, cost: 130, st: 65, hp: 60, ab: ["magicatk"], rarity: "rare" },
  { id: "maelstrom",    name: "大渦の主メイルシュトローム", type: "creature", element: "water", set: 2, cost: 145, st: 65, hp: 75, ab: ["absorb", "capture"], rarity: "legendary" },
  // --- 無属性（機械・時間・メタ。全員レア以上＝パック/交換所でのみ入手） ---
  { id: "tinsoldier",   name: "ブリキ兵ティンソルジャー", type: "creature", element: "neutral", set: 2, cost: 50, st: 30, hp: 30, ab: ["pack"], rarity: "rare" },
  { id: "clockbeetle",  name: "クロックワークビートル", type: "creature", element: "neutral", set: 2, cost: 55, st: 25, hp: 40, ab: ["armor"], rarity: "rare" },
  { id: "willowisp",    name: "ウィルオーウィスプ", type: "creature", element: "neutral", set: 2, cost: 60, st: 25, hp: 25, ab: ["physnull"], rarity: "rare" },
  { id: "shadow",       name: "シャドウ",         type: "creature", element: "neutral", set: 2, cost: 65,  st: 30, hp: 30, ab: ["ranged"], rarity: "rare" },
  { id: "chronorabbit", name: "クロノラビット",   type: "creature", element: "neutral", set: 2, cost: 70,  st: 35, hp: 30, ab: ["first", "fly"], rarity: "rare" },
  { id: "littlemimic",  name: "リトルミミック",   type: "creature", element: "neutral", set: 2, cost: 70,  st: 15, hp: 25, ab: ["mimic"], rarity: "rare" },
  { id: "fortunecat",   name: "招き猫フォーチュンキャット", type: "creature", element: "neutral", set: 2, cost: 75, st: 30, hp: 40, ab: ["mine", "lucky"], rarity: "rare" },
  { id: "joker",        name: "ジョーカー",       type: "creature", element: "neutral", set: 2, cost: 85,  st: 35, hp: 35, ab: ["lucky", "lastward"], rarity: "rare" },
  { id: "gremlin",      name: "グレムリン",       type: "creature", element: "neutral", set: 2, cost: 85,  st: 30, hp: 40, ab: ["dispel"], rarity: "rare" },
  { id: "livingarmor",  name: "リビングアーマー", type: "creature", element: "neutral", set: 2, cost: 90,  st: 40, hp: 60, ab: ["armor"], rarity: "rare" },
  { id: "pegasus",      name: "ペガサス",         type: "creature", element: "neutral", set: 2, cost: 90,  st: 50, hp: 45, ab: ["first", "fly"], rarity: "rare" },
  { id: "nightmare",    name: "ナイトメア",       type: "creature", element: "neutral", set: 2, cost: 95,  st: 50, hp: 40, ab: ["magicatk"], rarity: "rare" },
  { id: "etherdrake",   name: "エーテルドレイク", type: "creature", element: "neutral", set: 2, cost: 110, st: 55, hp: 50, ab: ["magicatk", "spellproof"], rarity: "rare" },
  { id: "mirrorknight", name: "鏡騎士ミラーナイト", type: "creature", element: "neutral", set: 2, cost: 120, st: 40, hp: 55, ab: ["physreflect"], rarity: "legendary" },
  { id: "orichalcum",   name: "オリハルコンゴーレム", type: "creature", element: "neutral", set: 2, cost: 130, st: 60, hp: 80, ab: ["armor", "spellproof"], rarity: "legendary" },
  { id: "chaoschimera", name: "カオスキメラ",     type: "creature", element: "neutral", set: 2, cost: 140, st: 60, hp: 55, ab: ["double", "lastward"], rarity: "legendary" },
  // --- 🏛️建造物（クリーチャーのサブタイプ。ST0・不動・バトルで反撃しない据え付けの施設） ---
  { id: "signaltower", name: "狼煙台",     type: "creature", element: "fire",    set: 2, cost: 60,  st: 0, hp: 45, ab: ["immobile", "warfire"],  structure: true, rarity: "uncommon" },
  { id: "greenhouse",  name: "温室庭園",   type: "creature", element: "wood",    set: 2, cost: 65,  st: 0, hp: 55, ab: ["immobile", "garden"],   structure: true, rarity: "uncommon" },
  { id: "miningtower", name: "採掘櫓",     type: "creature", element: "earth",   set: 2, cost: 75,  st: 0, hp: 55, ab: ["immobile", "mine"],     structure: true, mineGain: 30, rarity: "rare" },
  { id: "lighthouse",  name: "灯台",       type: "creature", element: "water",   set: 2, cost: 60,  st: 0, hp: 50, ab: ["immobile", "harbor"],   structure: true, rarity: "uncommon" },
  { id: "trademarket", name: "交易市場",   type: "creature", element: "neutral", set: 2, cost: 60,  st: 0, hp: 50, ab: ["immobile", "merchant"], structure: true, rarity: "uncommon" },
  { id: "watchtower",  name: "見張り塔",   type: "creature", element: "neutral", set: 2, cost: 70,  st: 0, hp: 60, ab: ["immobile", "beacon"],   structure: true, rarity: "uncommon" },
  { id: "fortress",    name: "大砦",       type: "creature", element: "earth",   set: 2, cost: 100, st: 0, hp: 95, ab: ["immobile", "armor"],    structure: true, rarity: "rare" },
  { id: "cathedral",   name: "大聖堂",     type: "creature", element: "neutral", set: 2, cost: 120, st: 0, hp: 75, ab: ["immobile", "festival"], structure: true, rarity: "legendary" },
  // --- 👑精霊王サイクル（300Gの別格レジェンド。各属性の新能力の象徴＝ボス級フィニッシャー） ---
  { id: "ignisking",  name: "焔王イグニス",     type: "creature", element: "fire",    set: 2, cost: 300, st: 120, hp: 100, ab: ["ranged", "lucky"],       rarity: "legendary" },
  { id: "sylvanking", name: "翠王シルヴァン",   type: "creature", element: "wood",    set: 2, cost: 300, st: 95,  hp: 135, ab: ["pack", "capture"],       rarity: "legendary" },
  { id: "terraking",  name: "岩帝テラガイア",   type: "creature", element: "earth",   set: 2, cost: 300, st: 85,  hp: 155, ab: ["grow", "armor"],         rarity: "legendary" },
  { id: "nereusking", name: "海王ネレウス",     type: "creature", element: "water",   set: 2, cost: 300, st: 105, hp: 125, ab: ["absorb", "magicatk"],    rarity: "legendary" },
  { id: "aeonking",   name: "時空王アイオーン", type: "creature", element: "neutral", set: 2, cost: 300, st: 110, hp: 110, ab: ["first", "spellproof", "fly"], rarity: "legendary" },
  // --- 武器（第二弾） ---
  { id: "shortspear",  name: "ショートスピア",   type: "item", set: 2, cost: 30,  st: 15, hp: 0, desc: "バトル時 ST+15" },
  { id: "flail",       name: "フレイル",         type: "item", set: 2, cost: 55,  st: 30, hp: 0, desc: "バトル時 ST+30" },
  { id: "warhorn",     name: "ウォーホーン",     type: "item", set: 2, cost: 60,  st: 15, hp: 0, grant: ["pack"], rarity: "uncommon", desc: "ST+15・群れを得る（自分の同属性クリーチャー1体につきST+5）" },
  { id: "braveblade",  name: "ブレイブブレイド", type: "item", set: 2, cost: 70,  st: 20, hp: 0, grant: ["lastward"], rarity: "uncommon", desc: "ST+20・背水を得る（HP半分以下でST+25）" },
  { id: "warhammer",   name: "ウォーハンマー",   type: "item", set: 2, cost: 85,  st: 45, hp: 0, rarity: "uncommon", desc: "バトル時 ST+45" },
  { id: "hunterbow",   name: "ハンターボウ",     type: "item", set: 2, cost: 90,  st: 20, hp: 0, grant: ["ranged"], rarity: "rare", desc: "ST+20・遠隔を得る（侵略・侵攻で相手の反撃を受けない）" },
  { id: "souleater",   name: "ソウルイーター",   type: "item", set: 2, cost: 100, st: 30, hp: 0, grant: ["absorb"], rarity: "rare", desc: "ST+30・吸収を得る（与えたダメージの半分だけHP回復）" },
  { id: "flamberge",   name: "フランベルジュ",   type: "item", set: 2, cost: 115, st: 60, hp: 0, rarity: "rare", desc: "バトル時 ST+60" },
  { id: "gungnir",     name: "グングニル",       type: "item", set: 2, cost: 140, st: 50, hp: 0, grant: ["pierce", "first"], rarity: "legendary", desc: "ST+50・貫通と先制を得る（神槍は外れず、誰よりも速い）" },
  // --- 防具（第二弾） ---
  { id: "buckler",      name: "バックラー",       type: "item", set: 2, cost: 30,  st: 0,  hp: 15, desc: "バトル時 HP+15" },
  { id: "chainmail",    name: "チェインメイル",   type: "item", set: 2, cost: 55,  st: 0,  hp: 30, desc: "バトル時 HP+30" },
  { id: "stonering",    name: "硬殻の指輪ストーンリング", type: "item", set: 2, cost: 65, st: 0, hp: 20, grant: ["armor"], rarity: "uncommon", desc: "HP+20・硬殻を得る（受けるダメージを常に10軽減）" },
  { id: "spikemail",    name: "スパイクメイル",   type: "item", set: 2, cost: 75,  st: 15, hp: 25, rarity: "uncommon", desc: "バトル時 ST+15 / HP+25（棘の鎧）" },
  { id: "crystalarmor", name: "クリスタルアーマー", type: "item", set: 2, cost: 85, st: 0, hp: 45, rarity: "uncommon", desc: "バトル時 HP+45" },
  { id: "dragonscale",  name: "ドラゴンスケイル", type: "item", set: 2, cost: 115, st: 0,  hp: 60, rarity: "rare", desc: "バトル時 HP+60" },
  { id: "aegisshield",  name: "イージスの盾",     type: "item", set: 2, cost: 135, st: 0,  hp: 30, grant: ["physnull"], rarity: "legendary", desc: "HP+30・このバトル中、物理無効を得る（魔法攻撃だけが通る）" },
  // --- 📜巻物（使うと攻撃が「記載ST固定の魔法攻撃」になる。本体STや強襲・属性補正は乗らない） ---
  { id: "scrollice",     name: "アイスニードルの巻物", type: "item", set: 2, cost: 30, st: 0, hp: 0, scroll: 30, rarity: "common", desc: "📜攻撃がST30固定の魔法攻撃になる（本体ST無視・物理無効/反射を貫く）" },
  { id: "scrollfire",    name: "ファイアボルトの巻物", type: "item", set: 2, cost: 50, st: 0, hp: 0, scroll: 45, rarity: "uncommon", desc: "📜攻撃がST45固定の魔法攻撃になる（本体ST無視・物理無効/反射を貫く）" },
  { id: "scrollacid",    name: "溶解の巻物",           type: "item", set: 2, cost: 65, st: 0, hp: 0, scroll: 40, grant: ["pierce"], rarity: "uncommon", desc: "📜攻撃がST40固定の魔法攻撃になり、貫通を得る（土地の加護を溶かす）" },
  { id: "scrollwind",    name: "ウィンドカッターの巻物", type: "item", set: 2, cost: 70, st: 0, hp: 0, scroll: 40, grant: ["first"], rarity: "uncommon", desc: "📜攻撃がST40固定の魔法攻撃になり、先制を得る（風の刃は誰よりも速い）" },
  { id: "scrolldrain",   name: "ドレインソウルの巻物", type: "item", set: 2, cost: 75, st: 0, hp: 0, scroll: 35, grant: ["absorb"], rarity: "rare", desc: "📜攻撃がST35固定の魔法攻撃になり、吸収を得る（与えたダメージの半分だけHP回復）" },
  { id: "scrollthunder", name: "サンダーボルトの巻物", type: "item", set: 2, cost: 80, st: 0, hp: 0, scroll: 60, rarity: "rare", desc: "📜攻撃がST60固定の魔法攻撃になる（本体ST無視・物理無効/反射を貫く）" },
  { id: "scrollmirror",  name: "写し身の巻物",         type: "item", set: 2, cost: 60, st: 0, hp: 0, scroll: 1, scrollMirror: true, rarity: "rare", desc: "📜攻撃が「相手の基本STと同じ値」の固定魔法攻撃になる（強敵ほど強い一撃を写し返す）" },
  { id: "scrollmeteor",  name: "メテオストームの巻物", type: "item", set: 2, cost: 110, st: 0, hp: 0, scroll: 75, rarity: "legendary", desc: "📜攻撃がST75固定の魔法攻撃になる（本体ST無視・物理無効/反射を貫く）" },
  // --- 特殊アイテム（第二弾） ---
  { id: "calmcharm",     name: "平静のお守り",     type: "item", set: 2, cost: 45,  st: 0,  hp: 15, noCrit: true, rarity: "uncommon", desc: "HP+15・相手の会心の一撃を封じる（豪運持ちにも有効）" },
  { id: "smokebomb",     name: "煙玉",             type: "item", set: 2, cost: 50,  st: 0,  hp: 0,  escape: true, rarity: "uncommon", desc: "【防衛側専用】バトルを行わず土地を明け渡し、クリーチャーは手札に戻る（土地レベルは残る＝命あっての物種）" },
  { id: "chainnet",      name: "拘束鎖チェインネット", type: "item", set: 2, cost: 55, st: 10, hp: 0, grant: ["capture"], rarity: "uncommon", desc: "ST+10・捕縛を得る（防衛で撃退した侵略者を1ターン拘束）" },
  { id: "berserkpotion", name: "バーサクポーション", type: "item", set: 2, cost: 60, st: 35, hp: -15, rarity: "uncommon", desc: "バトル時 ST+35 / HP-15（力を絞り出す自傷の劇薬）" },
  { id: "giantbelt",     name: "ジャイアントベルト", type: "item", set: 2, cost: 70, st: 25, hp: 25, rarity: "uncommon", desc: "バトル時 ST+25 / HP+25" },
  { id: "rebirthamulet", name: "転生の護符",       type: "item", set: 2, cost: 70,  st: 0,  hp: 10, grant: ["rebirth"], rarity: "rare", desc: "HP+10・このバトルで倒されても手札に戻る（転生を得る）" },
  { id: "hazecloak",     name: "幻惑のマント",     type: "item", set: 2, cost: 90,  st: 0,  hp: 20, stDebuff: 20, rarity: "rare", desc: "HP+20・相手のST-20（最低10。霞んで狙いが定まらない）" },
  { id: "duelglove",     name: "決闘のグローブ",   type: "item", set: 2, cost: 110, st: 20, hp: 0, grant: ["double"], rarity: "rare", desc: "ST+20・連撃を得る（バトルで続けて2回攻撃）" },
  // ============================================================
  // 第二弾スペル（v20・55種）。noCpu:true はCPUの自動デッキに入れない
  // （AIの発動条件を用意していない／人間の判断が要るカード）
  // ============================================================
  // --- 経済（9種） ---
  { id: "blessfire",  name: "火脈の恵み",   type: "spell", set: 2, cost: 50, spell: "elembless", elem: "fire",  icon: "🔥", desc: "自分の火属性の土地1つにつき +70G" },
  { id: "blesswood",  name: "収穫の恵み",   type: "spell", set: 2, cost: 50, spell: "elembless", elem: "wood",  icon: "🌾", desc: "自分の木属性の土地1つにつき +70G" },
  { id: "blessearth", name: "鉱脈の恵み",   type: "spell", set: 2, cost: 50, spell: "elembless", elem: "earth", icon: "⛏️", desc: "自分の地属性の土地1つにつき +70G" },
  { id: "blesswater", name: "潮流の恵み",   type: "spell", set: 2, cost: 50, spell: "elembless", elem: "water", icon: "🌊", desc: "自分の水属性の土地1つにつき +70G" },
  { id: "goldrush",   name: "ゴールドラッシュ", type: "spell", set: 2, cost: 60, spell: "goldrush", rarity: "uncommon", icon: "💰", desc: "現在の所持魔力の20%を得る（最大250G。富める者はさらに富む）" },
  { id: "tollpass",   name: "通行手形",     type: "spell", set: 2, cost: 60, spell: "tollpass", rarity: "uncommon", noCpu: true, icon: "📜", desc: "次に敵地で払う通行料1回が無料になる（高額地帯を切り抜ける切符）" },
  { id: "taxcollect", name: "タックスコレクト", type: "spell", set: 2, cost: 70, spell: "taxcollect", rarity: "uncommon", icon: "🧾", desc: "相手の所有土地1つにつき30Gを、その持ち主から徴収する" },
  { id: "cauldron",   name: "錬金大釜",     type: "spell", set: 2, cost: 70, spell: "cauldron", rarity: "uncommon", noCpu: true, icon: "⚗️", desc: "手札を2枚まで選んで捨て、1枚につき+130G（アルケミーの上位）" },
  { id: "pawnshop",   name: "質入れ",       type: "spell", set: 2, cost: 60, spell: "pawnshop", rarity: "uncommon", noCpu: true, icon: "🏦", desc: "自分の土地1つをLv-1し、下がった価値の120%を得る（グロースの逆＝土地を現金化）" },
  // --- ドロー・手札（4種） ---
  { id: "foresight",   name: "予知",         type: "spell", set: 2, cost: 30, spell: "foresight", noCpu: true, icon: "🔮", desc: "山札の上3枚を見て、好きな順に並べ替える" },
  { id: "revelation",  name: "天啓",         type: "spell", set: 2, cost: 45, spell: "revelation", icon: "💡", desc: "カードを1枚引き、さらに+50G" },
  { id: "inspiration", name: "インスピレーション", type: "spell", set: 2, cost: 60, spell: "inspiration", rarity: "uncommon", icon: "✨", desc: "カードを3枚引き、そのあと手札から1枚捨てる" },
  { id: "gravecall",   name: "墓所の呼び声", type: "spell", set: 2, cost: 90, spell: "gravecall", rarity: "rare", icon: "🪦", desc: "自分の捨て札から2枚まで選んで手札に戻す（サルベージの上位）" },
  // --- 移動（6種） ---
  { id: "tailwind",   name: "追い風",       type: "spell", set: 2, cost: 35, spell: "tailwind", noCpu: true, icon: "🍃", desc: "次のダイスの出目に+2する（ダイスブーストの倍化とは加算の順で併用可）" },
  { id: "backstep",   name: "バックステップ", type: "spell", set: 2, cost: 40, spell: "backstep", rarity: "uncommon", noCpu: true, icon: "↩️", desc: "自分のコマを1〜3マス後ろへ戻す（移動のみ＝マスの効果・関門は発動しない。そのあと通常どおりダイスで移動）" },
  { id: "marchorder", name: "進軍号令",     type: "spell", set: 2, cost: 70, spell: "marchorder", rarity: "uncommon", noCpu: true, icon: "🎺", desc: "このターン、行軍費なしで②クリーチャー侵攻を行える（①で行動していても②の権利が残る）" },
  { id: "regroup",    name: "集結",         type: "spell", set: 2, cost: 90, spell: "regroup", rarity: "rare", noCpu: true, icon: "🔀", desc: "自分のクリーチャー2体の位置を入れ替える（HP・土地レベルはそのまま）" },
  { id: "posswap",    name: "ポジションスワップ", type: "spell", set: 2, cost: 100, spell: "posswap", rarity: "rare", noCpu: true, icon: "♟️", desc: "相手のコマと自分のコマの位置を入れ替える（マスの効果は発動しない）" },
  { id: "deport",     name: "強制送還",     type: "spell", set: 2, cost: 120, spell: "deport", rarity: "rare", icon: "🏰", desc: "相手のコマを城へ送り返す（周回はつかない。凱旋間際の相手を押し戻せ）" },
  // --- バトル支援（5種） ---
  { id: "bravery",   name: "決死の覚悟",   type: "spell", set: 2, cost: 40, spell: "bravery", noCpu: true, icon: "🎯", desc: "次の自分のバトルで会心率50%（会心＝ダメージ1.5倍）" },
  { id: "warcry",    name: "ウォークライ", type: "spell", set: 2, cost: 50, spell: "warcry", noCpu: true, icon: "📣", desc: "次の自分のバトルで ST+20（侵略でも防衛でも）" },
  { id: "guardwind", name: "護りの風",     type: "spell", set: 2, cost: 50, spell: "guardwind", noCpu: true, icon: "🌬️", desc: "次に防衛する自軍クリーチャーの HP+20" },
  { id: "blessing",  name: "ブレッシング", type: "spell", set: 2, cost: 70, spell: "blessing", rarity: "rare", icon: "🕊️", desc: "自軍クリーチャー1体を永続強化: ST/最大HP+10（成長と同じ枠を使い、合計+25まで）" },
  { id: "siege",     name: "攻城の号令",   type: "spell", set: 2, cost: 100, spell: "siege", rarity: "rare", noCpu: true, icon: "⚔️", desc: "このターンの自分の侵略・侵攻バトルで ST+25" },
  // --- 土地（7種） ---
  { id: "highsell",   name: "高値売却",     type: "spell", set: 2, cost: 60, spell: "highsell", rarity: "uncommon", noCpu: true, icon: "💱", desc: "自分の土地1つを価値の100%で売却する（通常の強制売却は70%。駐留クリーチャーは手札に戻る）" },
  { id: "veinfind",   name: "鉱脈発見",     type: "spell", set: 2, cost: 80, spell: "veinfind", rarity: "rare", icon: "💎", desc: "自分の土地1つに魔力鉱脈を付与: 以後、自分のターン開始時+20G（永続。その土地を失うと消える）" },
  { id: "assimilate", name: "属性同化",     type: "spell", set: 2, cost: 100, spell: "assimilate", rarity: "rare", noCpu: true, icon: "🌀", desc: "自分の土地1つの属性に、隣接する自領すべての属性を合わせる（連鎖の一括組み替え）" },
  { id: "curseland",  name: "カースランド", type: "spell", set: 2, cost: 110, spell: "curseland", rarity: "rare", icon: "🕯️", desc: "敵の土地1つの通行料を半減する（2ラウンド）" },
  { id: "fortify",    name: "城塞化",       type: "spell", set: 2, cost: 120, spell: "fortify", rarity: "rare", icon: "🏯", desc: "自分の土地1つの「土地の加護」を永続的に2倍にする（属性一致の守り手が鉄壁に）" },
  { id: "grandquake", name: "グランドクエイク", type: "spell", set: 2, cost: 170, spell: "grandquake", rarity: "legendary", icon: "🌋", desc: "敵の土地を2つまで選び、それぞれレベルを1下げる（クエイクの広域版）" },
  { id: "levelshift", name: "レベル移植",   type: "spell", set: 2, cost: 90, spell: "levelshift", rarity: "rare", noCpu: true, icon: "⚖️", desc: "自分の土地1つをLv-1し、別の自分の土地1つをLv+1する（投資の組み替え）" },
  // --- 妨害（10種） ---
  { id: "spy",        name: "スパイ",       type: "spell", set: 2, cost: 45, spell: "spy", noCpu: true, icon: "🕵️", desc: "相手1人の手札をすべて見る" },
  { id: "cursedice",  name: "呪いのダイス", type: "spell", set: 2, cost: 60, spell: "cursedice", rarity: "uncommon", icon: "🎲", desc: "相手の次の出目は1〜3になる（ホーリーワードで4以上を指定していても3に抑え込む）" },
  { id: "mudswamp",   name: "泥沼",         type: "spell", set: 2, cost: 80, spell: "mudswamp", rarity: "uncommon", icon: "🟤", desc: "相手の次の移動は出目が半分になる（切り上げ）" },
  { id: "whisper",    name: "悪夢の囁き",   type: "spell", set: 2, cost: 85, spell: "whisper", rarity: "rare", icon: "😈", desc: "相手の手札からランダムに1枚捨てさせる" },
  { id: "manaburn",   name: "マナバーン",   type: "spell", set: 2, cost: 90, spell: "manaburn", rarity: "rare", icon: "🔥", desc: "相手の魔力の20%を消滅させる（奪えない・上限300G。富豪への嫌がらせ）" },
  { id: "nullfog",    name: "無力化の霧",   type: "spell", set: 2, cost: 95, spell: "nullfog", rarity: "rare", icon: "🌫️", desc: "敵クリーチャー1体の能力をすべて消す（2ラウンド。アイテムで得る能力は消えない）" },
  { id: "silencefog", name: "沈黙の霧",     type: "spell", set: 2, cost: 100, spell: "silencefog", rarity: "rare", icon: "🤫", desc: "相手は次の自分のターン、スペルを使えない" },
  { id: "truce",      name: "停戦協定",     type: "spell", set: 2, cost: 110, spell: "truce", rarity: "rare", icon: "🏳️", desc: "2ラウンドの間、全プレイヤーが侵略・侵攻できない（自分も含む＝逃げ切りの時間稼ぎ）" },
  { id: "freezerain", name: "フリーズレイン", type: "spell", set: 2, cost: 130, spell: "freezerain", rarity: "legendary", icon: "🧊", desc: "相手全員を次のターン1回休みにする（フリーズの全体版。三つ巴で輝く）" },
  { id: "miragefield", name: "蜃気楼",      type: "spell", set: 2, cost: 75, spell: "miragefield", rarity: "uncommon", icon: "🏜️", desc: "2ラウンドの間、自分の土地が敵の土地対象スペル（クエイク/カースランド等）の対象にならない（クリーチャーは対象になる）" },
  // --- 🕯️儀式（8種）: 追加コストとして手札1枚を捧げる ---
  { id: "r_harvest",  name: "豊穣の儀",     type: "spell", set: 2, cost: 80, spell: "r_harvest", ritual: true, rarity: "uncommon", icon: "🕯️", desc: "【儀式: 手札1枚を捧げる】+350G" },
  { id: "r_contract", name: "契約の儀",     type: "spell", set: 2, cost: 90, spell: "r_contract", ritual: true, rarity: "rare", noCpu: true, icon: "🕯️", desc: "【儀式: 手札1枚を捧げる】山札から好きなカード1枚を手札に加える（山札は切り直す）" },
  { id: "r_blaze",    name: "猛火の儀",     type: "spell", set: 2, cost: 100, spell: "r_blaze", ritual: true, rarity: "rare", icon: "🕯️", desc: "【儀式: 手札1枚を捧げる】敵クリーチャー1体に70ダメージ（護法・結界は対象外）" },
  { id: "r_revive",   name: "蘇生の儀",     type: "spell", set: 2, cost: 110, spell: "r_revive", ritual: true, rarity: "rare", icon: "🕯️", desc: "【儀式: 手札1枚を捧げる】自分の捨て札のクリーチャー1体を、好きな空き地へコスト不要で召喚する" },
  { id: "r_ages",     name: "星霜の儀",     type: "spell", set: 2, cost: 120, spell: "r_ages", ritual: true, rarity: "rare", icon: "🕯️", desc: "【儀式: 手札1枚を捧げる】自分の土地1つをLv+2する（Lv4まで）" },
  { id: "r_storm",    name: "嵐の儀",       type: "spell", set: 2, cost: 120, spell: "r_storm", ritual: true, rarity: "legendary", icon: "🕯️", desc: "【儀式: 手札1枚を捧げる】敵クリーチャー全体に25ダメージ（護法・結界は対象外。倒れたら土地は空き地に）" },
  { id: "r_time",     name: "時の儀",       type: "spell", set: 2, cost: 130, spell: "r_time", ritual: true, rarity: "legendary", icon: "🕯️", desc: "【儀式: 手札1枚を捧げる】このターン、①のあとにもう一度ダイスを振って移動し、①を行う" },
  { id: "r_purify",   name: "浄化の儀",     type: "spell", set: 2, cost: 80, spell: "r_purify", ritual: true, rarity: "uncommon", icon: "🕯️", desc: "【儀式: 手札1枚を捧げる】盤面の時限効果（結界・罠・霧・呪いなど）をすべて解除し、自軍クリーチャーを全回復する" },
  // --- 盤面エフェクト（6種・2ラウンドの時限効果） ---
  { id: "fx_market",    name: "市場開放",     type: "spell", set: 2, cost: 90, spell: "fx_market", fx: true, rarity: "uncommon", icon: "🏪", desc: "【盤面】2Rの間、カードマスで2枚ドロー（全員）" },
  { id: "fx_bud",       name: "春の芽吹き",   type: "spell", set: 2, cost: 90, spell: "fx_bud", fx: true, rarity: "rare", icon: "🌸", desc: "【盤面】2Rの間、自軍クリーチャーは自分のターン開始時HP+15回復する" },
  { id: "fx_war",       name: "戦火の世",     type: "spell", set: 2, cost: 110, spell: "fx_war", fx: true, rarity: "rare", icon: "🔥", desc: "【盤面】2Rの間、侵略・侵攻バトルの攻め側ST+20（全員＝攻めが強い世界に）" },
  { id: "fx_manastorm", name: "魔力嵐",       type: "spell", set: 2, cost: 120, spell: "fx_manastorm", fx: true, rarity: "rare", icon: "⚡", desc: "【盤面】2Rの間、すべての通行料1.5倍（全員＝土地持ちが得をする嵐）" },
  { id: "fx_silence",   name: "静寂のとばり", type: "spell", set: 2, cost: 100, spell: "fx_silence", fx: true, rarity: "rare", icon: "🌙", desc: "【盤面】2Rの間、対象を指定するスペル（メテオ/バニッシュ/ドレイン等）を全員使えない" },
  { id: "fx_goddess",   name: "女神の加護",   type: "spell", set: 2, cost: 130, spell: "fx_goddess", fx: true, rarity: "legendary", icon: "👼", desc: "【盤面】2Rの間、自分の土地の加護が2倍＋防衛の援護ST+10" },
];

const CARD_BY_ID = Object.fromEntries(CARD_DB.map(c => [c.id, c]));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// デッキ自動構築（30枚）: 主属性2つを厚めに + スペル + アイテム
// 属性は4種なので、主属性クリーチャー各6枚（2属性＝12）、副属性各3枚（残り2属性＝6）、
// スペル6枚、アイテム6枚＝合計30枚。biasElement を指定すると主属性の1つ目が固定される（ステージのCPU用）
// maxCost: このコストを超えるカードは入れない（弱い難易度のCPUほど低コスト＝弱いデッキになる）。
//   クリーチャーが枯れないよう、maxCost で候補が空になった場合はコスト昇順で最も安いものにフォールバックする。
function buildDeck(biasElement = null, maxCost = Infinity) {
  // 属性枠は土地属性の4種のみ（無属性クリーチャーはレア以上の特別枠＝自動デッキには入れず、構築デッキで使う）
  let elems = shuffle(LAND_ELEMENTS.slice());
  if (biasElement) elems = [biasElement, ...elems.filter(e => e !== biasElement)];
  const main = elems.slice(0, 2), sub = elems.slice(2); // main=2属性 / sub=残り2属性
  const deck = [];
  const pickType = (filter, n) => {
    const all = CARD_DB.filter(filter);
    if (all.length === 0) return;
    let pool = all.filter(c => c.cost <= maxCost);
    // maxCostで全滅したら、そのカテゴリの最安カードだけは使えるようにする（デッキが機能する保証）
    if (pool.length === 0) pool = [all.slice().sort((a, b) => a.cost - b.cost)[0]];
    for (let i = 0; i < n; i++) deck.push(pool[Math.floor(Math.random() * pool.length)].id);
  };
  // 建造物（ST0・反撃しない施設）と noCpu スペル（AIの発動条件が無い）は
  // CPU/おまかせデッキには入れない（構築デッキでは使える）
  main.forEach(e => pickType(c => c.type === "creature" && !c.structure && c.element === e, 6));
  sub.forEach(e => pickType(c => c.type === "creature" && !c.structure && c.element === e, 3));
  pickType(c => c.type === "spell" && !c.noCpu, 6);
  pickType(c => c.type === "item", 6);
  return shuffle(deck);
}
