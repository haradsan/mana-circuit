// ============================================================
// battle.js — 侵略バトルの解決（アイテム・属性相性・会心対応）
// v19: 第二弾の新能力（群れ/遠隔/吸収/硬殻/背水/看破/成長）・巻物・建造物に対応
// ============================================================
"use strict";

const CRIT_RATE       = 0.10; // 会心の一撃（ダメージ1.5倍）の基本確率
const CRIT_RATE_LUCKY = 0.25; // 豪運持ちの会心確率
const ARMOR_REDUCE    = 10;   // 硬殻のダメージ軽減量
const LASTWARD_ST     = 25;   // 背水のST補正（HP半分以下）
const PACK_ST_MAX     = 30;   // 群れのST上限（+5×6体分）
const GROW_STEP       = 5;    // 成長1段階あたりのST/HP上昇（上限は grown=5 ＝ +25）
const BLIGHT_DEF_HP   = 30;   // 🔥焦土（v25）の防衛時HP補正（代償として土地レベルが下がる）
const WEAPONLOVE_BONUS = 15;  // ⚔武芸（v29）: アイテム装備時の ST/HP 補正
const REBEL_BONUS      = 20;  // 🔥反骨（v29）: 劣勢（総資産が首位の80%未満）時の ST/HP 補正
const RESONANT_ITEM_MAX = 32; // ⚡共鳴武具（v29）: 能力数スケールの上限
// ⚖ 相乗の上限（v32・原さん要望「特性・コンボ・相性での絶対的なチートが出ないように」）:
// 「条件を満たすと乗る」相乗系の補正——群れ・応援・絆・武芸・反骨・共鳴武具・連携——は
// 足し合わせて ST+60 / HP+60 まで。個々の能力は今までどおり働き、通常の1〜2種の組み合わせには
// 届かない値＝「全部盛りで一撃500」のような重ね掛けデッキだけを止める安全弁。
// 土地の援護（landSupportSt・自前の上限40あり）や装備・成長・強襲など単発の補正は対象外。
const SYNERGY_CAP = 60;

// 成長（grow）の段階（0〜5）。creature = tile.creature（{cardId, hp, grown}）
function grownOf(creature) { return Math.min(5, (creature && creature.grown) || 0); }

// attCard: 侵略側カード / tile: 防衛側の土地 / attItem, defItem: 装備アイテム(null可)
// opts.rng: true なら会心の一撃あり（実戦用）。false（既定）は決定論的（AIのシミュ用）
// opts.g: 指定すると土地の援護（隣接自軍領地による防衛ST補正）と群れ（pack）を計算に含める
// opts.attackerId: 侵略側プレイヤーid（群れの集計に使う。省略時は侵略側の群れは0）
// opts.attGrown: 侵略側クリーチャーの成長段階（march＝盤上からの侵攻時のみ。手札からの侵略は0）
// opts.attSrcId: march の出撃元タイルid（群れの集計から自分自身を除くため）
// 返り値: { attackerWins, log, attHp, defHp, attExtra, defExtra, attDrain, defDrain,
//           attRebirth, defRebirth, defCapture }
// ※状態は変更しない（AIのシミュレーションにも使う）
function resolveBattle(attCard, tile, attItem = null, defItem = null, opts = {}) {
  const rng = !!opts.rng;
  let defCard = CARD_BY_ID[tile.creature.cardId];
  const log = [];
  // 🤝絆（v31）の判定は「模倣で差し替わる前の本来のカード」で行う（写し身は相方を持たない）
  const attOrig = attCard, defOrig = defCard;

  // 模倣（mimic・v17）: 相手カードの「基本ST・基本HP・能力」をそっくり写し取って戦う。
  // 名前と属性（無）はそのまま＝属性相性・土地の加護は発生しない。装備アイテムはコピーしない。
  // 両者が模倣なら互いに写し合うだけなので発動しない。防衛側の傷は「受けたダメージ量」として写し身へ引き継ぐ。
  const attMimicSwap = (attCard.ab || []).includes("mimic") && !(defCard.ab || []).includes("mimic");
  const defMimicSwap = (defCard.ab || []).includes("mimic") && !(attCard.ab || []).includes("mimic");
  const defWound = defCard.hp - (tile.creature.hp ?? defCard.hp); // これまでに受けているダメージ（成長分は負になり得る＝そのまま加算される）
  if (attMimicSwap) {
    log.push(`🎭 ${attCard.name}の模倣！ ${defCard.name}の力を写し取った（ST${defCard.st}/HP${defCard.hp}${defCard.ab.length ? "・" + defCard.ab.map(a => ABILITY_INFO[a].name).join("・") : ""}）`);
    attCard = { ...attCard, st: defCard.st, hp: defCard.hp, ab: defCard.ab.slice() };
  }
  if (defMimicSwap) {
    log.push(`🎭 ${defCard.name}の模倣！ ${attCard.name}の力を写し取った（ST${attCard.st}/HP${attCard.hp}${attCard.ab.length ? "・" + attCard.ab.map(a => ABILITY_INFO[a].name).join("・") : ""}）`);
    defCard = { ...defCard, st: attCard.st, hp: attCard.hp, ab: attCard.ab.slice() };
  }
  const defBaseHp = Math.max(1, defCard.hp - defWound); // 戦闘後HP残量（前回の傷／成長分を引き継ぐ）

  // 無力化の霧（v20）: 能力をすべて消された状態（2R）。カード固有の能力を無視する（アイテム付与は残る）
  const attCardNulled = !!opts.attNulled;
  const defCardNulled = !!(opts.g && typeof creatureNulled === "function" && creatureNulled(opts.g, tile.creature));
  if (attCardNulled) log.push(`🌫️ ${attCard.name}は無力化の霧に包まれている——能力を使えない！`);
  if (defCardNulled) log.push(`🌫️ ${defCard.name}は無力化の霧に包まれている——能力を使えない！`);

  // アイテム打消し: 🚫nullifyアイテム（ディスペルワード）または能力「看破」（グレムリン・v19）。
  // 看破はアイテムではないので打ち消されない（ただし無力化の霧では消える）
  const attDispel = !attCardNulled && (attCard.ab || []).includes("dispel");
  const defDispel = !defCardNulled && (defCard.ab || []).includes("dispel");
  const attNull = !!(attItem && attItem.nullify);
  const defNull = !!(defItem && defItem.nullify);
  const attItemEff = (defNull || defDispel) ? null : attItem; // 実際に効果を発揮する侵略側アイテム
  const defItemEff = (attNull || attDispel) ? null : defItem; // 実際に効果を発揮する防衛側アイテム
  if (attNull && defItem) log.push(`🚫 ${attItem.name}が${defCard.name}の${defItem.name}を打ち消した！`);
  if (defNull && attItem) log.push(`🚫 ${defItem.name}が${attCard.name}の${attItem.name}を打ち消した！`);
  if (attDispel && defItem && !attNull) log.push(`👁 ${attCard.name}の看破！ ${defCard.name}の${defItem.name}を打ち消した！`);
  if (defDispel && attItem && !defNull) log.push(`👁 ${defCard.name}の看破！ ${attCard.name}の${attItem.name}を打ち消した！`);

  // アイテムが付与する能力（アサシンダガーの先制など）も合算（打消し後の有効アイテムで判定）。
  // 無力化の霧（v20）中はカード固有の能力を除外（アイテム由来だけ残る）。
  // opts.attExtraAb/defExtraAb（v30）: スペル由来の一時付与（🛡見切りの構え＝endure）。アイテム付与と同じく霧でも消えない
  const abilities = (c, item, nulled, extra) => new Set([...(nulled ? [] : (c.ab || [])), ...((item && item.grant) || []), ...(extra || [])]);
  // 🤝絆（bond・v31）: 相方が自分の領地に駐留していれば発動する条件つき効果。
  // ここで判定するのは battle（ST/HP補正）と grant（バトル中だけ能力を得る）の2種類。
  // 侵略側は「盤上にいなくても」（＝手札から出しても）成立する＝後方に相方が控えている、という理解。
  const bondOf = (pid, card, nulled, exclTile) =>
    (!nulled && opts.g && pid != null && typeof bondActiveFor === "function")
      ? bondActiveFor(opts.g, pid, card, exclTile) : null;
  const attBond = bondOf(opts.attackerId, attOrig, attCardNulled, opts.attSrcId ?? null);
  const defBond = bondOf(tile.owner, defOrig, defCardNulled, tile.id);
  const bondGrant = b => (b && b.kind === "grant" && b.grant) ? b.grant : [];
  const attAb = abilities(attCard, attItemEff, attCardNulled, [...(opts.attExtraAb || []), ...bondGrant(attBond)]);
  const defAb = abilities(defCard, defItemEff, defCardNulled, [...(opts.defExtraAb || []), ...bondGrant(defBond)]);
  const bondSt = b => (b && b.kind === "battle") ? (b.st || 0) : 0;
  const bondHp = b => (b && b.kind === "battle") ? (b.hp || 0) : 0;
  const attBondSt = bondSt(attBond), attBondHp = bondHp(attBond);
  const defBondSt = bondSt(defBond), defBondHp = bondHp(defBond);
  const attReflect = (attItemEff && attItemEff.reflect) || 0; // 受けた攻撃を反射する割合
  const defReflect = (defItemEff && defItemEff.reflect) || 0;
  // 攻撃タイプ（v15）: 能力 magicatk か magicatk:true のアイテム（打消し後の有効アイテム）で攻撃が「魔法」になる。
  // 📜巻物（scroll・v19）も魔法攻撃扱い。物理無効・物理反射は「物理攻撃」だけを防ぐ／跳ね返す。
  const attScroll = attItemEff && attItemEff.scroll ? (attItemEff.scrollMirror ? defCard.st : attItemEff.scroll) : 0;
  const defScroll = defItemEff && defItemEff.scroll ? (defItemEff.scrollMirror ? attCard.st : defItemEff.scroll) : 0;
  const attMagic = attAb.has("magicatk") || !!(attItemEff && attItemEff.magicatk) || attScroll > 0;
  const defMagic = defAb.has("magicatk") || !!(defItemEff && defItemEff.magicatk) || defScroll > 0;

  // 成長（grow・v19）: 防衛側は tile.creature.grown、侵略側は opts.attGrown（march時のみ）。
  // v20: 🕊️ブレッシング（永続強化）も同じ grown 枠＝能力の有無に関わらず加算する
  const attGrown = Math.min(5, opts.attGrown || 0);
  const defGrown = grownOf(tile.creature);
  // 戦火の世（v20）: 2Rの間、侵略側ST+20（全員）
  const warFx = (opts.g && typeof activeFx === "function" && activeFx(opts.g, "war")) ? 20 : 0;
  // バトル支援スペル（v20）: ウォークライ/攻城の号令/護りの風/決死の覚悟（fightForがoptsで渡す）
  const attSpellSt = opts.attStBonus || 0;
  const defSpellSt = opts.defStBonus || 0;
  // 🃏伏せ札（v29）: fightForがバトル前に発動させた罠の効果（ピットトラップ=侵略者ST減／アンブッシュ=防衛ST増）
  const attTrapSt = opts.attTrapSt || 0;
  const defTrapSt = opts.defTrapSt || 0;
  // ⚔武芸（weaponlove・v29）: アイテム（二形・巻物含む）を装備しているとST/HP+15
  const attWeapon = attAb.has("weaponlove") && attItemEff ? WEAPONLOVE_BONUS : 0;
  const defWeapon = defAb.has("weaponlove") && defItemEff ? WEAPONLOVE_BONUS : 0;
  // 🔥反骨（rebel・v29）: 総資産が首位の80%未満の劣勢時にST/HP+20（判定はstate.jsのisUnderdog）
  const underdogOf = pid => !!(opts.g && pid != null && typeof isUnderdog === "function" &&
    opts.g.players[pid] && isUnderdog(opts.g, opts.g.players[pid]));
  const attRebel = attAb.has("rebel") && underdogOf(opts.attackerId) ? REBEL_BONUS : 0;
  const defRebel = defAb.has("rebel") && underdogOf(tile.owner) ? REBEL_BONUS : 0;
  // ⚡共鳴武具（v29）: 装備者の能力1つにつきST/HP+8（上限+32）。能力はアイテム付与込みの実効セットで数える
  const resonantOf = (itemEff, abSet, key) =>
    (itemEff && itemEff[key]) ? Math.min(RESONANT_ITEM_MAX, abSet.size * itemEff[key]) : 0;
  const attResoSt = resonantOf(attItemEff, attAb, "resonantSt"), attResoHp = resonantOf(attItemEff, attAb, "resonantHp");
  const defResoSt = resonantOf(defItemEff, defAb, "resonantSt"), defResoHp = resonantOf(defItemEff, defAb, "resonantHp");
  // 🗡トリックダガー（v29）: 防衛時、この土地に自分の伏せ札があれば（このバトルで発動した分も含む）ST/HP+20
  const defTrick = (defItemEff && defItemEff.trapSynergy && opts.defTrapSynergy) ? defItemEff.trapSynergy : 0;

  let attSt = attCard.st + (attItemEff ? attItemEff.st : 0) + (attAb.has("assault") ? 20 : 0) + RULES.invaderSt + attGrown * GROW_STEP + warFx + attSpellSt + attTrapSt + attWeapon + attRebel + attResoSt;
  let defSt = defCard.st + (defItemEff ? defItemEff.st : 0) + defGrown * GROW_STEP + defSpellSt + defTrapSt + defWeapon + defRebel + defResoSt + defTrick;
  if (warFx) log.push(`🔥 戦火の世！ 攻め手の${attCard.name}はST+${warFx}`);
  if (attSpellSt) log.push(`📣 支援の詠唱！ ${attCard.name}のST+${attSpellSt}`);
  if (defSpellSt) log.push(`📣 支援の詠唱！ ${defCard.name}のST+${defSpellSt}`);
  const advAtt = hasElemAdvantage(attCard.element, defCard.element);
  const advDef = hasElemAdvantage(defCard.element, attCard.element);
  if (advAtt) attSt += ELEM_ADV_ST;
  if (advDef) defSt += ELEM_ADV_ST;
  const support = opts.g ? landSupportSt(opts.g, tile) : 0; // 隣接自軍領地の援護（見張り塔の烽火も含む）

  // 群れ（pack・v19）: 盤面の自軍同属性クリーチャー1体につきST+5（自分自身は除く・上限+30）
  const packCount = (playerId, element, excludeId) => {
    if (!opts.g || playerId == null) return 0;
    return opts.g.tiles.filter(t => t.type === "LAND" && t.owner === playerId &&
      t.creature && t.id !== excludeId && CARD_BY_ID[t.creature.cardId].element === element).length;
  };
  const attPack = attAb.has("pack") ? Math.min(PACK_ST_MAX, packCount(opts.attackerId, attCard.element, opts.attSrcId ?? -1) * 5) : 0;
  const defPack = defAb.has("pack") ? Math.min(PACK_ST_MAX, packCount(tile.owner, defCard.element, tile.id) * 5) : 0;

  // 📣応援（cheer・v25）: 隣接する自領の応援役が「武具を貸す」ようにST/HPを上乗せする。
  // 防衛側はその土地、侵略側は march の出撃元タイル（手札からの侵略は盤上にいないので応援を受けられない）
  const cheerAt = t => (opts.g && t && typeof cheerCount === "function") ? cheerCount(opts.g, t) : 0;
  const attCheer = cheerAt(opts.attSrcId != null && opts.g ? opts.g.tiles[opts.attSrcId] : null) * CHEER_BONUS;
  const defCheer = cheerAt(tile) * CHEER_BONUS;

  attSt += attPack + attCheer + attBondSt;
  defSt += defPack + support + defCheer + defBondSt;

  // ⚖ 相乗の上限（v32）: 相乗系ST補正の合計が SYNERGY_CAP を超えた分は削る（📊の式にも「⚖上限」で出す）
  const attStOver = Math.max(0, (attPack + attCheer + attBondSt + attWeapon + attRebel + attResoSt) - SYNERGY_CAP);
  const defStOver = Math.max(0, (defPack + defCheer + defBondSt + defWeapon + defRebel + defResoSt + defTrick) - SYNERGY_CAP);
  attSt -= attStOver;
  defSt -= defStOver;
  if (attStOver) log.push(`⚖ 相乗の上限！ ${attCard.name}の重ね掛けST補正は+${SYNERGY_CAP}まで（-${attStOver}）`);
  if (defStOver) log.push(`⚖ 相乗の上限！ ${defCard.name}の重ね掛けST補正は+${SYNERGY_CAP}まで（-${defStOver}）`);

  const defBonus = attAb.has("pierce") ? 0 : landHpBonus(tile, defCard);
  const guardBonus = defAb.has("guard") ? 20 : 0;
  // 🔥焦土（blight・v25）: 守りは固い（防衛時HP+30）が、この土地でのバトル後にレベルが1下がる（main.jsが処理）
  const blightHp = defAb.has("blight") ? BLIGHT_DEF_HP : 0;
  const defWindHp = opts.defHpBonus || 0; // 護りの風（v20）
  if (defWindHp) log.push(`🌬️ 護りの風！ ${defCard.name}のHP+${defWindHp}`);
  // ⚖ 相乗の上限（v32）: HP側も同じグループ（応援・武芸・反骨・共鳴・連携・絆）の合計を SYNERGY_CAP まで。
  // 土地の加護・守護・焦土・護りの風・装備のHPは単発の補正なので対象外
  const attHpOver = Math.max(0, (attCheer + attWeapon + attRebel + attResoHp + attBondHp) - SYNERGY_CAP);
  const defHpOver = Math.max(0, (defCheer + defWeapon + defRebel + defResoHp + defTrick + defBondHp) - SYNERGY_CAP);
  if (attHpOver) log.push(`⚖ 相乗の上限！ ${attCard.name}の重ね掛けHP補正は+${SYNERGY_CAP}まで（-${attHpOver}）`);
  if (defHpOver) log.push(`⚖ 相乗の上限！ ${defCard.name}の重ね掛けHP補正は+${SYNERGY_CAP}まで（-${defHpOver}）`);
  const attExtra = (attItemEff ? attItemEff.hp : 0) + attCheer + attWeapon + attRebel + attResoHp + attBondHp - attHpOver;
  const defExtra = (defItemEff ? defItemEff.hp : 0) + defBonus + guardBonus + defWindHp + defCheer + blightHp + defWeapon + defRebel + defResoHp + defTrick + defBondHp - defHpOver;
  // 決死の覚悟（v20）: 会心率の底上げ（豪運と重複時は高い方）
  const attCritRate = Math.max(attAb.has("lucky") ? CRIT_RATE_LUCKY : CRIT_RATE, opts.attCritRate || 0);
  const defCritRate = Math.max(defAb.has("lucky") ? CRIT_RATE_LUCKY : CRIT_RATE, opts.defCritRate || 0);
  let attHp = attCard.hp + attGrown * GROW_STEP + attExtra;
  let defHp = defBaseHp + defExtra;

  // 🛡不屈（endure・v30）: バトル中一度だけ、倒される一撃を受けてもHP1で踏みとどまる。
  // 直撃・罠の直撃・反射・跳ね返り——どの経路でも「HPが0以下になった瞬間」に一度だけ発動する
  let attEndured = false, defEndured = false;
  const attEndureCheck = () => {
    if (attHp <= 0 && attAb.has("endure") && !attEndured) {
      attEndured = true; attHp = 1;
      log.push(`🛡 ${attCard.name}の不屈！ 倒れる寸前で踏みとどまった（HP1）`);
    }
  };
  const defEndureCheck = () => {
    if (defHp <= 0 && defAb.has("endure") && !defEndured) {
      defEndured = true; defHp = 1;
      log.push(`🛡 ${defCard.name}の不屈！ 倒れる寸前で踏みとどまった（HP1）`);
    }
  };

  // ⚡カウンターボルト（v29）: バトル前に侵略者へ直撃ダメージ。HPが尽きればバトルは始まらず撃退
  if (opts.attPreDmg) {
    attHp -= opts.attPreDmg;
    log.push(`⚡ ${opts.trapName || "罠"}の直撃！ ${attCard.name}に${opts.attPreDmg}ダメージ（残りHP ${Math.max(0, attHp)}）`);
    attEndureCheck(); // 🛡不屈は罠の必殺（即死圏の直撃）も一度だけ見切る
  }
  if (attTrapSt) log.push(`🃏 ${opts.trapName || "罠"}の効果！ ${attCard.name}のST${attTrapSt}`);
  if (defTrapSt) log.push(`🃏 ${opts.trapName || "罠"}の効果！ ${defCard.name}のST+${defTrapSt}`);
  if (attWeapon) log.push(`⚔ ${attCard.name}の武芸！ 武具が手に馴染み ST+${attWeapon}/HP+${attWeapon}`);
  if (defWeapon) log.push(`⚔ ${defCard.name}の武芸！ 武具が手に馴染み ST+${defWeapon}/HP+${defWeapon}`);
  if (attRebel) log.push(`🔥 ${attCard.name}の反骨！ 劣勢の闘志で ST+${attRebel}/HP+${attRebel}`);
  if (defRebel) log.push(`🔥 ${defCard.name}の反骨！ 劣勢の闘志で ST+${defRebel}/HP+${defRebel}`);
  if (attResoSt || attResoHp) log.push(`⚡ ${attItemEff.name}が${attCard.name}の力に共鳴！ ${attResoSt ? `ST+${attResoSt}` : `HP+${attResoHp}`}（能力${attAb.size}個）`);
  if (defResoSt || defResoHp) log.push(`⚡ ${defItemEff.name}が${defCard.name}の力に共鳴！ ${defResoSt ? `ST+${defResoSt}` : `HP+${defResoHp}`}（能力${defAb.size}個）`);
  if (defTrick) log.push(`🗡 ${defItemEff.name}が伏せ札と連携！ ${defCard.name}のST+${defTrick}/HP+${defTrick}`);
  // 🤝絆の発動ログ（誰と誰の絆で何が起きたのかを毎回はっきり出す）
  const bondLog = (b, card, side) => {
    if (!b) return;
    if (b.kind === "battle") log.push(`🤝 ${b.name}！ ${card.name}は仲間に応えて${b.st ? `ST+${b.st}` : ""}${b.st && b.hp ? "/" : ""}${b.hp ? `HP+${b.hp}` : ""}（${side}）`);
    else if (b.kind === "grant") log.push(`🤝 ${b.name}！ ${card.name}は${b.grant.map(a => ABILITY_INFO[a].name).join("・")}を得た（${side}）`);
  };
  bondLog(attBond, attOrig, "侵略側");
  bondLog(defBond, defOrig, "防衛側");

  // 📜巻物: 攻撃が「記載ST固定の魔法攻撃」に置き換わる＝本体ST・強襲・属性・援護・群れの補正は乗らない
  if (attScroll > 0) { attSt = attScroll; log.push(`📜 ${attCard.name}は${attItemEff.name}を展開！ 攻撃がST${attScroll}固定の魔法砲撃になる`); }
  if (defScroll > 0) { defSt = defScroll; log.push(`📜 ${defCard.name}は${defItemEff.name}を展開！ 反撃がST${defScroll}固定の魔法砲撃になる`); }
  // 幻惑のマント（stDebuff・v19）: 相手のSTを下げる（最低10）
  if (defItemEff && defItemEff.stDebuff) { attSt = Math.max(10, attSt - defItemEff.stDebuff); log.push(`🌫 ${defItemEff.name}の幻惑！ ${attCard.name}のST-${defItemEff.stDebuff}`); }
  if (attItemEff && attItemEff.stDebuff) { defSt = Math.max(10, defSt - attItemEff.stDebuff); log.push(`🌫 ${attItemEff.name}の幻惑！ ${defCard.name}のST-${attItemEff.stDebuff}`); }
  // 平静のお守り（noCrit・v19）: 相手の会心を封じる
  const attNoCrit = !!(defItemEff && defItemEff.noCrit); // 侵略側は会心を出せない
  const defNoCrit = !!(attItemEff && attItemEff.noCrit); // 防衛側は会心を出せない

  if (defBaseHp < defCard.hp) log.push(`🩹 ${defCard.name}は前の戦いの傷でHP${defBaseHp}から`);
  if (attItem) log.push(`⚔ ${attCard.name}は${attItem.name}を装備！`);
  if (defItem) log.push(`🛡 ${defCard.name}は${defItem.name}を装備！`);
  if (attAb.has("assault") && !attScroll) log.push(`⚔ ${attCard.name}の強襲！ ST+20`);
  if (attGrown > 0) log.push(`🌱 ${attCard.name}は成長している！ ST/HP+${attGrown * GROW_STEP}`);
  if (defGrown > 0) log.push(`🌱 ${defCard.name}は成長している！ ST/HP+${defGrown * GROW_STEP}`);
  if (attPack > 0 && !attScroll) log.push(`🐺 ${attCard.name}の群れ！ 仲間の数だけST+${attPack}`);
  if (defPack > 0 && !defScroll) log.push(`🐺 ${defCard.name}の群れ！ 仲間の数だけST+${defPack}`);
  if (RULES.invaderSt > 0) log.push(`🏟 闘技場の熱気！ 侵略側ST+${RULES.invaderSt}`);
  if (support > 0 && !defScroll) log.push(`🏰 ${defCard.name}は隣接する味方領地の援護！ ST+${support}`);
  if (advAtt && !attScroll) log.push(`${ELEMENTS[attCard.element].icon} 属性の優位！ ${attCard.name}のST+${ELEM_ADV_ST}`);
  if (advDef && !defScroll) log.push(`${ELEMENTS[defCard.element].icon} 属性の優位！ ${defCard.name}のST+${ELEM_ADV_ST}`);
  if (attAb.has("pierce") && landHpBonus(tile, defCard) > 0) {
    log.push(`⚔ ${attCard.name}の貫通！ 土地ボーナス無効`);
  } else if (defBonus > 0) {
    log.push(`🛡 ${defCard.name}は土地の加護でHP+${defBonus}`);
  }
  if (guardBonus > 0) log.push(`🛡 ${defCard.name}の守護！ HP+${guardBonus}`);
  if (blightHp > 0) log.push(`🔥 ${defCard.name}の焦土！ HP+${blightHp}（このバトルの後、土地は痩せる）`);
  if (attCheer > 0) log.push(`📣 隣接する味方の応援！ ${attCard.name}のST+${attCheer} / HP+${attCheer}`);
  if (defCheer > 0) log.push(`📣 隣接する味方の応援！ ${defCard.name}のST+${defCheer} / HP+${defCheer}`);
  if (attMagic) log.push(`✨ ${attCard.name}の攻撃は魔法攻撃！（物理無効・物理反射を貫く）`);
  if (defMagic) log.push(`✨ ${defCard.name}の攻撃は魔法攻撃！（物理無効・物理反射を貫く）`);

  // 遠隔（ranged・v19）: 侵略側が遠隔なら防衛側は一切反撃できない（先制でも）。
  // 建造物（structure・v19）: 防衛してもST0の施設なので反撃しない
  const attRanged = attAb.has("ranged");
  const defStruct = !!defCard.structure;
  if (attRanged) log.push(`🏹 ${attCard.name}の遠隔攻撃！ 相手の反撃を受けない`);
  if (defStruct) log.push(`🏛 ${defCard.name}は建造物——反撃できない`);

  // 攻撃順: 通常は侵略側が先。防衛側だけが先制持ちなら防衛側が先（侵略側が遠隔なら無効）
  const defFirst = defAb.has("first") && !attAb.has("first") && !attRanged && !defStruct;

  // 背水（lastward・v19）: HPがバトル開始時の半分以下になるとST+25（バトル中の被弾でも発動する）
  const attStartHp = attHp, defStartHp = defHp;
  let attLastwardOn = false, defLastwardOn = false;
  const attStOf = () => {
    const on = attAb.has("lastward") && !attScroll && attHp <= attStartHp / 2;
    if (on && !attLastwardOn) { attLastwardOn = true; log.push(`🔥 ${attCard.name}の背水！ 追い詰められてST+${LASTWARD_ST}`); }
    return attSt + (on ? LASTWARD_ST : 0);
  };
  const defStOf = () => {
    const on = defAb.has("lastward") && !defScroll && defHp <= defStartHp / 2;
    if (on && !defLastwardOn) { defLastwardOn = true; log.push(`🔥 ${defCard.name}の背水！ 追い詰められてST+${LASTWARD_ST}`); }
    return defSt + (on ? LASTWARD_ST : 0);
  };

  // ▼ バフの計算式を明示する（会心以外は決定論＝この数式どおりに殴り合う）。
  const bd = (total, base, parts) => {
    const terms = parts.filter(([, v]) => v).map(([lbl, v]) => `${v > 0 ? "+" : ""}${v}(${lbl})`);
    return terms.length ? `${total} ＝ ${base} ${terms.join(" ")}` : `${total}`;
  };
  const attHpParts = [["成長", attGrown * GROW_STEP], ["装備", attItemEff ? attItemEff.hp : 0], ["応援", attCheer], ["武芸", attWeapon], ["反骨", attRebel], ["共鳴", attResoHp], ["絆", attBondHp], ["⚖上限", -attHpOver], ["罠", -(opts.attPreDmg || 0)]];
  if (attScroll > 0) {
    log.push(`📊【式】侵略 ${attCard.name}: ST ${attSt}（📜巻物固定） ／ HP ${bd(attHp, attCard.hp, attHpParts)}`);
  } else {
    log.push(`📊【式】侵略 ${attCard.name}: ST ${bd(attSt, attCard.st, [["装備", attItemEff ? attItemEff.st : 0], ["強襲", attAb.has("assault") ? 20 : 0], ["属性", advAtt ? ELEM_ADV_ST : 0], ["成長", attGrown * GROW_STEP], ["群れ", attPack], ["応援", attCheer], ["闘技場", RULES.invaderSt], ["罠", attTrapSt], ["武芸", attWeapon], ["反骨", attRebel], ["共鳴", attResoSt], ["絆", attBondSt], ["⚖上限", -attStOver]])} ／ HP ${bd(attHp, attCard.hp, attHpParts)}`);
  }
  const defHpParts = [["装備", defItemEff ? defItemEff.hp : 0], ["土地の加護", defBonus], ["守護", guardBonus], ["焦土", blightHp], ["応援", defCheer], ["護りの風", defWindHp], ["武芸", defWeapon], ["反骨", defRebel], ["共鳴", defResoHp], ["連携", defTrick], ["絆", defBondHp], ["⚖上限", -defHpOver]];
  if (defScroll > 0) {
    log.push(`📊【式】防衛 ${defCard.name}: ST ${defSt}（📜巻物固定） ／ HP ${bd(defHp, defBaseHp, defHpParts)}`);
  } else {
    log.push(`📊【式】防衛 ${defCard.name}: ST ${bd(defSt, defCard.st, [["装備", defItemEff ? defItemEff.st : 0], ["属性", advDef ? ELEM_ADV_ST : 0], ["成長", defGrown * GROW_STEP], ["群れ", defPack], ["援護", support], ["応援", defCheer], ["罠", defTrapSt], ["武芸", defWeapon], ["反骨", defRebel], ["共鳴", defResoSt], ["連携", defTrick], ["絆", defBondSt], ["⚖上限", -defStOver]])} ／ HP ${bd(defHp, defBaseHp, defHpParts)}`);
  }
  // 侵略は「一撃で相手の実効HPを削り切れば占領」。硬殻は一撃ごとに-10されるためここで織り込む。
  const attBlocked = !attMagic && (defAb.has("physnull") || defAb.has("physreflect")); // 侵略の攻撃が通らない
  const defBlocked = !defMagic && (attAb.has("physnull") || attAb.has("physreflect")); // 防衛の反撃が通らない
  const defArmorCut = defAb.has("armor") ? ARMOR_REDUCE : 0;
  const attHitOnce = Math.max(0, attStOf() - defArmorCut);
  const attTotal = attAb.has("double") ? attHitOnce * 2 : attHitOnce;
  // 🛡不屈（v30）の防衛側は単発では必ずHP1で残る＝「1撃目で削り切り、2撃目でとどめ」の連撃だけが一撃圏
  const defCanEndure = defAb.has("endure");
  const canOneShot = !attBlocked && (defCanEndure
    ? (attAb.has("double") && attHitOnce > 0 && attHitOnce >= defHp)
    : attTotal >= defHp);
  const critHitOnce = Math.max(0, Math.floor(attStOf() * 1.5) - defArmorCut);
  const critReach = !attBlocked && !canOneShot && !attNoCrit && (defCanEndure
    ? (attAb.has("double") && critHitOnce > 0 && critHitOnce >= defHp)
    : critHitOnce * (attAb.has("double") ? 2 : 1) >= defHp);
  if (attBlocked) {
    log.push(`📊【式】決着: ${defCard.name}の${defAb.has("physnull") ? "物理無効" : "物理反射"}により侵略の物理攻撃は通らない → 占領不可${defAb.has("physreflect") ? "（攻撃はそっくり跳ね返る）" : ""}${defBlocked ? "　※反撃も通らない（両者無傷）" : ""}`);
  } else {
    const verdict = canOneShot ? "撃破して占領"
      : defCanEndure && attTotal >= defHp ? "🛡不屈がHP1で受け止める（単発の一撃では落ちない）"
      : `守られる（あと${defHp - attTotal}届かない${critReach ? "／💫会心が出れば届く" : ""}）`;
    log.push(`📊【式】決着: 侵略の一撃 ${attHitOnce}${defArmorCut ? `（硬殻-${defArmorCut}後）` : ""}${attAb.has("double") ? `×2(連撃)＝${attTotal}` : ""} ${attTotal >= defHp ? "≥" : "<"} 防衛の実効HP${defHp} → ${verdict}${defFirst ? "　※防衛が先制（侵略側HPが低いと反撃で討死）" : ""}${attRanged ? "　※遠隔＝反撃なし" : ""}${defBlocked && !attRanged ? `　※侵略側の${attAb.has("physnull") ? "物理無効" : "物理反射"}で防衛の反撃は通らない` : ""}${defAb.has("payback") && !attRanged && !defStruct ? "　※防衛は💢倍返し持ち（被弾後の反撃はダメージ2倍）" : ""}`);
  }

  // 一撃を計算（会心込み）。物理無効/物理反射（対象の能力）と魔法攻撃（攻撃側）・硬殻をここで解決する。
  // { remain: 対象の残HP, dmg: 与えたダメージ, bounced: 物理反射で攻撃側へ跳ね返ったダメージ } を返す
  const strike = (name, st, ab, isMagic, noCrit, critRate, targetName, targetAb, targetHp, mul = 1) => {
    let dmg = st;
    if (rng && !noCrit && Math.random() < critRate) {
      dmg = Math.floor(st * 1.5);
      log.push(`💫 ${name}の会心の一撃！！`);
    }
    dmg *= mul; // 💢倍返し（v30）: 被弾後の攻撃はダメージ2倍（会心とも重なる）
    if (!isMagic && targetAb.has("physnull")) {
      log.push(`🌫 ${targetName}の物理無効！ ${name}の攻撃はすり抜けた（0ダメージ）`);
      return { remain: targetHp, dmg: 0, bounced: 0 };
    }
    if (!isMagic && targetAb.has("physreflect")) {
      log.push(`🪞 ${targetName}の物理反射！ ${name}の攻撃がそっくり跳ね返る`);
      return { remain: targetHp, dmg: 0, bounced: dmg };
    }
    if (targetAb.has("armor") && dmg > 0) {
      const cut = Math.min(ARMOR_REDUCE, dmg);
      dmg -= cut;
      log.push(`🪨 ${targetName}の硬殻！ ダメージを${cut}軽減`);
      if (dmg <= 0) { log.push(`${name}の攻撃は${targetName}の殻に阻まれた（0ダメージ）`); return { remain: targetHp, dmg: 0, bounced: 0 }; }
    }
    const remain = targetHp - dmg;
    log.push(`${name}の${isMagic ? "魔法攻撃" : "攻撃"}！ ${targetName}に${dmg}ダメージ（残りHP ${Math.max(0, remain)}）`);
    return { remain, dmg, bounced: 0 };
  };
  // 反射（ミラーシールド）: 攻撃を受けた側が、受けたダメージの一部を攻撃側へ跳ね返す
  const reflectBack = (targetReflect, dmg, attackerName, reflectorName, attackerHp) => {
    if (targetReflect <= 0 || dmg <= 0) return attackerHp;
    const rf = Math.floor(dmg * targetReflect);
    if (rf <= 0) return attackerHp;
    // v23: 反射持ちアイテムはミラーシールドの他にスパイクメイルもあるため、装備名を出さない汎用文言にする
    log.push(`🪞 ${reflectorName}の装備が攻撃を弾く！ ${attackerName}に${rf}ダメージ反射`);
    return attackerHp - rf;
  };
  // 物理反射の跳ね返りダメージを攻撃側へ適用（strikeのbounced）
  const applyBounce = (bounced, strikerName, strikerHp) => {
    if (!bounced) return strikerHp;
    const remain = strikerHp - bounced;
    log.push(`${strikerName}は跳ね返った${bounced}ダメージを受けた！（残りHP ${Math.max(0, remain)}）`);
    return remain;
  };
  // 吸収（absorb・v19）: 与えたダメージの半分だけ回復（バトル開始時のHPが上限）
  const attAbsorb = (dmg) => {
    if (!attAb.has("absorb") || dmg <= 0 || attHp <= 0) return;
    const heal = Math.min(Math.floor(dmg / 2), attStartHp - attHp);
    if (heal > 0) { attHp += heal; log.push(`🩸 ${attCard.name}の吸収！ HPを${heal}回復（残りHP ${attHp}）`); }
  };
  const defAbsorb = (dmg) => {
    if (!defAb.has("absorb") || dmg <= 0 || defHp <= 0) return;
    const heal = Math.min(Math.floor(dmg / 2), defStartHp - defHp);
    if (heal > 0) { defHp += heal; log.push(`🩸 ${defCard.name}の吸収！ HPを${heal}回復（残りHP ${defHp}）`); }
  };
  // 与えたダメージの累計（吸奪武器 drainMagic の強奪額計算用。無効・反射で0なら加算されない）
  let attDealt = 0, defDealt = 0;
  // 💢倍返し（payback・v30）: 相手の直撃でダメージを受けたあと生き残っていれば、以後の自分の攻撃ダメージ2倍。
  // 「受けた量」は相手の与えた累計（attDealt/defDealt）で判定＝反射・跳ね返りのダメージでは発動しない
  let attPaybackOn = false, defPaybackOn = false;
  const attMulOf = () => {
    const on = attAb.has("payback") && defDealt > 0;
    if (on && !attPaybackOn) { attPaybackOn = true; log.push(`💢 ${attCard.name}の倍返し！ 受けた痛みを倍にして叩き返す（以後ダメージ2倍）`); }
    return on ? 2 : 1;
  };
  const defMulOf = () => {
    const on = defAb.has("payback") && attDealt > 0;
    if (on && !defPaybackOn) { defPaybackOn = true; log.push(`💢 ${defCard.name}の倍返し！ 受けた痛みを倍にして叩き返す（以後ダメージ2倍）`); }
    return on ? 2 : 1;
  };
  // 侵略側の手番（1回）。連撃持ちなら相手が生き残っている限りもう1撃（合計2撃）
  const attTurn = () => {
    let r = strike(attCard.name, attStOf(), attAb, attMagic, attNoCrit, attCritRate, defCard.name, defAb, defHp, attMulOf());
    defHp = r.remain;
    defEndureCheck(); // 🛡不屈＝致命の一撃をHP1で見切る（連撃の2撃目には耐えられない）
    attDealt += r.dmg;
    attHp = applyBounce(r.bounced, attCard.name, attHp); // 防衛側の物理反射
    attHp = reflectBack(defReflect, r.dmg, attCard.name, defCard.name, attHp); // 防衛側が反射
    attEndureCheck();
    attAbsorb(r.dmg);
    if (defHp > 0 && attHp > 0 && attAb.has("double")) {
      log.push(`🐲 ${attCard.name}の連撃！`);
      r = strike(attCard.name, attStOf(), attAb, attMagic, attNoCrit, attCritRate, defCard.name, defAb, defHp, attMulOf());
      defHp = r.remain;
      defEndureCheck();
      attDealt += r.dmg;
      attHp = applyBounce(r.bounced, attCard.name, attHp);
      attHp = reflectBack(defReflect, r.dmg, attCard.name, defCard.name, attHp);
      attEndureCheck();
      attAbsorb(r.dmg);
    }
  };
  // 防衛側の手番（1回）。連撃持ちなら同様に2撃目
  const defTurn = () => {
    let r = strike(defCard.name, defStOf(), defAb, defMagic, defNoCrit, defCritRate, attCard.name, attAb, attHp, defMulOf());
    attHp = r.remain;
    attEndureCheck();
    defDealt += r.dmg;
    defHp = applyBounce(r.bounced, defCard.name, defHp); // 侵略側の物理反射
    defHp = reflectBack(attReflect, r.dmg, defCard.name, attCard.name, defHp); // 侵略側が反射
    defEndureCheck();
    defAbsorb(r.dmg);
    if (attHp > 0 && defHp > 0 && defAb.has("double")) {
      log.push(`🐲 ${defCard.name}の連撃！`);
      r = strike(defCard.name, defStOf(), defAb, defMagic, defNoCrit, defCritRate, attCard.name, attAb, attHp, defMulOf());
      attHp = r.remain;
      attEndureCheck();
      defDealt += r.dmg;
      defHp = applyBounce(r.bounced, defCard.name, defHp);
      defHp = reflectBack(attReflect, r.dmg, defCard.name, attCard.name, defHp);
      defEndureCheck();
      defAbsorb(r.dmg);
    }
  };
  // 相手の手番中に反射ダメージで自分が倒れることがある（物理反射/ミラーシールド）ため、
  // 反撃側は「自分も相手も生存」のときだけ手番を得る。
  // 遠隔（侵略側）＝防衛側は反撃できない。建造物（防衛側）＝反撃しない。
  const defCanCounter = !attRanged && !defStruct;
  if (attHp <= 0) {
    // ⚡カウンターボルト（v29）: 罠の直撃で侵略者が倒れた＝バトルは始まらない
    log.push(`💥 ${attCard.name}は罠に倒れ、バトルは始まらなかった…`);
  } else if (defFirst) {
    log.push(`🛡 ${defCard.name}の先制攻撃！`);
    defTurn();
    if (attHp > 0 && defHp > 0) attTurn();
  } else {
    attTurn();
    if (defHp > 0 && attHp > 0 && defCanCounter) defTurn();
  }

  const attackerWins = defHp <= 0;
  if (attackerWins) {
    log.push(`💥 ${defCard.name}は倒された！ ${attCard.name}が土地を奪取！`);
  } else if (attHp <= 0) {
    log.push(`💥 ${attCard.name}は倒された… 侵略失敗！`);
  } else {
    log.push(`⚖ 両者生存。侵略失敗！ ${attCard.name}は撤退した`);
  }
  // 吸奪（drainMagic・v17）＋💸魔力強奪（siphon・v25の能力）: 与えたダメージ×倍率の魔力を相手から強奪する。
  // 武器の倍率と能力の等倍は加算される（グリードファング×2 ＋ 魔力強奪×1 ＝ ダメージ×3）
  const drainMul = (itemEff, ab) => ((itemEff && itemEff.drainMagic) || 0) + (ab.has("siphon") ? 1 : 0);
  const attMul = drainMul(attItemEff, attAb), defMul = drainMul(defItemEff, defAb);
  const attDrain = (attMul > 0 && attDealt > 0) ? attDealt * attMul : 0;
  const defDrain = (defMul > 0 && defDealt > 0) ? defDealt * defMul : 0;
  const drainSrc = (itemEff, ab, name) =>
    (itemEff && itemEff.drainMagic) ? (ab.has("siphon") ? `${itemEff.name}と${name}の魔力強奪` : itemEff.name) : `${name}の魔力強奪`;
  if (attDrain) log.push(`💰 ${drainSrc(attItemEff, attAb, attCard.name)}！ 与えたダメージ${attDealt}×${attMul}＝${attDrain}Gを強奪！`);
  if (defDrain) log.push(`💰 ${drainSrc(defItemEff, defAb, defCard.name)}！ 与えたダメージ${defDealt}×${defMul}＝${defDrain}Gを強奪！`);
  return {
    attackerWins, log, attHp, defHp, attExtra, defExtra, attDrain, defDrain,
    // 転生（rebirth・v19）: 倒されたとき捨札ではなく手札に戻る（アイテム由来の付与も含めた実効判定）
    attRebirth: attAb.has("rebirth"),
    defRebirth: defAb.has("rebirth"),
    // 捕縛の実効判定（チェインネット等アイテム由来の捕縛も含める・v19）
    defCapture: defAb.has("capture"),
  };
}

// 戦闘後にクリーチャーへ持ち越す実HP（最大値でキャップ、生存中は最低1）。
// maxHp には成長分を含めた実最大HP（maxHpOf）を渡すこと（v19）
function woundedHp(finalHp, extra, maxHp) {
  return Math.max(1, Math.min(maxHp, finalHp - extra));
}
