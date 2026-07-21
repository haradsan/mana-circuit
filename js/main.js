// ============================================================
// main.js — ターン進行の状態機械
// 人間もCPUも同じアクション関数を通る（選択の取得方法だけが違う）
// ============================================================
"use strict";

let G = null;
const CPU_WAIT = 650; // CPUの行動間の演出待ち(ms)
let _rollWait = null;      // 現在アクティブな「ダイスを振る」待ち（投了時に安全に中断するため）
let _surrendering = false; // 投了確認ダイアログの二重表示防止

// ---------- ゲーム開始 ----------
async function startGame(stageIdx, opts = {}) {
  document.body.classList.add("in-game"); // 固定ウィンドウ（ステータス／手札）を表示
  G = newGame(stageIdx, opts);
  G.training = !!opts.training; // トレーニング（練習対戦・進行度を更新せず勝利でカード3枚）
  G.hotseat = !!opts.versus;    // 2人対戦（ホットシート・報酬/進行度なし）
  G.royale = !!opts.royale;     // 三つ巴（人間1+CPU2・勝利でカード獲得・進行度は変化しない）
  G.sealed = !!opts.sealed;     // シールド戦（その場開封のプールで構築・勝利でカード獲得・進行度は変化しない）
  G.sealedDeck = opts.sealedDeck || null; // 「同じデッキでもう一度」用にシールドデッキを保持
  G.versusSetup = opts.versus || null; // 「もう一度」用に対戦設定を保持
  GAME_SPEED = G.training ? 0.28 : 1; // トレーニングは演出を高速化（時短）。通常は等倍
  // トレーニングは目標資産・ラウンド上限を下げて短時間で決着（時短・簡易）
  if (G.training) {
    RULES.target = Math.round(RULES.target * 0.6 / 100) * 100;
    RULES.maxRounds = Math.min(RULES.maxRounds, 24);
  }
  AI_PROFILE = resolveAIProfile(G.stage.ai); // ステージ既定の実効プロファイル（各CPUは p.aiProfile を優先）
  const w = Math.max(...G.tiles.map(t => t.x)) + 1;
  const h = Math.max(...G.tiles.map(t => t.y)) + 1;
  const svg = document.getElementById("board");
  svg.setAttribute("viewBox", `0 0 ${w * 100} ${h * 100}`);
  svg.style.aspectRatio = `${w} / ${h}`;
  // ステージのテーマカラーで背景を染める（盤面ごとの空気を変える。タイトルへ戻るとき解除）
  const th = G.stage.theme;
  document.body.style.background = th
    ? `radial-gradient(ellipse at 50% 0%, ${th.glow} 0%, ${th.bg} 60%)` : "";
  // 中央HUDが盤面中心のマス（八の字の城・十字路など）を隠すステージでは位置をずらす
  const hud = document.getElementById("center-hud");
  const hudPos = G.stage.hud || { left: "50%", top: "50%", width: "52%" };
  hud.style.left = hudPos.left;
  hud.style.top = hudPos.top;
  hud.style.width = hudPos.width;
  document.getElementById("log").innerHTML = "";
  renderAll(G);
  fitBoard({ max: 1 }); // 開始時は盤面全体が見える倍率に（見えないマスを無くす。拡大はしない）
  log(`=== ${G.stage.icon} STAGE ${stageIdx + 1}「${G.stage.name}」 ===`, "sys");
  log(G.hotseat ? `🎮 2人対戦: 🔵${G.players[0].name} vs 🔴${G.players[1].name}`
    : G.royale ? `⚔ 三つ巴: 🔵${G.players[0].name} vs 🔴${G.players[1].name} vs 🟢${G.players[2].name}`
    : `VS ${G.players[1].name}`, "sys");
  log(G.stage.desc, "sys");
  if (G.weekly) log(`🎪 今週のルール「${G.weekly.icon}${G.weekly.name}」: ${G.weekly.desc}`, "warn");
  log(`総資産 ${RULES.target}G に達して城に戻れば勝利です（魔力が尽きても敗北にはならず、城で再起できます）`, "sys");
  // 対戦前の口上: 相手キャラのポートレートと挨拶（トレーニング・2人対戦・リトライでは省略）
  if (!G.hotseat && !G.training && !opts.skipIntro && typeof showMatchIntro === "function") {
    await showMatchIntro(G);
  }
  // 開幕演出: 手札が表紙（カードバック）側で配られ、1枚ずつめくれて対戦が始まる。
  // 2人対戦は交代画面が手札を管理するため対象外（1P の手札が先に見えてしまうのを防ぐ）
  if (!G.hotseat && !G.players[0].isCPU) {
    setMessage("カードが配られた——");
    await handIntro(G);
  }
  gameLoop();
}

async function gameLoop() {
  const g = G;
  while (!g.over) {
    await playTurn(g.players[g.current]);
    if (g !== G) return; // リトライ等で新ゲームが始まっていたら旧ループを止める
    if (g.over) break;
    g.current = (g.current + 1) % g.players.length; // 三つ巴では3人で順番に回す
    if (g.current === 0) {
      g.round++;
      if (g.round > RULES.maxRounds) {
        const ranked = g.players.slice().sort((a, b) => assetsOf(g, b) - assetsOf(g, a));
        endGame(ranked[0], "ラウンド上限。総資産の最も多いプレイヤーの勝ち!");
      }
    }
  }
  await showGameOver();
}

function endGame(winner, reason) {
  if (G.over) return;
  G.over = true;
  G.winner = winner;
  log(`🏆 ${reason}`, "sys");
  log(`勝者: ${winner.name}`, "sys");
}

async function showGameOver() {
  renderAll(G);

  // 2人対戦（ホットシート）: 勝者名を称えるだけ（報酬・進行度は変化しない）
  if (G.hotseat) {
    SFX.win();
    setMessage(`🏆 ${G.winner.name}の勝利！`);
    await playVictoryFx("VICTORY!", `🏆 ${G.winner.name}の勝利！`);
    const res = await showDialog({
      title: `🏆 ${G.winner.id === 0 ? "🔵" : "🔴"} ${G.winner.name}の勝ち！`,
      body: `🔵 ${esc(G.players[0].name)}: 総資産 ${assetsOf(G, G.players[0])}G ／ 🔴 ${esc(G.players[1].name)}: 総資産 ${assetsOf(G, G.players[1])}G` +
        `<br><br>（2人対戦では報酬カード・ステージ進行度は変化しません）`,
      buttons: [
        { label: "🔁 同じ組み合わせでもう一度", value: "retry", primary: true },
        { label: "🗺 メニューへ", value: "menu" },
      ],
    });
    if (res.action === "retry") startGame(G.stageIdx, { versus: G.versusSetup });
    else titleScreen();
    return;
  }

  const youWin = G.winner.id === 0;
  if (youWin) SFX.win(); else SFX.lose();
  // 敗者・勝者のキャラのセリフ（存在感の演出）: 勝ったCPUは勝ち名乗り、負けたCPUは負け惜しみ
  const winnerQuote = (!youWin && typeof charLine === "function") ? charLine(G.winner, "win") : "";
  const loserQuotes = (youWin && typeof charLine === "function")
    ? G.players.filter(p => p.isCPU).map(p => ({ p, line: charLine(p, "lose") })).filter(q => q.line) : [];
  const quoteHtml =
    (winnerQuote ? `<br><br>「${esc(winnerQuote)}」 — ${esc(G.winner.name)}` : "") +
    loserQuotes.map(q => `<br><br>「${esc(q.line)}」 — ${esc(q.p.name)}`).join("");

  // シールド戦: 勝てばカードを獲得（進行度は変化しない）。開封プールは使い捨てなので
  // 「同じデッキでもう一度」でデッキだけ引き継いで再戦できる
  if (G.sealed) {
    setMessage(youWin ? "🎁 シールド戦を制覇！" : `💀 ${G.winner.name}の勝利…`);
    if (youWin) await playVictoryFx("VICTORY!", "🎁 シールド戦を制覇！");
    let gained = 0;
    if (youWin && typeof grantWinCards === "function") {
      const set = await chooseRewardSet();
      const pack = grantWinCards(REWARD_WIN, set);
      if (pack) { gained = pack.length; await showPackReveal(pack, "🏆 シールド戦 勝利報酬！", `カードを${pack.length}枚手に入れた！（こちらはコレクションに入ります）`); }
    }
    const res = await showDialog({
      title: youWin ? "🏆 シールド戦を制覇！" : "💀 敗北…",
      body: `${esc(G.winner.name)}の勝ち！ あなた ${assetsOf(G, G.players[0])}G ／ ${esc(G.players[1].name)} ${assetsOf(G, G.players[1])}G` +
        (gained ? `<br><br>💚 カードを${gained}枚獲得しました` : "") + quoteHtml +
        `<br><br>（シールド戦の開封プールは使い捨て・進行度は変化しません）`,
      buttons: [
        { label: "🔁 同じデッキでもう一度", value: "retry", primary: true },
        { label: "🗺 メニューへ", value: "menu" },
      ],
    });
    if (res.action === "retry") startGame(G.stageIdx, { sealed: true, sealedDeck: G.sealedDeck, skipIntro: true });
    else titleScreen();
    return;
  }

  // 三つ巴: 勝てばカードを獲得（進行度は変化しない）。順位表を表示
  if (G.royale) {
    if (youWin) G.rewardSet = await chooseRewardSet();
    const ranked = G.players.slice().sort((a, b) => assetsOf(G, b) - assetsOf(G, a));
    const standings = ranked.map((p, i) =>
      `${["🥇", "🥈", "🥉"][i]} ${P_ICONS[p.id]} ${esc(p.name)}: 総資産 ${assetsOf(G, p)}G`).join("<br>");
    setMessage(youWin ? "🏆 三つ巴を制覇！" : `💀 ${G.winner.name}の勝利…`);
    if (youWin) await playVictoryFx("VICTORY!", "⚔ 三つ巴を制覇！");
    let gained = 0;
    if (youWin && typeof grantWinCards === "function") {
      // ⚔三つ巴は1対1（5枚）より+2枚＝7枚（3人戦を制する難しさに見合う報酬・v22）
      const pack = grantWinCards(REWARD_WIN + REWARD_ROYALE_BONUS, G.rewardSet || 1);
      if (pack) { gained = pack.length; await showPackReveal(pack, "🏆 三つ巴 勝利報酬！", `カードを${pack.length}枚手に入れた！（⚔三つ巴ボーナス＝1対1より+${REWARD_ROYALE_BONUS}枚）`); }
    }
    // ウィークリールール適用中の三つ巴勝利にもボーナスカード（正規対戦と同様・v22）
    if (youWin && G.weekly && typeof drawPack === "function") {
      const bonus = drawPack(WEEKLY_BONUS_CARDS, "uncommon", 1, G.rewardSet || 1);
      addCards(bonus);
      gained += bonus.length;
      await showPackReveal(bonus, "🎪 ウィークリーボーナス！",
        `今週のルール「${G.weekly.name}」適用中の勝利ボーナス（+${bonus.length}枚）！`);
    }
    const res = await showDialog({
      title: youWin ? "🏆 三つ巴を制覇！" : "💀 敗北…",
      body: `${esc(G.winner.name)}の勝ち！<br><br>${standings}` +
        (gained ? `<br><br>💚 カードを${gained}枚獲得しました` : "") + quoteHtml,
      buttons: [
        { label: "🔁 もう一度（乱入者は毎回ランダム）", value: "retry", primary: true },
        { label: "🗺 メニューへ", value: "menu" },
      ],
    });
    if (res.action === "retry") startGame(G.stageIdx, { royale: true });
    else titleScreen();
    return;
  }

  // トレーニング（練習対戦）: 進行度は更新せず、勝てばカードを3枚獲得（時短仕様）
  if (G.training) {
    setMessage(youWin ? "🎯 練習に勝利！" : "🎯 練習終了");
    if (youWin) await playVictoryFx("VICTORY!", "🎯 練習に勝利！");
    let gained = 0, streak = 0;
    if (youWin && typeof grantTrainingCards === "function") {
      const cards = grantTrainingCards(REWARD_TRAINING);
      gained = cards.length;
      streak = (typeof trainingStreakCount === "function") ? trainingStreakCount() : 0;
      await showPackReveal(cards,
        streak >= 2 ? `🎯 トレーニング 🔥${streak}連勝！` : "🎯 トレーニング勝利！",
        `報酬としてカードを${gained}枚獲得！` +
        (streak >= TRAINING_STREAK_FOR_RARE ? `（🔥${streak}連勝ボーナス＝レア以上1枚保証）`
          : streak === TRAINING_STREAK_FOR_RARE - 1 ? `（次も勝てば🔥${TRAINING_STREAK_FOR_RARE}連勝＝レア以上保証！）` : ""));
    } else if (!youWin && typeof resetTrainingStreak === "function") {
      resetTrainingStreak(); // 敗北で連勝リセット
    }
    const res = await showDialog({
      title: youWin ? "🎯 練習に勝利！" : "🎯 練習終了",
      body: `${esc(G.winner.name)}の勝ち！ あなた ${assetsOf(G, G.players[0])}G ／ ${esc(G.players[1].name)} ${assetsOf(G, G.players[1])}G` +
        (youWin ? `<br><br>💚 カードを${gained}枚獲得しました（📚アルバムで確認できます）` +
          (streak >= 1 ? `<br>🔥 トレーニング${streak}連勝中！ ${TRAINING_STREAK_FOR_RARE}連勝からは毎回<b>レア以上1枚保証</b>` : "")
        : `<br><br>🔥 連勝は途切れた…（トレーニングの連勝ボーナスはリセット）`),
      buttons: [
        { label: "🔁 もう一度", value: "retry", primary: true },
        { label: "🗺 メニューへ", value: "menu" },
      ],
    });
    if (res.action === "retry") startGame(G.stageIdx, { training: true });
    else titleScreen();
    return;
  }

  setMessage(youWin ? "🏆 あなたの勝利！" : `💀 ${G.players[1].name}の勝利…`);
  const nextIdx = G.stageIdx + 1;
  const hasNext = nextIdx < STAGES.length;
  const firstClear = youWin && !loadProgress().cleared[G.stage.id];
  if (youWin) await playVictoryFx("VICTORY!", firstClear ? `✦ STAGE ${G.stageIdx + 1} 初制覇の祝福 ✦` : "🏆 あなたの勝利！", { grand: firstClear });
  if (youWin) saveStageClear(G.stage.id);
  // 報酬: 新規クリア=10枚 / クリア済みステージの再勝利=5枚。パックの弾は勝者が選ぶ（v19）
  const rewardSet = youWin ? await chooseRewardSet() : 1;
  if (firstClear && typeof grantStageClearPack === "function") {
    const pack = grantStageClearPack(G.stage.id, REWARD_FIRST_CLEAR, rewardSet);
    if (pack) await showPackReveal(pack, "🎁 STAGE 初クリア報酬！", `大型カードパック（${pack.length}枚）を手に入れた！`);
  } else if (youWin && typeof grantWinCards === "function") {
    const pack = grantWinCards(REWARD_WIN, rewardSet);
    if (pack) await showPackReveal(pack, "🏆 勝利報酬！", `カードを${pack.length}枚手に入れた！`);
  }
  // ウィークリールール適用中の正規勝利にはボーナスカードを追加（クリア済みステージ再訪の動機に）
  if (youWin && G.weekly && typeof drawPack === "function") {
    const bonus = drawPack(WEEKLY_BONUS_CARDS, "uncommon", 1, rewardSet);
    addCards(bonus);
    await showPackReveal(bonus, "🎪 ウィークリーボーナス！",
      `今週のルール「${G.weekly.name}」適用中の勝利ボーナス（+${bonus.length}枚）！`);
  }

  const buttons = [];
  if (youWin && hasNext) buttons.push({ label: `▶ 次のステージへ（${STAGES[nextIdx].name}）`, value: "next", primary: true });
  buttons.push({ label: "🔁 このステージをもう一度", value: "retry", primary: !(youWin && hasNext) });
  buttons.push({ label: "🗺 ステージ選択へ", value: "select" });

  const res = await showDialog({
    title: youWin ? `🏆 STAGE ${G.stageIdx + 1} クリア！` : "💀 敗北…",
    body: `${esc(G.winner.name)}の勝ち！<br>あなたの総資産: ${assetsOf(G, G.players[0])}G ／ ${esc(G.players[1].name)}: ${assetsOf(G, G.players[1])}G` +
      (firstClear && hasNext ? `<br><br>🎉 <b>STAGE ${nextIdx + 1}「${esc(STAGES[nextIdx].name)}」が解放された！</b>` : "") +
      (youWin && !hasNext ? `<br><br>👑 <b>全ステージ制覇！ あなたは真のセプターだ！</b>` : "") +
      quoteHtml,
    buttons,
  });
  if (res.action === "next") startGame(nextIdx);
  else if (res.action === "retry") startGame(G.stageIdx, { skipIntro: true });
  else titleScreen();
}

// 勝利報酬パックの弾（第一弾/第二弾）を選ぶ（v19・原さん指定＝報酬はパックを選択できる）
async function chooseRewardSet() {
  const col = loadCollection();
  const row = s => {
    const inSet = CARD_DB.filter(c => cardSet(c) === s.set);
    const have = inSet.filter(c => (col.owned[c.id] || 0) > 0).length;
    return { label: `${s.icon} ${s.name}パック（収集 ${have}/${inSet.length}種）`, value: String(s.set) };
  };
  const res = await showDialog({
    title: "🎁 報酬パックの弾を選択",
    body: "どちらの弾のカードパックを受け取りますか？",
    buttons: CARD_SETS.map(row),
  });
  const n = Number(res.action);
  return n === 2 ? 2 : 1;
}

// ---------- 途中棄権（投了） ----------
// 安全に投了できるのは「自分のターンでダイスを振る前」だけ（_rollWait が有効なとき）。
// その瞬間だけ投了ボタンを表示し、進行中のダイス待ちを中断してタイトルへ戻す。
function showSurrenderButton(show) {
  const btn = document.getElementById("surrender-btn");
  if (btn) btn.classList.toggle("hidden", !show);
}

async function requestSurrender() {
  if (!G || G.over || _surrendering) return;
  if (!_rollWait) return; // 自分の番でダイスを振る前だけ受け付ける
  _surrendering = true;
  // 投了するのは「いま手番でダイス待ちの人間」（2人対戦ではどちらのプレイヤーもあり得る）
  const loser = G.players[G.current];
  const winner = opponentOf(G, loser);
  const res = await showDialog({
    title: `🏳 ${G.hotseat ? `${loser.name}は` : ""}投了しますか？`,
    body: G.training
      ? "このトレーニングを中断します（報酬なし・進行度は変わりません）。"
      : G.hotseat
        ? `このゲームを投了して中断します。<br><b>${esc(winner.name)}の勝ち</b>となります（報酬・進行度は元々変化しません）。`
        : "このゲームを投了して中断します。<br><b>相手の勝ち</b>となり、報酬カードは得られません（進行度は変わりません）。",
    buttons: [
      { label: "投了する", value: "yes" },
      { label: "やめる", value: "no", primary: true },
    ],
  });
  if (res.action !== "yes") { _surrendering = false; return; }
  // 進行中のダイス待ちを無効化（旧ターンのコルーチンが新ゲームへ波及しないように）
  if (_rollWait) { _rollWait.cancel(); _rollWait = null; }
  showSurrenderButton(false);
  if (G.training && typeof resetTrainingStreak === "function") resetTrainingStreak(); // 投了も連勝リセット
  G.over = true;
  G.winner = winner;
  SFX.lose();
  log(`🏳 ${loser.name}は投了した`, "warn");
  setMessage("🏳 投了");
  renderAll(G);
  const r2 = await showDialog({
    title: "🏳 投了しました",
    body: G.training ? "トレーニングを中断しました。"
      : G.hotseat ? `ゲームを中断しました（${esc(winner.name)}の勝ち）。`
      : "ゲームを中断しました（相手の勝ち・報酬なし）。",
    buttons: [
      { label: "🔁 このステージをもう一度", value: "retry" },
      { label: "🗺 メニューへ", value: "menu", primary: true },
    ],
  });
  _surrendering = false;
  if (r2.action === "retry") startGame(G.stageIdx, { training: G.training, versus: G.versusSetup, royale: G.royale, sealed: G.sealed, sealedDeck: G.sealedDeck, skipIntro: !G.royale });
  else titleScreen();
}

// ---------- 1ターン ----------
async function playTurn(p) {
  if (!p.alive) return;
  p.passAllLands = false; // 周回達成でこのターン全自領を②の対象にするフラグ（リコール＝スペル段階で立つのでここで初期化）
  // 捕縛/フリーズによる1回休み（理由でメッセージを出し分ける）
  if (p.skipTurn) {
    p.skipTurn = false;
    const frozen = p.skipReason === "freeze";
    p.skipReason = null;
    setMessage(frozen ? `${p.name}は凍りついている…` : `${p.name}は拘束されている…`);
    renderAll(G);
    log(frozen ? `❄️ ${p.name}は凍りついて動けない！（1回休み）`
               : `🕸️ ${p.name}は捕縛されていて動けない！（1回休み）`, "warn");
    if (p.isCPU) await sleep(CPU_WAIT);
    else await sleep(700);
    return;
  }
  // 2人対戦（ホットシート）: 手札を伏せた交代画面を挟んでから手番を始める
  if (G.hotseat && !p.isCPU) await hotseatHandoff(p);
  setMessage(`${p.name}のターン（ラウンド${G.round}）`);
  turnStartTick(p); // 第二弾（v19）: 🌱成長・⛏採掘・🌿癒しの庭のターン開始処理
  renderAll(G);
  if (p.isCPU) {
    // ときどきキャラがつぶやく（存在感の演出・非ブロッキング）
    if (Math.random() < 0.22 && typeof cpuSay === "function") cpuSay(p, "taunt");
    await sleep(CPU_WAIT);
  }

  // 1. ドロー（人間は山札からカードがめくれて手札へ吸い込まれる演出つき）
  const drawn = drawCard(G, p);
  if (drawn) log(p.isCPU ? `${p.name}はカードを引いた` : `カードを引いた: ${CARD_BY_ID[drawn].name}`);
  if (drawn && !p.isCPU) await animateDraw(CARD_BY_ID[drawn]);
  await enforceHandLimit(p);
  renderAll(G);

  // 2. スペル（人間は手札クリック、CPUはAI判断） & ダイス
  let dice;
  if (p.isCPU) {
    const spellId = aiChooseSpell(G, p);
    if (spellId) { await castSpell(p, spellId); await sleep(CPU_WAIT); }
    if (G.over) return; // リコール勝ち等
    dice = rollDice(p);
  } else {
    await humanSpellAndRoll(p);
    if (G.over) return;
    dice = rollDice(p);
  }
  p.forcedDice = null;
  // ダイスブースト: 次の出目を倍にする（ホーリーワード指定分も倍化）
  if (p.diceMult && p.diceMult > 1) {
    dice *= p.diceMult;
    log(`🎲 ${p.name}のダイスブースト発動！ 出目が2倍の${dice}に！`, "warn");
    p.diceMult = null;
  }
  // 🍃追い風（v20）: 次の出目+2（倍化のあとに加算）
  if (p.diceBonus) {
    dice += p.diceBonus;
    log(`🍃 追い風！ ${p.name}の出目+${p.diceBonus}＝${dice}`);
    p.diceBonus = null;
  }
  // 🟤泥沼（v20）: 次の移動は出目半分（切り上げ）
  if (p.mudded) {
    dice = Math.ceil(dice / 2);
    log(`🟤 泥沼にはまった！ ${p.name}の移動は${dice}マスに半減`, "warn");
    p.mudded = false;
  }
  await animateDice(dice);
  log(`${p.name}のダイス: ${dice}`);

  // 3. 移動（通過ボーナス処理込み）。通過マスはクリーチャー侵攻の出撃元判定に使う
  //    出発マス（ターン開始時にいたマス）は②の対象に含めない——前のターンの①（到達アクション）で
  //    命令できたマスなので、含めると同じマスが2ターン連続で対象になってしまう（v13で撤回）
  p.lastPath = [];
  await movePlayer(p, dice);
  if (G.over) return;

  // 4. 停止マスのイベント（召喚/侵略/通行料など）。①で自主的な到達アクションをしたら acted=true
  const acted = await tileAction(p, G.tiles[p.pos]);
  if (G.over) { renderAll(G); return; }
  // 5. ②通過アクション: 「①で到達アクションを実行しなかった」ターンに付与される（1ターン1アクション）。
  //    到達アクションが何もない（受け身マス・手札不足など）か、あえてパス（通行料払いを含む）した場合のみ、
  //    このターン通過した自領について侵攻/交代/レベルアップを1つ行える。
  //    例外: 周回達成ターン（城ぴったり到達・リコール＝passAllLands）は①で行動していても付与し、全自領を対象にする。
  //    🎺進軍号令（v20・freeMarch）も①の行動に関係なく②の権利を与える
  if (!acted || p.passAllLands || p.freeMarch) await passActionPhase(p);
  // 🕯️時の儀（v20）: このターン、もう一度ダイスを振って移動し①を行う（②は最初の1回のみ）
  if (p.timeRitual && !G.over) {
    p.timeRitual = false;
    const dice2 = rollDice(p);
    p.forcedDice = null;
    await animateDice(dice2);
    log(`🕯️ 時の儀！ ${p.name}はもう一度動く——ダイス: ${dice2}`, "warn");
    p.lastPath = [];
    await movePlayer(p, dice2);
    if (!G.over) await tileAction(p, G.tiles[p.pos]);
  }
  // ターン限定フラグの掃除（v20: 攻城の号令・進軍号令・沈黙の霧）
  p.siegeSt = 0;
  p.freeMarch = false;
  p.spellSealed = false;
  notifyReach();
  renderAll(G);
}

// ---------- ターン開始時の第二弾能力（v19） ----------
// 🌱成長: ST/HP+5（上限+25）＝grownカウンタを進めてHPも増加分だけ回復
// ⛏採掘: +15G（採掘櫓は+30G） ／ 🌿癒しの庭: 隣接自軍クリーチャーをHP+10回復
function turnStartTick(p) {
  let mined = 0;
  const grownNames = [], healedNames = [];
  ownedLands(G, p.id).forEach(t => {
    if (!t.creature) return;
    const c = CARD_BY_ID[t.creature.cardId];
    if (c.ab.includes("grow") && (t.creature.grown || 0) < 5) {
      t.creature.grown = (t.creature.grown || 0) + 1;
      t.creature.hp = Math.min(maxHpOf(t.creature), currentHp(t.creature) + 5);
      grownNames.push(`${c.name}(+${t.creature.grown * 5})`);
    }
    if (c.ab.includes("mine")) mined += c.mineGain || 15;
    if (c.ab.includes("garden")) {
      neighborsOf(G, t).forEach(n => {
        if (n.type !== "LAND" || n.owner !== p.id || !n.creature || !isWounded(n.creature)) return;
        n.creature.hp = Math.min(maxHpOf(n.creature), currentHp(n.creature) + 10);
        healedNames.push(CARD_BY_ID[n.creature.cardId].name);
      });
    }
  });
  if (grownNames.length) log(`🌱 ${p.name}のクリーチャーが成長！ ${grownNames.join("・")}`);
  if (mined > 0) { p.magic += mined; SFX.coin(); log(`⛏ ${p.name}の採掘収入 +${mined}G`); }
  if (healedNames.length) log(`🌿 癒しの庭が${healedNames.join("・")}のHPを回復した（+10）`);
  // 💎魔力鉱脈（v20）: 付与された自分の土地から+20G（土地を失うと消える＝所有者が変わっていたら剥がす）
  let veinGain = 0;
  G.tiles.forEach(t => {
    if (t.veinOwner === undefined || t.veinOwner === null) return;
    if (t.type !== "LAND" || t.owner !== t.veinOwner) { delete t.veinOwner; return; }
    if (t.owner === p.id) veinGain += 20;
  });
  if (veinGain > 0) { p.magic += veinGain; SFX.coin(); log(`💎 魔力鉱脈から${p.name}に+${veinGain}G`); }
  // 🌸春の芽吹き（v20）: 2Rの間、自軍クリーチャーをターン開始時に+15回復
  if (activeFx(G, "bud", p.id)) {
    const budHealed = [];
    ownedLands(G, p.id).forEach(t => {
      if (!t.creature || !isWounded(t.creature)) return;
      t.creature.hp = Math.min(maxHpOf(t.creature), currentHp(t.creature) + 15);
      budHealed.push(CARD_BY_ID[t.creature.cardId].name);
    });
    if (budHealed.length) log(`🌸 春の芽吹き！ ${budHealed.join("・")}のHPが回復した（+15）`);
  }
}

// 目標資産に到達／転落したときの通知（⚑凱旋リーチ）。ターンの終わりに全員ぶんチェックする。
// 「あとは城へ帰るだけ」の状態を全員に見えるようにして、凱旋レースの緊張感を作る
function notifyReach() {
  if (G.over) return;
  G.players.forEach(p => {
    const reached = assetsOf(G, p) >= RULES.target;
    if (reached && !p.reached) {
      p.reached = true;
      SFX.coin();
      log(`⚑ ${p.name}は目標資産${RULES.target}Gに到達！ 🏰城へ凱旋すれば勝利だ！`, "warn");
      if (typeof cpuSay === "function") cpuSay(p, "reach");
    } else if (!reached && p.reached) {
      p.reached = false;
      log(`${p.name}の総資産が目標を割り込んだ（凱旋リーチ解除）`, "warn");
    }
  });
}

// ---------- 2人対戦（ホットシート）: 手番の交代画面 ----------
// 次のプレイヤーの手札を伏せてから「渡してください」と表示し、本人がボタンを押したら手札を開く
async function hotseatHandoff(p) {
  UI.handHidden = true;
  renderHand(G);
  setMessage(`🎮 ${p.name}に交代`);
  SFX.dice();
  await showDialog({
    title: `🎮 ${p.id === 0 ? "🔵" : "🔴"} ${p.name}の番です`,
    body: `端末を<b>${esc(p.name)}</b>（${p.id === 0 ? "🔵 青" : "🔴 赤"}）に渡してください。<br>ボタンを押すと${esc(p.name)}の手札が表示されます。`,
    buttons: [{ label: `🎲 ${p.name}の番を始める`, value: "go", primary: true }],
  });
  UI.handHidden = false;
  renderHand(G);
}

// 手札上限チェック（超過分を捨てる）
async function enforceHandLimit(p) {
  while (p.hand.length > HAND_LIMIT) {
    let discardId;
    if (p.isCPU) {
      discardId = aiChooseDiscard(G, p);
    } else {
      renderHand(G);
      const res = await showDialog({
        title: "手札が上限を超えています",
        body: "捨てるカードを選んでください",
        cards: p.hand.map(id => ({ card: CARD_BY_ID[id] })),
        peek: true,
        buttons: [],
      });
      discardId = res.cardId;
    }
    discardFromHand(p, discardId);
    log(`${p.name}は${CARD_BY_ID[discardId].name}を捨てた`);
  }
}

function removeFromHand(p, cardId) {
  const i = p.hand.indexOf(cardId);
  if (i >= 0) p.hand.splice(i, 1);
}

// 手札から捨て札置き場へ（山札切れ時に再利用される）
function discardFromHand(p, cardId) {
  removeFromHand(p, cardId);
  p.discard.push(cardId);
}

// ---------- 人間: スペル使用（1ターン1回・任意）→ ダイスボタン ----------
async function humanSpellAndRoll(p) {
  let spellUsed = false;
  while (true) {
    renderHand(G);
    if (!spellUsed) markCastableSpells(p);
    const rollWait = waitButtonCancellable("🎲 ダイスを振る");
    _rollWait = rollWait; // この間だけ投了ボタンが有効になる
    showSurrenderButton(true);
    const choice = await Promise.race([
      rollWait.promise.then(() => ({ type: "roll" })),
      spellUsed ? new Promise(() => {}) : waitSpellClick().then(cardId => ({ type: "spell", cardId })),
    ]);
    unmarkSpells();
    _rollWait = null;
    showSurrenderButton(false);
    if (choice.type === "roll") return;
    rollWait.cancel();
    const ok = await castSpell(p, choice.cardId);
    if (G.over) return;
    if (ok) spellUsed = true;
  }
}

// キャンセル可能なボタン待ち（スペル使用でダイス待ちを中断するため）
function waitButtonCancellable(label) {
  const btn = document.getElementById("action-btn");
  btn.textContent = label;
  btn.classList.remove("hidden");
  let handler;
  const promise = new Promise(resolve => {
    handler = () => {
      btn.classList.add("hidden");
      btn.removeEventListener("click", handler);
      resolve(true);
    };
    btn.addEventListener("click", handler);
  });
  return {
    promise,
    cancel() {
      btn.removeEventListener("click", handler);
      btn.classList.add("hidden");
    },
  };
}

let _spellClickResolve = null;
function markCastableSpells(p) {
  document.querySelectorAll("#hand .card").forEach(el => {
    const c = CARD_BY_ID[el.dataset.card];
    if (c.type === "spell" && c.cost <= p.magic) {
      el.classList.add("castable");
      el.addEventListener("click", onSpellClick);
    }
  });
}
function unmarkSpells() {
  document.querySelectorAll("#hand .card").forEach(el => {
    el.classList.remove("castable");
    el.removeEventListener("click", onSpellClick);
  });
  _spellClickResolve = null;
}
function onSpellClick(e) {
  if (_spellClickResolve) _spellClickResolve(e.currentTarget.dataset.card);
}
function waitSpellClick() {
  return new Promise(r => { _spellClickResolve = r; });
}

// 相手プレイヤーを1人選ぶ（人間用）。相手が1人だけなら聞かずにその相手を返す。キャンセルなら null
async function humanPickOpponent(p, title, body, filterFn = null) {
  let cands = opponentsOf(G, p);
  if (filterFn) cands = cands.filter(filterFn);
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  const res = await showDialog({
    title, body, peek: true,
    buttons: cands.map(q => ({
      label: `${P_ICONS[q.id]} ${q.name}（魔力${q.magic}G／総資産${assetsOf(G, q)}G／手札${q.hand.length}枚）`,
      value: String(q.id),
    })).concat([{ label: "やめる", value: "cancel" }]),
  });
  if (res.action === "cancel" || res.action === "dismiss") return null;
  return G.players[Number(res.action)];
}

// ---------- スペル効果 ----------
// 成功したら true。対象がない/キャンセルなら false（コストは消費しない）
// 三つ巴では「相手」を選ぶスペル（ドレイン等）は対象プレイヤーを選択する（2人対戦では従来どおり自動）
async function castSpell(p, cardId) {
  const c = CARD_BY_ID[cardId];
  const opp = opponentOf(G, p); // 筆頭の相手（総資産トップ）。リベンジ・劣勢判定の基準
  if (c.cost > p.magic) return false;
  // 🤫沈黙の霧（v20）: このターンはスペルを使えない
  if (p.spellSealed) {
    if (!p.isCPU) log(`🤫 沈黙の霧に閉ざされている——このターンはスペルを使えない`, "warn");
    return false;
  }
  // 🌙静寂のとばり（v20）: 対象指定スペルは全員使用不可
  if (TARGETED_SPELLS.has(c.spell) && activeFx(G, "silence")) {
    if (!p.isCPU) log(`🌙 静寂のとばり——対象を指定するスペルは今は使えない`, "warn");
    return false;
  }
  const pay = () => { p.magic -= c.cost; discardFromHand(p, cardId); };

  if (c.spell === "quake") {
    const target = p.isCPU ? aiPickQuakeTarget(G, p)
      : await humanPickLand(enemyLandsOf(G, p).filter(t => t.level > 1 && !landSpellShielded(G, t)),
        "✨ クエイク — 対象を選択", "レベルを1下げる敵の土地を選んでください（🏜️蜃気楼中の相手の土地は対象外）",
        "クエイクの対象となる土地（敵のLv2以上）がありません");
    if (!target) return false;
    pay();
    target.level = Math.max(1, target.level - 1);
    log(`✨ ${p.name}のクエイク！ ${tileName(target)}のレベルが${target.level}に下がった`);

  } else if (c.spell === "drain") {
    const target = p.isCPU ? richestOpponent(G, p)
      : await humanPickOpponent(p, "✨ マナドレイン — 相手を選択", "最大200Gを奪う相手を選んでください");
    if (!target) return false;
    pay();
    const amount = Math.min(200, target.magic);
    target.magic -= amount;
    p.magic += amount;
    log(`✨ ${p.name}のマナドレイン！ ${target.name}から${amount}Gを奪った`);

  } else if (c.spell === "plunder") {
    const target = p.isCPU ? richestOpponent(G, p)
      : await humanPickOpponent(p, "💰 プランダー — 相手を選択", "所持金の半分を奪う相手を選んでください");
    if (!target) return false;
    pay();
    const amount = Math.floor(target.magic / 2);
    target.magic -= amount;
    p.magic += amount;
    SFX.coin();
    log(`💰 ${p.name}のプランダー！ ${target.name}の所持金の半分 ${amount}G を奪った`, "warn");

  } else if (c.spell === "dicedouble") {
    pay();
    p.diceMult = 2;
    log(`🎲 ${p.name}のダイスブースト！ 次のダイスの出目が2倍になる`);

  } else if (c.spell === "draw") {
    pay();
    const d1 = drawCard(G, p), d2 = drawCard(G, p);
    log(`✨ ${p.name}のドローミスト！ カードを${(d1 ? 1 : 0) + (d2 ? 1 : 0)}枚引いた`);
    await enforceHandLimit(p);

  } else if (c.spell === "holyword") {
    const n = p.isCPU ? (p.aiHolyword || 1 + Math.floor(Math.random() * 6)) : await showDicePicker();
    p.aiHolyword = null;
    pay();
    p.forcedDice = n;
    log(`✨ ${p.name}のホーリーワード！ 次のダイスは${n}`);

  } else if (c.spell === "growth") {
    const target = p.isCPU ? aiPickGrowthTarget(G, p)
      : await humanPickLand(ownedLands(G, p.id).filter(t => t.level <= 3),
        "✨ グロース — 対象を選択", "レベルを1上げる自分の土地（Lv3以下）を選んでください",
        "グロースの対象となる土地（自分のLv3以下）がありません");
    if (!target) return false;
    pay();
    target.level++;
    log(`✨ ${p.name}のグロース！ ${tileName(target)}がLv${target.level}に成長した`);

  } else if (c.spell === "recall") {
    if (p.pos === 0) { if (!p.isCPU) log("すでに城にいます", "warn"); return false; }
    pay();
    p.pos = 0;
    p.cameFrom = null; // 城からの再出発＝方向リセット
    log(`✨ ${p.name}のリコール！ 城へ帰還した`);
    renderBoard(G);
    // リコールは城に「ぴったり着地」＝exact。領地コントロール（全自領で1アクション）は必ず得られ、
    // 関門が揃っていればさらに周回ボーナス（魔力＋全回復）も得る。
    const arr = arriveCastle(G, p, true);
    if (arr === "win") return true;
    if (arr !== "lap" && !p.isCPU) log("（関門が揃っていないため周回ボーナス（魔力・回復）は無し。領地コントロールは発動）", "warn");

  } else if (c.spell === "revenge") {
    const gap = assetsOf(G, opp) - assetsOf(G, p);
    if (gap <= 0) { if (!p.isCPU) log("リベンジは総資産で負けている時のみ使えます", "warn"); return false; }
    pay();
    const amount = Math.min(Math.floor(gap * 0.25), 500, opp.magic);
    opp.magic -= amount;
    p.magic += amount;
    log(`✨ ${p.name}のリベンジ！ 資産差${gap}G — ${opp.name}から${amount}Gを奪った`, "warn");

  } else if (c.spell === "eleshift") {
    let target, elem;
    if (p.isCPU) {
      const pick = aiPickShiftTarget(G, p);
      if (!pick) return false;
      target = pick.tile; elem = pick.element;
    } else {
      target = await humanPickLand(ownedLands(G, p.id),
        "✨ エレメンタルシフト — 対象を選択", "属性を変える自分の土地を選んでください",
        "自分の土地がありません");
      if (!target) return false;
      const res = await showDialog({
        title: "✨ 変更後の属性を選択",
        body: `${tileName(target)} をどの属性に変えますか？<br>クリーチャーと属性が一致すると土地の加護（防衛HP+）が働きます`,
        peek: true,
        buttons: LAND_ELEMENTS.filter(e => e !== target.element)
          .map(e => ({ label: `${ELEMENTS[e].icon} ${ELEMENTS[e].name}属性`, value: e }))
          .concat([{ label: "やめる", value: "cancel" }]),
      });
      if (res.action === "cancel") return false;
      elem = res.action;
    }
    pay();
    const before = ELEMENTS[target.element].name;
    target.element = elem;
    log(`✨ ${p.name}のエレメンタルシフト！ ${tileName(target)}が${before}→${ELEMENTS[elem].name}属性に変化`);

  } else if (c.spell === "vanish") {
    const target = p.isCPU ? aiPickVanishTarget(G, p)
      : await humanPickLand(
        enemyLandsOf(G, p).filter(t => t.creature && !isSanctuaryProtected(G, t) && !isSpellProof(t)),
        "✨ バニッシュ — 対象を選択", "消滅させる敵クリーチャーの土地を選んでください（<b>HP不問＝どんな相手でも確実に破壊</b>）<br>土地は空き地に戻ります（レベルは残る）※<b>護法</b>持ちは対象外",
        "バニッシュの対象となる敵クリーチャーがいません（結界・護法は対象外）");
    if (!target) return false;
    pay();
    const victim = CARD_BY_ID[target.creature.cardId];
    G.players[target.owner].discard.push(target.creature.cardId);
    target.creature = null;
    target.owner = null;
    log(`✨ ${p.name}のバニッシュ！ ${victim.name}は消し飛び、${tileName(target)}は空き地に戻った`, "warn");

  } else if (c.spell === "gust") {
    // 敵クリーチャーを隣接する空き地へ強制移動（連鎖崩し・防衛どかし）。不動・結界・護法は対象外
    const pushable = t => t.creature && !isSanctuaryProtected(G, t) && !isSpellProof(t) &&
      !CARD_BY_ID[t.creature.cardId].ab.includes("immobile") && gustDests(G, t).length > 0;
    let src, dst;
    if (p.isCPU) {
      const pick = aiPickGustTarget(G, p);
      if (!pick) return false;
      src = pick.src; dst = pick.dst;
    } else {
      src = await humanPickLand(enemyLandsOf(G, p).filter(pushable),
        "🌬️ ガスト — 押し出す敵クリーチャーを選択",
        "隣接する空き地へ吹き飛ばす敵クリーチャーを選んでください（<b>不動・結界・護法は対象外</b>）<br>元の土地は空き地に戻ります（レベルは残る）",
        "押し出せる敵クリーチャー（隣に空き地がある相手）がいません");
      if (!src) return false;
      dst = await humanPickLand(gustDests(G, src),
        `🌬️ ${CARD_BY_ID[src.creature.cardId].name} をどこへ押し出す？`,
        "移動先の空き地を選んでください（相手のクリーチャーがそのマスへ移り、元の土地は空き地に戻ります）",
        "移動先の空き地がありません");
      if (!dst) return false;
    }
    pay();
    const ownerId = src.owner;
    const moved = CARD_BY_ID[src.creature.cardId];
    dst.owner = ownerId;
    dst.creature = src.creature; // 現在HPごと移動
    src.owner = null;
    src.creature = null;
    log(`🌬️ ${p.name}のガスト！ ${moved.name}は${tileName(src)}から${tileName(dst)}へ吹き飛ばされた`, "warn");

  } else if (c.spell === "teleport") {
    // 自分のコマを盤面の好きなマス（城以外）へ飛ばす。移動はその後のダイスで通常どおり行う。
    // 飛んだだけではマスの効果・関門通過は発生しない（城はリコールの役割なので対象外）
    let target;
    if (p.isCPU) {
      target = aiPickTeleportTarget(G, p);
      if (!target) return false;
    } else {
      const candidates = G.tiles.filter(t => t.id !== p.pos && t.type !== "CASTLE");
      target = await humanPickTileOnMap(candidates, {
        title: "💫 テレポート — 飛び先を選択",
        body: "自分のコマを盤面の好きなマス（<b>城以外</b>）へ飛ばします。<br>飛んだだけではマスの効果・関門通過は発生しません。そのあと通常どおりダイスを振って移動します。",
        cancelable: true,
        labelFn: t => t.type === "LAND"
          ? `${ELEMENTS[t.element].icon} ${tileName(t)}${t.owner !== null ? `（${t.owner === p.id ? "自領" : "敵領"} Lv${t.level}）` : "（空き地）"}`
          : `#${t.id} ${tileName(t)}`,
      });
      if (!target) return false;
    }
    pay();
    p.pos = target.id;
    p.cameFrom = null; // 飛び先では方向未確定＝どの方向へも出発できる
    log(`💫 ${p.name}のテレポート！ ${tileName(target)}へ飛んだ`);
    renderBoard(G);

  } else if (c.spell === "transport") {
    // 自分のクリーチャー1体を盤面の好きな空き地へ転送（現在HPごと・元の土地は空き地に戻る）。不動は対象外
    const movable = ownedLands(G, p.id).filter(t =>
      t.creature && !CARD_BY_ID[t.creature.cardId].ab.includes("immobile"));
    const empties = G.tiles.filter(t => t.type === "LAND" && t.owner === null);
    let src, dst;
    if (p.isCPU) {
      const pick = aiPickTransportTarget(G, p);
      if (!pick) return false;
      src = pick.src; dst = pick.dst;
    } else {
      if (empties.length === 0) { log("転送先の空き地がありません", "warn"); return false; }
      src = await humanPickLand(movable,
        "🚪 トランスポート — 転送するクリーチャーを選択",
        "盤面の<b>好きな空き地</b>へ転送する自分のクリーチャーを選んでください（<b>不動は対象外</b>）<br>元の土地は空き地に戻ります（レベルは残る）",
        "転送できるクリーチャーがいません（不動は対象外）");
      if (!src) return false;
      dst = await humanPickLand(empties,
        `🚪 ${CARD_BY_ID[src.creature.cardId].name} をどこへ転送する？`,
        "転送先の空き地を選んでください（クリーチャーが現在HPのまま移り、その土地を入手します）",
        "転送先の空き地がありません");
      if (!dst) return false;
    }
    pay();
    const moved = CARD_BY_ID[src.creature.cardId];
    dst.owner = p.id;
    dst.creature = src.creature; // 現在HPごと移動
    src.owner = null;
    src.creature = null;
    log(`🚪 ${p.name}のトランスポート！ ${moved.name}が${tileName(dst)}へ転送された（元の土地は空き地に）`);

  } else if (c.spell === "leap") {
    // 自分のクリーチャー1体を「ちょうど2マス先」の空き地へ跳躍させる。不動は対象外
    const movable = ownedLands(G, p.id).filter(t =>
      t.creature && !CARD_BY_ID[t.creature.cardId].ab.includes("immobile") && leapDests(G, t).length > 0);
    let src, dst;
    if (p.isCPU) {
      const pick = aiPickLeapTarget(G, p);
      if (!pick) return false;
      src = pick.src; dst = pick.dst;
    } else {
      src = await humanPickLand(movable,
        "🐇 リープ — 跳躍するクリーチャーを選択",
        "<b>2マス先の空き地</b>へ跳躍させる自分のクリーチャーを選んでください（<b>不動は対象外</b>）<br>元の土地は空き地に戻ります（レベルは残る）",
        "跳躍できるクリーチャーがいません（2マス先に空き地が必要・不動は対象外）");
      if (!src) return false;
      dst = await humanPickLand(leapDests(G, src),
        `🐇 ${CARD_BY_ID[src.creature.cardId].name} の跳躍先を選択`,
        "2マス先の空き地から跳躍先を選んでください（クリーチャーが現在HPのまま移り、その土地を入手します）",
        "跳躍先の空き地がありません");
      if (!dst) return false;
    }
    pay();
    const moved = CARD_BY_ID[src.creature.cardId];
    dst.owner = p.id;
    dst.creature = src.creature; // 現在HPごと移動
    src.owner = null;
    src.creature = null;
    log(`🐇 ${p.name}のリープ！ ${moved.name}が${tileName(dst)}へ跳躍した（元の土地は空き地に）`);

  } else if (c.spell === "regen") {
    const target = p.isCPU ? aiPickRegenTarget(G, p)
      : await humanPickLand(
        ownedLands(G, p.id).filter(t => t.creature && isWounded(t.creature)),
        "💚 リジェネ — 対象を選択", "HPを全回復する自分の<b>負傷クリーチャー</b>を選んでください<br>（周回を待たずに、傷ついた防衛クリーチャーを立て直せます）",
        "負傷している自分のクリーチャーがいません");
    if (!target) return false;
    pay();
    const healed = CARD_BY_ID[target.creature.cardId];
    const before = currentHp(target.creature);
    target.creature.hp = maxHpOf(target.creature); // 成長分（v19）も含めた実最大HPまで回復
    log(`💚 ${p.name}のリジェネ！ ${tileName(target)}の${healed.name}のHPが${before}→${target.creature.hp}に全回復した`);

  } else if (c.spell === "renew") {
    pay(); // 先に引き直しカード自身を捨て札へ
    const dumped = p.hand.slice();
    dumped.forEach(id => p.discard.push(id));
    p.hand = [];
    let n = 0;
    for (let i = 0; i < HAND_LIMIT; i++) { if (drawCard(G, p)) n++; }
    log(`✨ ${p.name}の引き直し！ 手札をすべて捨て、${n}枚を引き直した`);

  } else if (c.spell === "meteor") {
    const target = p.isCPU ? aiPickMeteorTarget(G, p)
      : await humanPickLand(
        enemyLandsOf(G, p).filter(t => t.creature && !isSanctuaryProtected(G, t) && !isSpellProof(t)),
        "☄️ メテオ — 対象を選択", "40ダメージを与える敵クリーチャーの土地を選んでください<br>現在HPが0以下になれば破壊され、土地は空き地に戻ります（レベルは残る）※<b>護法</b>持ちは対象外",
        "対象にできる敵クリーチャーがいません（結界・護法は対象外）");
    if (!target) return false;
    pay();
    const victim = CARD_BY_ID[target.creature.cardId];
    const newHp = currentHp(target.creature) - 40;
    if (newHp <= 0) {
      G.players[target.owner].discard.push(target.creature.cardId);
      const nm = tileName(target);
      target.creature = null; target.owner = null;
      log(`☄️ ${p.name}のメテオ！ ${victim.name}に40ダメージ — 倒れて${nm}は空き地に戻った`, "warn");
    } else {
      target.creature.hp = newHp;
      log(`☄️ ${p.name}のメテオ！ ${victim.name}に40ダメージ（残りHP${newHp}）`, "warn");
    }

  } else if (c.spell === "freeze") {
    const target = p.isCPU ? aiPickFreezeTarget(G, p)
      : await humanPickOpponent(p, "❄️ フリーズ — 相手を選択", "次のターン動けなくする相手を選んでください",
        q => !q.skipTurn);
    if (!target) { if (!p.isCPU) log("フリーズできる相手がいません（すでに足止め中）", "warn"); return false; }
    pay();
    target.skipTurn = true;
    target.skipReason = "freeze";
    log(`❄️ ${p.name}のフリーズ！ ${target.name}は次のターン動けない`, "warn");

  } else if (c.spell === "treasure") {
    const n = ownedLands(G, p.id).length;
    if (n === 0) { if (!p.isCPU) log("所有している土地がありません", "warn"); return false; }
    pay();
    const gain = n * 40;
    p.magic += gain;
    SFX.coin();
    log(`💰 ${p.name}のトレジャー！ 所有地${n}マスから+${gain}G`);

  } else if (c.spell === "steal") {
    const target = p.isCPU ? aiPickStealTarget(G, p)
      : await humanPickOpponent(p, "🎭 スティール — 相手を選択", "手札から1枚をランダムに奪う相手を選んでください",
        q => q.hand.length > 0);
    if (!target) { if (!p.isCPU) log("手札を持っている相手がいません", "warn"); return false; }
    pay();
    const idx = Math.floor(Math.random() * target.hand.length);
    const stolen = target.hand.splice(idx, 1)[0];
    p.hand.push(stolen);
    log(`🎭 ${p.name}のスティール！ ${target.name}の手札から${p.isCPU ? "カード1枚" : CARD_BY_ID[stolen].name}を奪った`, "warn");
    await enforceHandLimit(p);

  } else if (c.spell === "salvage") {
    let target;
    if (p.isCPU) {
      target = aiPickSalvage(G, p);
    } else {
      if (p.discard.length === 0) { log("捨て札がありません", "warn"); return false; }
      const uniq = [...new Set(p.discard)];
      const res = await showDialog({
        title: "♻️ サルベージ — 手札に戻すカードを選択",
        body: "自分の捨て札から1枚を選んで手札に戻します",
        cards: uniq.map(id => ({ card: CARD_BY_ID[id] })),
        peek: true,
        buttons: [{ label: "やめる", value: "cancel" }],
      });
      target = res.action === "card" ? res.cardId : null;
    }
    if (!target) return false;
    pay();
    const di = p.discard.indexOf(target);
    if (di >= 0) p.discard.splice(di, 1);
    p.hand.push(target);
    log(`♻️ ${p.name}のサルベージ！ 捨て札から${CARD_BY_ID[target].name}を手札に戻した`);
    await enforceHandLimit(p);

  } else if (c.spell === "alchemy") {
    // 手札1枚（このカード自身を除く）を捨てて120Gに変える
    const ALCHEMY_GAIN = 120;
    let target;
    if (p.isCPU) {
      target = aiPickAlchemy(G, p, cardId);
    } else {
      // このカード自身は候補から外す（同名アルケミーが複数ある場合は1枚分だけ除外）
      const idx = p.hand.indexOf(cardId);
      const pool = p.hand.slice(0, idx).concat(p.hand.slice(idx + 1));
      if (pool.length === 0) { log("金に変える手札がありません", "warn"); return false; }
      const res = await showDialog({
        title: "⚗️ アルケミー — 金に変えるカードを選択",
        body: `手札から1枚を選んで捨て、<b>${ALCHEMY_GAIN}G</b> に変えます`,
        cards: pool.map(id => ({ card: CARD_BY_ID[id] })),
        peek: true,
        buttons: [{ label: "やめる", value: "cancel" }],
      });
      target = res.action === "card" ? res.cardId : null;
    }
    if (!target) return false;
    pay();
    discardFromHand(p, target);
    p.magic += ALCHEMY_GAIN;
    SFX.coin();
    log(`⚗️ ${p.name}のアルケミー！ ${CARD_BY_ID[target].name}を${ALCHEMY_GAIN}Gに変えた`);

  } else if (c.spell === "sanctuary") {
    const target = p.isCPU ? aiPickSanctuaryTarget(G, p)
      : await humanPickLand(
        ownedLands(G, p.id).filter(t => !overlayOf(G, t)),
        "🛡️ サンクチュアリ — 対象を選択",
        `${OVERLAY_DURATION}ラウンドの間、結界で守る自分の土地を選んでください<br>侵略・クリーチャー侵攻・敵スペル（クエイク/バニッシュ等）の対象になりません`,
        "対象にできる自分の土地がありません");
    if (!target) return false;
    pay();
    setOverlay(G, target, "sanctuary", p.id);
    log(`🛡️ ${p.name}のサンクチュアリ！ ${tileName(target)}が結界に守られた（${OVERLAY_DURATION}ラウンド）`);

  } else if (c.spell === "ensnare") {
    const target = p.isCPU ? aiPickEnsnareTarget(G, p)
      : await humanPickLand(
        G.tiles.filter(t => t.type === "LAND" && !overlayOf(G, t)),
        "🕸️ スネアトラップ — 対象を選択",
        `${OVERLAY_DURATION}ラウンドの間、罠を仕掛ける土地を選んでください<br>相手が<b>通過・停止</b>すると、その場で<b>足止め</b>され移動が止まります`,
        "対象にできる土地がありません");
    if (!target) return false;
    pay();
    setOverlay(G, target, "snare", p.id);
    log(`🕸️ ${p.name}のスネアトラップ！ ${tileName(target)}に罠が仕掛けられた（${OVERLAY_DURATION}ラウンド）`, "warn");

  // 🚧バリケード（v23）: 対象の土地マスを2R通行止めにする（moveOptions が進入候補から除外する。
  // 全方向を塞がれたコマは例外的に通れる＝moveOptions の保険。noCpu なのでCPUは使わない）
  } else if (c.spell === "roadblock") {
    const target = p.isCPU ? null
      : await humanPickLand(
        G.tiles.filter(t => t.type === "LAND" && !overlayOf(G, t)),
        "🚧 バリケード — 対象を選択",
        `${OVERLAY_DURATION}ラウンドの間、通行止めにする土地を選んでください<br>全プレイヤー（<b>自分も含む</b>）はそのマスへ<b>進入できなくなり</b>、迂回を強いられます`,
        "対象にできる土地がありません");
    if (!target) return false;
    pay();
    setOverlay(G, target, "block", p.id);
    log(`🚧 ${p.name}のバリケード！ ${tileName(target)}が通行止めになった（${OVERLAY_DURATION}ラウンド）`, "warn");

  // ============================================================
  // 第二弾スペル（v20）
  // ============================================================
  // --- 経済 ---
  } else if (c.spell === "elembless") {
    const n = ownedLands(G, p.id).filter(t => t.element === c.elem).length;
    if (n === 0) { if (!p.isCPU) log(`${ELEMENTS[c.elem].name}属性の土地を持っていません`, "warn"); return false; }
    pay();
    const gain = n * 70;
    p.magic += gain;
    SFX.coin();
    log(`${c.icon} ${p.name}の${c.name}！ ${ELEMENTS[c.elem].name}属性の土地${n}マスから+${gain}G`);

  } else if (c.spell === "goldrush") {
    pay();
    const gain = Math.min(250, Math.floor(p.magic * 0.2));
    p.magic += gain;
    SFX.coin();
    log(`💰 ${p.name}のゴールドラッシュ！ 所持魔力の20%＝+${gain}G`);

  } else if (c.spell === "tollpass") {
    pay();
    p.tollFree = true;
    log(`📜 ${p.name}は通行手形を手に入れた——次に払う通行料1回が無料になる`);

  } else if (c.spell === "taxcollect") {
    const targets = opponentsOf(G, p).map(q => ({ q, n: ownedLands(G, q.id).length })).filter(x => x.n > 0 && x.q.magic > 0);
    if (targets.length === 0) { if (!p.isCPU) log("徴収できる相手がいません", "warn"); return false; }
    pay();
    let total = 0;
    targets.forEach(({ q, n }) => {
      const amt = Math.min(n * 30, q.magic);
      q.magic -= amt;
      total += amt;
      log(`🧾 ${q.name}から土地${n}マス分の税 ${amt}G を徴収`);
    });
    p.magic += total;
    SFX.coin();
    log(`🧾 ${p.name}のタックスコレクト！ 合計+${total}G`);

  } else if (c.spell === "cauldron") {
    // 手札を2枚まで捨てて1枚につき+130G（人間専用・noCpu）
    const CAULDRON_GAIN = 130;
    const picks = [];
    for (let i = 0; i < 2; i++) {
      const idx = p.hand.indexOf(cardId);
      const pool = p.hand.filter((id, j) => j !== idx && !picks.includes(j));
      const poolIdx = p.hand.map((id, j) => j).filter(j => j !== idx && !picks.includes(j));
      if (pool.length === 0) break;
      const res = await showDialog({
        title: `⚗️ 錬金大釜 — ${i + 1}枚目を選択`,
        body: `手札を<b>2枚まで</b>捨て、1枚につき<b>+${CAULDRON_GAIN}G</b>${i === 1 ? "（やめる＝1枚で実行）" : ""}`,
        cards: poolIdx.map(j => ({ card: CARD_BY_ID[p.hand[j]] })),
        peek: true,
        buttons: [{ label: i === 0 ? "やめる" : "1枚で実行", value: "cancel" }],
      });
      if (res.action !== "card") { if (i === 0) return false; break; }
      // 選んだカードのインデックスを記録（同名複数に対応するため位置で管理）
      const j = poolIdx.find(k => p.hand[k] === res.cardId && !picks.includes(k));
      picks.push(j);
    }
    if (picks.length === 0) return false;
    // 先に選んだカードを捨ててから支払う（payのdiscardFromHandで手札indexがずれるのを防ぐ）
    const names = picks.map(j => CARD_BY_ID[p.hand[j]].name);
    picks.sort((a, b) => b - a).forEach(j => { p.discard.push(p.hand[j]); p.hand.splice(j, 1); });
    pay();
    p.magic += picks.length * CAULDRON_GAIN;
    SFX.coin();
    log(`⚗️ ${p.name}の錬金大釜！ ${names.join("・")}を${picks.length * CAULDRON_GAIN}Gに変えた`);

  } else if (c.spell === "pawnshop") {
    const target = await humanPickLand(ownedLands(G, p.id).filter(t => t.level >= 2),
      "🏦 質入れ — 対象を選択", "自分の土地1つを<b>Lv-1</b>し、下がった価値の<b>120%</b>を得ます",
      "質入れできる土地（自分のLv2以上）がありません");
    if (!target) return false;
    pay();
    const diff = LAND_VALUE[target.level - 1] - LAND_VALUE[target.level - 2];
    target.level--;
    const gain = Math.floor(diff * 1.2);
    p.magic += gain;
    SFX.coin();
    log(`🏦 ${p.name}の質入れ！ ${tileName(target)}をLv${target.level}に下げ、+${gain}Gを得た`);

  // --- ドロー・手札 ---
  } else if (c.spell === "foresight") {
    if (p.deck.length === 0) { if (!p.isCPU) log("山札がありません", "warn"); return false; }
    pay();
    const n = Math.min(3, p.deck.length);
    let remaining = p.deck.slice(-n); // 山札の上n枚（末尾＝一番上）
    p.deck = p.deck.slice(0, -n);
    const order = [];
    while (remaining.length > 1) {
      const res = await showDialog({
        title: `🔮 予知 — 次に引く順に選択（${order.length + 1}枚目）`,
        body: `山札の上${n}枚です。<b>次に引きたい順</b>にクリックしてください`,
        cards: remaining.map(id => ({ card: CARD_BY_ID[id] })),
        peek: true,
        buttons: [],
      });
      const i = remaining.indexOf(res.cardId);
      order.push(remaining.splice(i, 1)[0]);
    }
    order.push(remaining[0]);
    // order[0]を次に引く＝山札の一番上（末尾）になるよう逆順で積む
    p.deck.push(...order.slice().reverse());
    log(`🔮 ${p.name}の予知！ 山札の上${n}枚を並べ替えた`);

  } else if (c.spell === "revelation") {
    pay();
    const d = drawCard(G, p);
    if (d && !p.isCPU) await animateDraw(CARD_BY_ID[d]);
    p.magic += 50;
    SFX.coin();
    log(`💡 ${p.name}の天啓！ カードを${d ? 1 : 0}枚引き、+50G`);
    await enforceHandLimit(p);

  } else if (c.spell === "inspiration") {
    pay();
    let got = 0;
    for (let i = 0; i < 3; i++) { if (drawCard(G, p)) got++; }
    log(`✨ ${p.name}のインスピレーション！ カードを${got}枚引いた——1枚捨てる`);
    // 1枚捨てる（手札上限とは別の強制ディスカード）
    if (p.hand.length > 0) {
      let discardId;
      if (p.isCPU) discardId = aiChooseDiscard(G, p);
      else {
        renderHand(G);
        const res = await showDialog({
          title: "✨ インスピレーション — 捨てるカードを選択",
          body: "手札から1枚を捨ててください",
          cards: p.hand.map(id => ({ card: CARD_BY_ID[id] })),
          peek: true, buttons: [],
        });
        discardId = res.cardId;
      }
      discardFromHand(p, discardId);
      log(`${p.name}は${CARD_BY_ID[discardId].name}を捨てた`);
    }
    await enforceHandLimit(p);

  } else if (c.spell === "gravecall") {
    if (p.discard.length === 0) { if (!p.isCPU) log("捨て札がありません", "warn"); return false; }
    const picks = [];
    if (p.isCPU) {
      const cands = [...new Set(p.discard)].map(id => CARD_BY_ID[id])
        .sort((a, b) => (b.st || 0) + (b.hp || 0) + b.cost - ((a.st || 0) + (a.hp || 0) + a.cost));
      picks.push(...cands.slice(0, 2).map(x => x.id));
    } else {
      for (let i = 0; i < 2; i++) {
        const uniq = [...new Set(p.discard)].filter(id => !picks.includes(id) || p.discard.filter(x => x === id).length > picks.filter(x => x === id).length);
        if (uniq.length === 0) break;
        const res = await showDialog({
          title: `🪦 墓所の呼び声 — ${i + 1}枚目を選択`,
          body: `自分の捨て札から<b>2枚まで</b>手札に戻せます${i === 1 ? "（やめる＝1枚で実行）" : ""}`,
          cards: uniq.map(id => ({ card: CARD_BY_ID[id] })),
          peek: true,
          buttons: [{ label: i === 0 ? "やめる" : "1枚で実行", value: "cancel" }],
        });
        if (res.action !== "card") { if (i === 0) return false; break; }
        picks.push(res.cardId);
      }
      if (picks.length === 0) return false;
    }
    pay();
    picks.forEach(id => {
      const di = p.discard.indexOf(id);
      if (di >= 0) { p.discard.splice(di, 1); p.hand.push(id); }
    });
    log(`🪦 ${p.name}の墓所の呼び声！ ${picks.map(id => CARD_BY_ID[id].name).join("・")}を手札に戻した`);
    await enforceHandLimit(p);

  // --- 移動 ---
  } else if (c.spell === "tailwind") {
    pay();
    p.diceBonus = 2;
    log(`🍃 ${p.name}の追い風！ 次のダイスの出目に+2`);

  } else if (c.spell === "backstep") {
    const dests = backstepDests(G, p.pos, 3);
    if (dests.length === 0) { if (!p.isCPU) log("戻れるマスがありません", "warn"); return false; }
    const target = await humanPickTileOnMap(dests, {
      title: "↩️ バックステップ — 戻るマスを選択",
      body: "自分のコマを<b>1〜3マス後ろ</b>へ戻します（移動のみ＝マスの効果・関門は発動しません）。そのあと通常どおりダイスで移動します。",
      cancelable: true,
      labelFn: t => t.type === "LAND"
        ? `${ELEMENTS[t.element].icon} ${tileName(t)}${t.owner !== null ? `（${t.owner === p.id ? "自領" : "敵領"} Lv${t.level}）` : "（空き地）"}`
        : `#${t.id} ${tileName(t)}`,
    });
    if (!target) return false;
    pay();
    p.pos = target.id;
    p.cameFrom = null; // 戻った先では方向未確定＝どの方向へも出発できる
    log(`↩️ ${p.name}のバックステップ！ ${tileName(target)}へ戻った`);
    renderBoard(G);

  } else if (c.spell === "marchorder") {
    pay();
    p.freeMarch = true;
    log(`🎺 ${p.name}の進軍号令！ このターンの②侵攻は行軍費なし（①で行動していても②の権利が残る）`);

  } else if (c.spell === "regroup") {
    const mine = ownedLands(G, p.id).filter(t => t.creature);
    if (mine.length < 2) { if (!p.isCPU) log("入れ替えるクリーチャーが2体いません", "warn"); return false; }
    const a = await humanPickLand(mine, "🔀 集結 — 1体目を選択", "位置を入れ替える自分のクリーチャーを2体選びます（1体目）", "");
    if (!a) return false;
    const b = await humanPickLand(mine.filter(t => t.id !== a.id), "🔀 集結 — 2体目を選択",
      `1体目: ${CARD_BY_ID[a.creature.cardId].name}。入れ替える相手を選んでください`, "");
    if (!b) return false;
    pay();
    const tmp = a.creature;
    a.creature = b.creature;
    b.creature = tmp;
    log(`🔀 ${p.name}の集結！ ${CARD_BY_ID[b.creature.cardId].name}と${CARD_BY_ID[a.creature.cardId].name}が配置を入れ替えた`);

  } else if (c.spell === "posswap") {
    const target = await humanPickOpponent(p, "♟️ ポジションスワップ — 相手を選択", "コマの位置を入れ替える相手を選んでください");
    if (!target) return false;
    pay();
    const tmp = p.pos;
    p.pos = target.pos;
    target.pos = tmp;
    p.lastPath = [];
    p.cameFrom = null;      // 入れ替わった先では両者とも方向未確定
    target.cameFrom = null;
    log(`♟️ ${p.name}のポジションスワップ！ ${target.name}とコマの位置が入れ替わった`, "warn");
    renderBoard(G);

  } else if (c.spell === "reverse") {
    // 🔄 時流逆転（v24）: プレイヤー1人（自分も可）の進行方向を反転させる。
    // 通常移動は順方向のみ（v24）のため、逆走はこのスペルと🎰運命マスの渦でしか起きない
    let target;
    if (p.isCPU) {
      target = aiPickReverseTarget(G, p);
      if (!target) return false;
    } else {
      const res = await showDialog({
        title: "🔄 時流逆転 — 対象を選択",
        body: "進行方向を反転させるプレイヤーを選んでください（<b>自分</b>を選べば来た道を戻れます）",
        peek: true,
        buttons: G.players.filter(q => q.alive).map(q => ({
          label: `${P_ICONS[q.id] || ""} ${esc(q.name)}${q.id === p.id ? "（自分）" : ""}`,
          value: String(q.id),
        })).concat([{ label: "やめる", value: "cancel" }]),
      });
      if (res.action === "cancel" || res.action === "dismiss") return false;
      target = G.players[Number(res.action)];
    }
    pay();
    reverseDirection(G, target);
    SFX.spell();
    log(`🔄 ${p.name}の時流逆転！ ${target.name}の進行方向が反転した`, target.id === p.id ? undefined : "warn");
    renderBoard(G);

  } else if (c.spell === "duplicate") {
    // 🧪 増殖の秘薬（v24）: 自分の場のクリーチャー1体と同名のカードを手札に加える
    // （🐺群れ・🫧分裂・🔁転生などと組むコンボ用。コレクションには影響しない＝対戦内だけの複製）
    const mine = ownedLands(G, p.id).filter(t => t.creature);
    let target;
    if (p.isCPU) {
      target = aiPickDuplicateTarget(G, p);
      if (!target) return false;
    } else {
      target = await humanPickLand(mine, "🧪 増殖の秘薬 — 対象を選択",
        "自分の場のクリーチャー1体を選ぶと、<b>同名カード1枚</b>が手札に加わります（🐺群れ・🫧分裂と好相性）",
        "自分のクリーチャーがいません");
      if (!target) return false;
    }
    pay();
    const copyId = target.creature.cardId;
    p.hand.push(copyId);
    log(`🧪 ${p.name}の増殖の秘薬！ ${CARD_BY_ID[copyId].name}の同名カードが手札に加わった`);
    await enforceHandLimit(p);

  } else if (c.spell === "deport") {
    const target = p.isCPU ? aiPickDeportTarget(G, p)
      : await humanPickOpponent(p, "🏰 強制送還 — 相手を選択", "城へ送り返す相手を選んでください（周回はつきません）", q => q.pos !== 0);
    if (!target) { if (!p.isCPU) log("送還できる相手がいません（すでに城）", "warn"); return false; }
    pay();
    target.pos = 0;
    target.lastPath = [];
    target.cameFrom = null; // 城からの再出発＝方向リセット
    log(`🏰 ${p.name}の強制送還！ ${target.name}は城へ送り返された（周回はつかない）`, "warn");
    renderBoard(G);

  // --- バトル支援 ---
  } else if (c.spell === "bravery") {
    pay();
    p.nextBattleCrit = 0.5;
    log(`🎯 ${p.name}の決死の覚悟！ 次のバトルで会心率50%`);

  } else if (c.spell === "warcry") {
    pay();
    p.nextBattleSt = 20;
    log(`📣 ${p.name}のウォークライ！ 次のバトルでST+20`);

  } else if (c.spell === "guardwind") {
    pay();
    p.nextDefHp = 20;
    log(`🌬️ ${p.name}の護りの風！ 次に防衛する自軍クリーチャーのHP+20`);

  } else if (c.spell === "blessing") {
    const cands = ownedLands(G, p.id).filter(t => t.creature && (t.creature.grown || 0) < 5);
    const target = p.isCPU ? aiPickBlessingTarget(G, p)
      : await humanPickLand(cands, "🕊️ ブレッシング — 対象を選択",
        "自軍クリーチャー1体を<b>永続強化</b>: ST/最大HP+10（🌱成長と同じ枠＝合計+25まで）",
        "強化できるクリーチャーがいません（すでに最大強化）");
    if (!target) return false;
    pay();
    const bc = CARD_BY_ID[target.creature.cardId];
    target.creature.grown = Math.min(5, (target.creature.grown || 0) + 2);
    target.creature.hp = Math.min(maxHpOf(target.creature), currentHp(target.creature) + 10);
    log(`🕊️ ${p.name}のブレッシング！ ${bc.name}が祝福された（ST/最大HP+${Math.min(5, target.creature.grown) * 5}の強化状態）`);

  } else if (c.spell === "siege") {
    pay();
    p.siegeSt = 25;
    log(`⚔️ ${p.name}の攻城の号令！ このターンの侵略・侵攻バトルでST+25`);

  // --- 土地 ---
  } else if (c.spell === "highsell") {
    const target = await humanPickLand(ownedLands(G, p.id),
      "💱 高値売却 — 対象を選択", `自分の土地1つを<b>価値の100%</b>で売却します（通常の強制売却は${Math.round(SELL_RATE * 100)}%。駐留クリーチャーは手札に戻ります）`,
      "売却できる土地がありません");
    if (!target) return false;
    pay();
    const gain = landValue(target);
    if (target.creature) { p.hand.push(target.creature.cardId); }
    target.owner = null; target.creature = null; target.level = 1;
    p.magic += gain;
    SFX.coin();
    log(`💱 ${p.name}の高値売却！ ${tileName(target)}を${gain}Gで売り払った`);
    await enforceHandLimit(p);

  } else if (c.spell === "veinfind") {
    const target = p.isCPU ? aiPickVeinTarget(G, p)
      : await humanPickLand(ownedLands(G, p.id).filter(t => t.veinOwner === undefined || t.veinOwner === null),
        "💎 鉱脈発見 — 対象を選択", "自分の土地1つに<b>魔力鉱脈</b>を付与: 以後、自分のターン開始時<b>+20G</b>（永続・土地を失うと消える）",
        "鉱脈を掘れる土地がありません");
    if (!target) return false;
    pay();
    target.veinOwner = p.id;
    log(`💎 ${p.name}は${tileName(target)}に魔力鉱脈を発見！ 以後ターン開始時+20G`);

  } else if (c.spell === "assimilate") {
    const cands = ownedLands(G, p.id).filter(t =>
      neighborsOf(G, t).some(n => n.type === "LAND" && n.owner === p.id && n.element !== t.element));
    const target = await humanPickLand(cands,
      "🌀 属性同化 — 基準の土地を選択", "選んだ土地の属性に、<b>隣接する自領すべて</b>の属性を合わせます（連鎖の一括組み替え）",
      "同化できる土地がありません（隣接する属性違いの自領が必要）");
    if (!target) return false;
    pay();
    const changed = [];
    neighborsOf(G, target).forEach(n => {
      if (n.type === "LAND" && n.owner === p.id && n.element !== target.element) {
        changed.push(`${tileName(n)}(${ELEMENTS[n.element].name}→${ELEMENTS[target.element].name})`);
        n.element = target.element;
      }
    });
    log(`🌀 ${p.name}の属性同化！ ${changed.join("・")}`);

  } else if (c.spell === "curseland") {
    const target = p.isCPU ? aiPickCurselandTarget(G, p)
      : await humanPickLand(enemyLandsOf(G, p).filter(t => !landSpellShielded(G, t) && !landCursed(G, t)),
        "🕯️ カースランド — 対象を選択", `敵の土地1つの<b>通行料を半減</b>します（${OVERLAY_DURATION}ラウンド）`,
        "呪える敵の土地がありません");
    if (!target) return false;
    pay();
    target.curseUntil = G.round + OVERLAY_DURATION - 1;
    log(`🕯️ ${p.name}のカースランド！ ${tileName(target)}の通行料が半減（${OVERLAY_DURATION}ラウンド）`, "warn");

  } else if (c.spell === "fortify") {
    const target = p.isCPU ? aiPickFortifyTarget(G, p)
      : await humanPickLand(ownedLands(G, p.id).filter(t => !t.fortified),
        "🏯 城塞化 — 対象を選択", "自分の土地1つの<b>土地の加護（属性一致HP+）を永続的に2倍</b>にします",
        "城塞化できる土地がありません");
    if (!target) return false;
    pay();
    target.fortified = true;
    log(`🏯 ${p.name}の城塞化！ ${tileName(target)}の加護が2倍になった（永続）`);

  } else if (c.spell === "grandquake") {
    let targets;
    if (p.isCPU) {
      targets = aiPickGrandquakeTargets(G, p);
      if (!targets) return false;
    } else {
      const pool = enemyLandsOf(G, p).filter(t => t.level > 1 && !landSpellShielded(G, t));
      const t1 = await humanPickLand(pool, "🌋 グランドクエイク — 1つ目を選択", "敵の土地を<b>2つまで</b>選び、それぞれLv-1します", "対象となる敵の土地（Lv2以上）がありません");
      if (!t1) return false;
      const rest = pool.filter(t => t.id !== t1.id);
      let t2 = null;
      if (rest.length > 0) {
        t2 = await humanPickTileOnMap(rest, {
          title: "🌋 グランドクエイク — 2つ目を選択",
          body: "2つ目の対象を選んでください（キャンセル＝1つだけで実行）",
          cancelable: true, cancelLabel: "1つだけで実行",
          labelFn: t => `${ELEMENTS[t.element].icon} ${tileName(t)}（Lv${t.level}）`,
        });
      }
      targets = t2 ? [t1, t2] : [t1];
    }
    pay();
    targets.forEach(t => { t.level = Math.max(1, t.level - 1); });
    log(`🌋 ${p.name}のグランドクエイク！ ${targets.map(t => `${tileName(t)}→Lv${t.level}`).join("・")}`, "warn");

  } else if (c.spell === "levelshift") {
    const src = await humanPickLand(ownedLands(G, p.id).filter(t => t.level >= 2),
      "⚖️ レベル移植 — 移す元を選択", "自分の土地1つを<b>Lv-1</b>し、別の自分の土地を<b>Lv+1</b>します（移す元＝Lv2以上）",
      "移植元の土地（自分のLv2以上）がありません");
    if (!src) return false;
    const dst = await humanPickLand(ownedLands(G, p.id).filter(t => t.id !== src.id && t.level < 5),
      "⚖️ レベル移植 — 移す先を選択", `${tileName(src)}のレベルを移す先を選んでください（Lv4以下）`,
      "移植先の土地がありません");
    if (!dst) return false;
    pay();
    src.level--;
    dst.level++;
    log(`⚖️ ${p.name}のレベル移植！ ${tileName(src)}→Lv${src.level} ／ ${tileName(dst)}→Lv${dst.level}`);

  // --- 妨害 ---
  } else if (c.spell === "spy") {
    const target = await humanPickOpponent(p, "🕵️ スパイ — 相手を選択", "手札をすべて見る相手を選んでください", q => q.hand.length > 0);
    if (!target) { if (!p.isCPU) log("手札を持っている相手がいません", "warn"); return false; }
    pay();
    log(`🕵️ ${p.name}のスパイ！ ${target.name}の手札を覗き見た`);
    await showDialog({
      title: `🕵️ ${target.name}の手札（${target.hand.length}枚）`,
      body: "相手の手札は以下のとおり——",
      cards: target.hand.map(id => ({ card: CARD_BY_ID[id] })),
      peek: true,
      buttons: [{ label: "閉じる", value: "close", primary: true }],
    });

  } else if (c.spell === "cursedice") {
    const target = p.isCPU ? aiPickSlowTarget(G, p)
      : await humanPickOpponent(p, "🎲 呪いのダイス — 相手を選択", "次の出目を1〜3にする相手を選んでください");
    if (!target) return false;
    pay();
    target.diceCurse = true;
    log(`🎲 ${p.name}の呪いのダイス！ ${target.name}の次の出目は1〜3になる`, "warn");

  } else if (c.spell === "mudswamp") {
    const target = p.isCPU ? aiPickSlowTarget(G, p)
      : await humanPickOpponent(p, "🟤 泥沼 — 相手を選択", "次の移動を出目半分（切り上げ）にする相手を選んでください");
    if (!target) return false;
    pay();
    target.mudded = true;
    log(`🟤 ${p.name}の泥沼！ ${target.name}の次の移動は半減する`, "warn");

  } else if (c.spell === "whisper") {
    const target = p.isCPU ? aiPickStealTarget(G, p)
      : await humanPickOpponent(p, "😈 悪夢の囁き — 相手を選択", "手札からランダムに1枚捨てさせる相手を選んでください", q => q.hand.length > 0);
    if (!target) { if (!p.isCPU) log("手札を持っている相手がいません", "warn"); return false; }
    pay();
    const idx = Math.floor(Math.random() * target.hand.length);
    const dumped = target.hand.splice(idx, 1)[0];
    target.discard.push(dumped);
    log(`😈 ${p.name}の悪夢の囁き！ ${target.name}は${CARD_BY_ID[dumped].name}を捨てた`, "warn");

  } else if (c.spell === "manaburn") {
    const target = p.isCPU ? richestOpponent(G, p)
      : await humanPickOpponent(p, "🔥 マナバーン — 相手を選択", "魔力の20%を消滅させる相手を選んでください（上限300G）");
    if (!target) return false;
    const amt = Math.min(300, Math.floor(target.magic * 0.2));
    if (amt <= 0) { if (!p.isCPU) log("相手に燃やせる魔力がありません", "warn"); return false; }
    pay();
    target.magic -= amt;
    log(`🔥 ${p.name}のマナバーン！ ${target.name}の魔力${amt}Gが燃え尽きた（誰の物にもならない）`, "warn");

  } else if (c.spell === "nullfog") {
    const target = p.isCPU ? aiPickNullfogTarget(G, p)
      : await humanPickLand(
        enemyLandsOf(G, p).filter(t => t.creature && !isSanctuaryProtected(G, t) && !isSpellProof(t) && !creatureNulled(G, t.creature)),
        "🌫️ 無力化の霧 — 対象を選択", `敵クリーチャー1体の<b>能力をすべて消します</b>（${OVERLAY_DURATION}ラウンド。アイテムで得る能力は消えない）※<b>護法</b>持ちは対象外`,
        "対象にできる敵クリーチャーがいません");
    if (!target) return false;
    pay();
    target.creature.nulledUntil = G.round + OVERLAY_DURATION - 1;
    log(`🌫️ ${p.name}の無力化の霧！ ${CARD_BY_ID[target.creature.cardId].name}の能力が消えた（${OVERLAY_DURATION}ラウンド）`, "warn");

  } else if (c.spell === "silencefog") {
    const target = p.isCPU ? aiPickSilenceTarget(G, p)
      : await humanPickOpponent(p, "🤫 沈黙の霧 — 相手を選択", "次のターン、スペルを使えなくする相手を選んでください");
    if (!target) return false;
    pay();
    target.spellSealed = true;
    log(`🤫 ${p.name}の沈黙の霧！ ${target.name}は次のターンスペルを使えない`, "warn");

  } else if (c.spell === "truce") {
    pay();
    addFx(G, "truce", p.id, OVERLAY_DURATION);
    log(`🏳️ ${p.name}の停戦協定！ ${OVERLAY_DURATION}ラウンドの間、全員が侵略・侵攻できない`, "warn");

  } else if (c.spell === "freezerain") {
    const targets = opponentsOf(G, p).filter(q => !q.skipTurn);
    if (targets.length === 0) { if (!p.isCPU) log("凍らせる相手がいません（すでに足止め中）", "warn"); return false; }
    pay();
    targets.forEach(q => { q.skipTurn = true; q.skipReason = "freeze"; });
    log(`🧊 ${p.name}のフリーズレイン！ ${targets.map(q => q.name).join("・")}は次のターン動けない`, "warn");

  } else if (c.spell === "miragefield") {
    pay();
    addFx(G, "mirage", p.id, OVERLAY_DURATION);
    log(`🏜️ ${p.name}の蜃気楼！ ${OVERLAY_DURATION}ラウンドの間、自分の土地は敵の土地対象スペルの対象にならない`);

  // --- 🕯️儀式（手札1枚を捧げる） ---
  } else if (c.spell === "r_harvest") {
    const sac = await ritualSacrifice(p, cardId, c.name);
    if (!sac) return false;
    pay();
    discardFromHand(p, sac);
    p.magic += 350;
    SFX.coin();
    log(`🕯️ ${p.name}の豊穣の儀！ ${CARD_BY_ID[sac].name}を捧げ、+350G`);

  } else if (c.spell === "r_contract") {
    if (p.deck.length === 0) { if (!p.isCPU) log("山札がありません", "warn"); return false; }
    const uniq = [...new Set(p.deck)].sort((a, b) => typeOrder(a) - typeOrder(b) || CARD_BY_ID[a].cost - CARD_BY_ID[b].cost);
    const res = await showDialog({
      title: "🕯️ 契約の儀 — 山札から選択",
      body: "山札から好きなカード1枚を手札に加えます（そのあと山札は切り直す）",
      cards: uniq.map(id => ({ card: CARD_BY_ID[id] })),
      peek: true,
      buttons: [{ label: "やめる", value: "cancel" }],
    });
    if (res.action !== "card") return false;
    const sac = await ritualSacrifice(p, cardId, c.name);
    if (!sac) return false;
    pay();
    discardFromHand(p, sac);
    const di = p.deck.indexOf(res.cardId);
    p.deck.splice(di, 1);
    p.hand.push(res.cardId);
    p.deck = shuffle(p.deck);
    log(`🕯️ ${p.name}の契約の儀！ ${CARD_BY_ID[sac].name}を捧げ、山札から${CARD_BY_ID[res.cardId].name}を引き当てた`);
    await enforceHandLimit(p);

  } else if (c.spell === "r_blaze") {
    const target = p.isCPU ? aiPickBlazeTarget(G, p)
      : await humanPickLand(
        enemyLandsOf(G, p).filter(t => t.creature && !isSanctuaryProtected(G, t) && !isSpellProof(t)),
        "🕯️ 猛火の儀 — 対象を選択", "敵クリーチャー1体に<b>70ダメージ</b>（護法・結界は対象外）",
        "対象にできる敵クリーチャーがいません");
    if (!target) return false;
    const sac = await ritualSacrifice(p, cardId, c.name);
    if (!sac) return false;
    pay();
    discardFromHand(p, sac);
    const victim = CARD_BY_ID[target.creature.cardId];
    const newHp = currentHp(target.creature) - 70;
    if (newHp <= 0) {
      G.players[target.owner].discard.push(target.creature.cardId);
      const nm = tileName(target);
      target.creature = null; target.owner = null;
      log(`🕯️ ${p.name}の猛火の儀！ ${CARD_BY_ID[sac].name}を捧げた業火が${victim.name}を焼き尽くした——${nm}は空き地に`, "warn");
    } else {
      target.creature.hp = newHp;
      log(`🕯️ ${p.name}の猛火の儀！ ${victim.name}に70ダメージ（残りHP${newHp}）`, "warn");
    }

  } else if (c.spell === "r_revive") {
    const creatures = [...new Set(p.discard)].filter(id => CARD_BY_ID[id].type === "creature");
    const empties = G.tiles.filter(t => t.type === "LAND" && t.owner === null);
    if (creatures.length === 0 || empties.length === 0) {
      if (!p.isCPU) log("蘇生できるクリーチャー（捨て札）か空き地がありません", "warn");
      return false;
    }
    let reviveId, dst;
    if (p.isCPU) {
      const pick = aiPickReviveTarget(G, p);
      if (!pick) return false;
      reviveId = pick.cardId; dst = pick.tile;
    } else {
      const res = await showDialog({
        title: "🕯️ 蘇生の儀 — 蘇らせるクリーチャーを選択",
        body: "自分の捨て札のクリーチャー1体を、好きな<b>空き地</b>へ<b>コスト不要</b>で召喚します",
        cards: creatures.map(id => ({ card: CARD_BY_ID[id] })),
        peek: true,
        buttons: [{ label: "やめる", value: "cancel" }],
      });
      if (res.action !== "card") return false;
      reviveId = res.cardId;
      dst = await humanPickLand(empties, `🕯️ ${CARD_BY_ID[reviveId].name}の召喚先を選択`, "蘇生先の空き地を選んでください", "空き地がありません");
      if (!dst) return false;
    }
    const sac = await ritualSacrifice(p, cardId, c.name);
    if (!sac) return false;
    pay();
    discardFromHand(p, sac);
    const di = p.discard.indexOf(reviveId);
    if (di >= 0) p.discard.splice(di, 1);
    dst.owner = p.id;
    dst.creature = { cardId: reviveId, hp: CARD_BY_ID[reviveId].hp };
    SFX.summon();
    log(`🕯️ ${p.name}の蘇生の儀！ ${CARD_BY_ID[sac].name}を捧げ、${CARD_BY_ID[reviveId].name}が${tileName(dst)}に蘇った`);

  } else if (c.spell === "r_ages") {
    const target = p.isCPU ? aiPickAgesTarget(G, p)
      : await humanPickLand(ownedLands(G, p.id).filter(t => t.level <= 3),
        "🕯️ 星霜の儀 — 対象を選択", "自分の土地1つを<b>Lv+2</b>します（Lv4まで）",
        "対象となる土地（自分のLv3以下）がありません");
    if (!target) return false;
    const sac = await ritualSacrifice(p, cardId, c.name);
    if (!sac) return false;
    pay();
    discardFromHand(p, sac);
    target.level = Math.min(4, target.level + 2);
    log(`🕯️ ${p.name}の星霜の儀！ ${CARD_BY_ID[sac].name}を捧げ、${tileName(target)}が一気にLv${target.level}へ成長した`);

  } else if (c.spell === "r_storm") {
    const victims = enemyLandsOf(G, p).filter(t => t.creature && !isSanctuaryProtected(G, t) && !isSpellProof(t));
    if (victims.length === 0) { if (!p.isCPU) log("対象にできる敵クリーチャーがいません", "warn"); return false; }
    const sac = await ritualSacrifice(p, cardId, c.name);
    if (!sac) return false;
    pay();
    discardFromHand(p, sac);
    log(`🕯️ ${p.name}の嵐の儀！ ${CARD_BY_ID[sac].name}を捧げた嵐が敵軍を襲う——全体に25ダメージ`, "warn");
    victims.forEach(t => {
      const victim = CARD_BY_ID[t.creature.cardId];
      const newHp = currentHp(t.creature) - 25;
      if (newHp <= 0) {
        G.players[t.owner].discard.push(t.creature.cardId);
        t.creature = null; t.owner = null;
        log(`⚡ ${victim.name}は嵐に倒れ、${tileName(t)}は空き地に戻った`, "warn");
      } else {
        t.creature.hp = newHp;
        log(`⚡ ${victim.name}に25ダメージ（残りHP${newHp}）`);
      }
    });

  } else if (c.spell === "r_time") {
    const sac = await ritualSacrifice(p, cardId, c.name);
    if (!sac) return false;
    pay();
    discardFromHand(p, sac);
    p.timeRitual = true;
    log(`🕯️ ${p.name}の時の儀！ ${CARD_BY_ID[sac].name}を捧げ、このターンもう一度動けるようになった`, "warn");

  } else if (c.spell === "r_purify") {
    const sac = await ritualSacrifice(p, cardId, c.name);
    if (!sac) return false;
    pay();
    discardFromHand(p, sac);
    let cleared = 0;
    G.tiles.forEach(t => {
      if (t.overlay) { t.overlay = null; cleared++; }
      if (t.curseUntil) { delete t.curseUntil; cleared++; }
      if (t.creature && t.creature.nulledUntil) { delete t.creature.nulledUntil; cleared++; }
    });
    if (G.fxList && G.fxList.length) { cleared += G.fxList.length; G.fxList = []; }
    healAllCreatures(G, p);
    log(`🕯️ ${p.name}の浄化の儀！ ${CARD_BY_ID[sac].name}を捧げ、盤面の時限効果${cleared}件を洗い流し、自軍は全回復した`);

  // --- 盤面エフェクト（全体・2R） ---
  } else if (c.spell === "fx_market") {
    pay();
    addFx(G, "market", p.id, OVERLAY_DURATION);
    log(`🏪 ${p.name}の市場開放！ ${OVERLAY_DURATION}Rの間、カードマスで2枚ドロー（全員）`);

  } else if (c.spell === "fx_bud") {
    pay();
    addFx(G, "bud", p.id, OVERLAY_DURATION);
    log(`🌸 ${p.name}の春の芽吹き！ ${OVERLAY_DURATION}Rの間、自軍はターン開始時HP+15回復`);

  } else if (c.spell === "fx_war") {
    pay();
    addFx(G, "war", p.id, OVERLAY_DURATION);
    log(`🔥 ${p.name}の戦火の世！ ${OVERLAY_DURATION}Rの間、攻め側ST+20（全員）`, "warn");

  } else if (c.spell === "fx_manastorm") {
    pay();
    addFx(G, "manastorm", p.id, OVERLAY_DURATION);
    log(`⚡ ${p.name}の魔力嵐！ ${OVERLAY_DURATION}Rの間、すべての通行料1.5倍`, "warn");

  } else if (c.spell === "fx_silence") {
    pay();
    addFx(G, "silence", p.id, OVERLAY_DURATION);
    log(`🌙 ${p.name}の静寂のとばり！ ${OVERLAY_DURATION}Rの間、対象指定スペルは全員使えない`, "warn");

  } else if (c.spell === "fx_goddess") {
    pay();
    addFx(G, "goddess", p.id, OVERLAY_DURATION);
    log(`👼 ${p.name}の女神の加護！ ${OVERLAY_DURATION}Rの間、自分の土地の加護2倍＋援護ST+10`);
  }

  SFX.spell();
  renderAll(G);
  return true;
}

// 🕯️儀式の追加コスト: 手札1枚（このカード自身を除く）を捧げる。
// 選べなければ null（キャンセル＝不発・コスト未消費）。呼び出し側が discardFromHand する
async function ritualSacrifice(p, selfId, spellName) {
  const idx = p.hand.indexOf(selfId);
  const pool = p.hand.slice(0, idx).concat(p.hand.slice(idx + 1));
  if (pool.length === 0) { if (!p.isCPU) log("儀式に捧げる手札がありません", "warn"); return null; }
  if (p.isCPU) return aiPickSacrifice(G, p, selfId);
  const res = await showDialog({
    title: `🕯️ ${spellName} — 捧げる手札を選択`,
    body: "儀式の追加コストとして、手札から1枚を選んで捧げます（捨て札へ）",
    cards: pool.map(id => ({ card: CARD_BY_ID[id] })),
    peek: true,
    buttons: [{ label: "やめる", value: "cancel" }],
  });
  return res.action === "card" ? res.cardId : null;
}

// スペル対象の土地を選ぶ（人間用）。盤面から直接クリックでも選べる。候補なし/キャンセルなら null
async function humanPickLand(candidates, title, body, emptyMsg) {
  if (candidates.length === 0) { log(emptyMsg, "warn"); return null; }
  return humanPickTileOnMap(candidates, {
    title, body, cancelable: true,
    labelFn: t => `${ELEMENTS[t.element].icon} ${tileName(t)}（Lv${t.level}・価値${landValue(t)}G${t.creature ? "・" + ELEMENTS[CARD_BY_ID[t.creature.cardId].element].icon + CARD_BY_ID[t.creature.cardId].name : ""}）`,
  });
}

// ---------- 移動 ----------
// v24（方向つき移動）: 各歩で moveOptions（背後を除いた隣接・➡一方通行/🚧封鎖を考慮）から進む先を選ぶ。
// 背後＝移動中は直前のマス、移動開始時は p.cameFrom（前のターンに来た方向）＝通常は逆走できない。
// 分岐・交差で候補が複数なら人間は選択ダイアログ・CPUは先読み評価。ゲーム開始直後や
// テレポート等の直後は cameFrom=null＝🧭どの方向へも出発できる
async function movePlayer(p, steps) {
  let prevId = p.cameFrom ?? null; // 背後のマス（逆走禁止用。旧セーブ互換で undefined も null に）
  for (let i = 0; i < steps; i++) {
    const cur = G.tiles[p.pos];
    const opts = moveOptions(G, cur, prevId);
    let nextId = opts[0].id;
    if (opts.length > 1) {
      nextId = p.isCPU
        ? aiChooseDirection(G, p, cur, steps - i, prevId)
        : await humanChooseDirection(p, cur, steps - i, prevId);
    }
    prevId = cur.id;
    p.cameFrom = cur.id; // 進行方向を記憶（次のターンもこの方向を保つ）
    p.pos = nextId;
    p.lastPath.push(p.pos);
    renderBoard(G);
    await sleep(170);
    const tile = G.tiles[p.pos];
    if (tile.type === "GATE" && !p.gates.has(tile.id)) {
      p.gates.add(tile.id);
      p.magic += RULES.gateBonus;
      SFX.coin();
      log(`⛩️ ${p.name}は関門を通過 +${RULES.gateBonus}G`);
      renderPanels(G);
    }
    if (tile.type === "CASTLE") {
      // 最後の1歩でぴったり城に停止したか（それ以外は「通過」）
      if (arriveCastle(G, p, i === steps - 1) === "win") return;
    }
    // ⚓港湾（v19）: 自分の灯台マスを通過・停止するたび+40G
    if (tile.type === "LAND" && tile.owner === p.id && tile.creature &&
        CARD_BY_ID[tile.creature.cardId].ab.includes("harbor")) {
      p.magic += 40;
      SFX.coin();
      log(`⚓ ${p.name}は灯台の港に立ち寄った +40G`);
      renderPanels(G);
    }
    // 足止めの罠: 術者以外が通過・停止するとその場で止まり、残りの移動を打ち切る
    if (snareOn(G, tile, p.id)) {
      tile.overlay = null; // 一度で発動して消える
      SFX.hit();
      log(`🕸️ ${p.name}は${tileName(tile)}の罠にかかった！ その場で足止め（移動終了）`, "warn");
      renderBoard(G);
      await sleep(300);
      break;
    }
  }
}

// 城に到達したときの共通処理（歩いての帰城・🌀ワープでの帰城・✨リコールの全てで使う）。
// ① 勝利判定（総資産が目標以上）
// ② 周回ボーナス（関門を規定数すべて通過済み）＝魔力ボーナス＋自軍クリーチャー全回復。
//    通過でも、ぴったり停止でも発動する（req: 周回の報酬は城を「通れば」得られる）。
// ③ 領地コントロール（exact＝城のマスにぴったり停止／リコールで着地）＝全自領で1アクション。
//    周回の有無に関係なく、拠点の城に「留まった」こと自体の報酬（req: 周回ボーナスに限らない）。
// 戻り値: "win"（勝利で終局）／ "lap"（周回達成）／ "stay"（周回なしのぴったり停止）／ null（素通り）
function arriveCastle(g, p, exact = true) {
  if (assetsOf(g, p) >= RULES.target) {
    renderAll(g);
    endGame(p, `${p.name}は総資産${assetsOf(g, p)}Gで城に帰還！`);
    return "win";
  }
  let result = null;
  if (p.gates.size >= gatesNeededOf(g)) {
    p.laps++;
    p.gates.clear();
    const bonus = lapBonus(g, p);
    p.magic += bonus.gold;
    SFX.coin();
    if (bonus.comeback) log(`🔥 逆転の風が吹く！ 劣勢ボーナス1.5倍`, "warn");
    healAllCreatures(g, p); // 周回ボーナス＝魔力＋全回復（城の通過・停止どちらでも）
    log(`🏰 ${p.name}は周回達成！ +${bonus.gold}G — 自軍クリーチャーのHPが全回復！`);
    if (typeof cpuSay === "function") cpuSay(p, "lap");
    result = "lap";
  }
  if (exact) {
    // 城にぴったり停止＝領地コントロール。周回していなくても、拠点で軍に指示を出せる
    p.passAllLands = true;
    log(`🏰 ${p.name}は城に留まり軍を指揮——全ての自領で1回行動できる！（領地コントロール）`);
    if (!result) result = "stay";
  }
  renderPanels(g);
  return result;
}

// 指定プレイヤーの全クリーチャーのHPを最大に戻す（周回ボーナス）。成長分（v19）も含めた実最大HPまで
function healAllCreatures(g, p) {
  g.tiles.forEach(t => {
    if (t.type === "LAND" && t.owner === p.id && t.creature) {
      t.creature.hp = maxHpOf(t.creature);
    }
  });
}

// ---------- 停止マスの処理 ----------
// 停止マスの受け身イベントを処理し、①で自主的な行動（召喚/レベルアップ/交代/侵略）をしたら true を返す。
// true のときだけ②通過アクションは行わない。カード/魔力/ワープ/マグマ/関門/城などの受け身マスは
// false（＝このターン通過した自領があれば②通過アクションを選べる）。
async function tileAction(p, tile) {
  switch (tile.type) {
    case "CARD": {
      // 🏪市場開放（v20）: 2Rの間、カードマスで2枚ドロー（全員）
      const n = activeFx(G, "market") ? 2 : 1;
      let got = 0;
      for (let i = 0; i < n; i++) {
        const d = drawCard(G, p);
        if (!d) break;
        got++;
        if (!p.isCPU) await animateDraw(CARD_BY_ID[d]);
      }
      log(`🎴 ${p.name}はカードマスで${got ? `${got}枚ドロー${n === 2 ? "（🏪市場開放）" : ""}` : "…山札切れ"}`);
      await enforceHandLimit(p);
      return false;
    }
    case "MAGIC":
      p.magic += RULES.magicTileG;
      SFX.coin();
      log(`💎 ${p.name}は魔力マスで+${RULES.magicTileG}G`);
      return false;
    case "WARP": {
      await sleep(300);
      p.pos = tile.warpTo;
      p.cameFrom = null; // ワープ先では方向未確定＝どの方向へも出発できる
      p.lastPath.push(p.pos);
      SFX.spell();
      log(`🌀 ${p.name}はワープした！`);
      renderBoard(G);
      await sleep(400);
      return false; // 行き先も🌀なので追加処理なし
    }
    case "MAGMA": {
      const loss = Math.min(RULES.magmaLoss, p.magic);
      p.magic -= loss;
      SFX.hit();
      log(`🌋 ${p.name}はマグマで足止め… -${loss}G`, "warn");
      return false;
    }
    case "BOOST": {
      SFX.dice();
      log(`💨 疾風が${p.name}を運ぶ！ さらに2マス進む`);
      await sleep(300);
      await movePlayer(p, 2);
      if (G.over) return false;
      return await tileAction(p, G.tiles[p.pos]); // 進んだ先のマスの判定を引き継ぐ
    }
    case "FORTUNE": {
      // 🎰 運命マス: 何が出るかはお楽しみ（期待値はややプラス・15%ではずれ）
      SFX.dice();
      log(`🎰 ${p.name}は運命のルーレットを回した——`);
      await sleep(550);
      const r = Math.random();
      if (r < 0.10) {
        p.magic += 300; SFX.coin();
        log(`🎉 大当り！ 女神の祝福で +300G！`, "warn");
      } else if (r < 0.35) {
        p.magic += 150; SFX.coin();
        log(`💰 当り！ +150G`);
      } else if (r < 0.60) {
        const a = drawCard(G, p), b = drawCard(G, p);
        log(`🎴 運命の導き！ カードを${(a ? 1 : 0) + (b ? 1 : 0)}枚ドロー`);
        if (a && !p.isCPU) await animateDraw(CARD_BY_ID[a]);
        if (b && !p.isCPU) await animateDraw(CARD_BY_ID[b]);
        await enforceHandLimit(p);
      } else if (r < 0.80) {
        p.diceMult = 2;
        log(`🎲 追い風の予感！ 次のダイスの出目が2倍になる`);
      } else if (r < 0.90) {
        // 🌀 時空の渦（v24）: 進行方向が反転するイベント（逆走はスペルとこれでのみ起きる）
        reverseDirection(G, p);
        SFX.spell();
        log(`🌀 時空の渦に呑まれた！ ${p.name}の進行方向が反転した`, "warn");
      } else {
        const loss = Math.min(100, p.magic);
        p.magic -= loss; SFX.hit();
        log(`💨 はずれ… -${loss}G`, "warn");
      }
      return false;
    }
    case "SPRING": {
      // ⛲ 泉マス: 自軍クリーチャー全回復＋少額の魔力（周回を待たずに前線を立て直せる）
      const wounded = G.tiles.filter(t =>
        t.type === "LAND" && t.owner === p.id && t.creature && isWounded(t.creature)).length;
      healAllCreatures(G, p);
      p.magic += 60;
      SFX.coin();
      log(`⛲ ${p.name}は癒しの泉で安らいだ +60G${wounded ? `・負傷クリーチャー${wounded}体が全回復！` : ""}`);
      return false;
    }
    case "CASTLE":
    case "GATE":
      return false; // 受け身（通過処理で対応済み）。通過した自領があれば②を行える
    case "LAND":
      return await landAction(p, tile);
  }
  return false;
}

// --- 土地マス(①到着イベント): 空き地=召喚 ／ 自分の土地=レベルアップor交代 ／ 敵地=通行料 or 侵略 ---
// 自主的な行動（召喚/レベルアップ/交代/侵略）をしたら true を返す。通行料のみ・パスなら false。
// ②通過アクションを行えるか（＝①で自主行動していないか）は playTurn が全停止マス共通で判定する。
async function landAction(p, tile) {
  let acted = false; // ①で実際に行動したか（召喚/レベルアップ/交代/侵略）
  if (tile.owner === null) acted = await summonFlow(p, tile);
  else if (tile.owner === p.id) acted = await ownLandFlow(p, tile);
  else acted = await enemyLandFlow(p, tile); // 侵略バトルをしたら true（通行料のみなら false）
  return acted;
}

// ② 通過アクション: 通過地レベルアップ / 通過クリーチャーの侵攻 / 通過地のクリーチャー交代（どれか1つ、任意）
async function passActionPhase(p) {
  if (p.isCPU) {
    const plan = aiChooseMarch(G, p);
    if (plan) { await sleep(CPU_WAIT); await doMarch(p, plan.src, plan.dst, plan.itemId); return; }
    const swap = aiChoosePassSwap(G, p);
    if (swap) { await sleep(CPU_WAIT); doPassSwap(p, swap.tile, swap.cardId); return; }
    const upTile = aiChoosePassLevelUp(G, p);
    if (upTile) { await sleep(CPU_WAIT); doPassLevelup(p, upTile); }
    return;
  }
  // 人間: どれか1つを選ぶ（キャンセルすると選び直し）
  while (true) {
    const canMarch = marchSources(G, p).length > 0;
    const canSwap = passSwapSources(G, p).length > 0;
    const canPassUp = passLevelupSources(G, p).length > 0;
    if (!canMarch && !canSwap && !canPassUp) return;
    const buttons = [];
    const lines = [];
    if (canMarch) {
      buttons.push({ label: "🏇 クリーチャー侵攻", value: "march" });
      lines.push("・<b>クリーチャー侵攻</b>：通過した自分のクリーチャーを隣のマスへ進める（行軍費を支払う）");
    }
    if (canSwap) {
      buttons.push({ label: "🔄 クリーチャー交代", value: "swap" });
      lines.push("・<b>クリーチャー交代</b>：通過した自分の土地の駐留クリーチャーを手札のクリーチャーと入れ替える");
    }
    if (canPassUp) {
      buttons.push({ label: "⬆ 通過地レベルアップ", value: "passup" });
      lines.push("・<b>通過地レベルアップ</b>：通過した自分の土地を1つ強化する");
    }
    buttons.push({ label: "何もしない", value: "skip", primary: true });
    const all = p.passAllLands;
    const res = await showDialog({
      title: all ? "🏰 領地コントロール（全自領が対象）" : "🏇 通過アクション（このターンの行動権をここで使う／任意）",
      body: (all
        ? "<b>城に停止（領地コントロール）！</b> <b>すべての自分の領地</b>について次のいずれか1つを行えます（使わないなら「何もしない」）。<br>"
        : "①到達マスでは能動的な行動をしなかったので、<b>このターンの能動行動の権利</b>が残っています。<br>" +
          "このターンに<b>通過した</b>自分の領地について、次のいずれか1つに使えます（使わないなら「何もしない」）。<br>" +
          "※出発マス（ターン開始時にいたマス）は対象外です（前のターンの到達アクションで命令できたため）。<br>") +
        lines.join("<br>"),
      peek: true,
      buttons,
    });
    if (res.action === "march") { if (await humanMarchFlow(p)) return; else continue; }
    if (res.action === "swap") { if (await humanPassSwapFlow(p)) return; else continue; }
    if (res.action === "passup") { if (await humanPassLevelupFlow(p)) return; else continue; }
    return;
  }
}

// 通過した自分の土地を1つレベルアップ（このマスの通常アクションは行わない = 通過イベント1件）
function doPassLevelup(p, tile) {
  const cost = levelUpCost(tile);
  if (!isFinite(cost) || cost > p.magic) return;
  p.magic -= cost;
  tile.level++;
  SFX.coin();
  log(`⬆ ${p.name}は通過した${tileName(tile)}をLv${tile.level}に強化した（-${cost}G）`);
  renderAll(G);
}

// 人間用: 通過した自分の土地から1つ選んでレベルアップ。キャンセルなら false
async function humanPassLevelupFlow(p) {
  const sources = passLevelupSources(G, p);
  if (sources.length === 0) return false;
  const t = await humanPickTileOnMap(sources, {
    title: "⬆ 通過地レベルアップ — 対象を選択",
    body: p.passAllLands
      ? "強化する自分の土地を1つ選んでください（領地コントロール＝全ての自領が対象）"
      : "このターンに通過した自分の土地を1つレベルアップできます（このマスの通常アクションは行いません）",
    cancelable: true,
    labelFn: t => `${ELEMENTS[t.element].icon} ${tileName(t)}（Lv${t.level}→${t.level + 1}／${levelUpCost(t)}G）`,
  });
  if (!t) return false;
  doPassLevelup(p, t);
  return true;
}

// 通過した自分の土地の駐留クリーチャーを手札のクリーチャーと交代（②通過アクション1件）
function doPassSwap(p, tile, cardId) {
  const c = CARD_BY_ID[cardId];
  if (c.cost > p.magic) {
    log(`⚠ 魔力が足りず交代できない（${c.name} ${c.cost}G／魔力 ${p.magic}G）`, "warn");
    return;
  }
  const oldId = swapCreatureOnTile(p, tile, cardId);
  log(`🔄 ${p.name}は通過した${tileName(tile)}の${CARD_BY_ID[oldId].name}を${c.name}に交代した（-${c.cost}G）`);
  renderAll(G);
}

// 人間用: 通過した自分の土地→手札クリーチャーを選んで交代。キャンセルなら false
async function humanPassSwapFlow(p) {
  const sources = passSwapSources(G, p);
  if (sources.length === 0) return false;
  // 1. 交代する土地を選ぶ（盤面からも選べる）
  let src;
  if (sources.length === 1) {
    src = sources[0];
  } else {
    src = await humanPickTileOnMap(sources, {
      title: "🔄 クリーチャー交代 — 土地を選択",
      body: p.passAllLands
        ? "駐留クリーチャーを入れ替える自分の土地を選んでください（領地コントロール＝全ての自領が対象）"
        : "このターンに通過した自分の土地の駐留クリーチャーを、手札のクリーチャーと入れ替えます",
      cancelable: true,
      labelFn: t => { const c = CARD_BY_ID[t.creature.cardId]; return `${ELEMENTS[t.element].icon} ${tileName(t)}｜駐留 ${ELEMENTS[c.element].icon}${c.name}`; },
    });
    if (!src) return false;
  }
  // 2. 手札のクリーチャーを選ぶ
  const cur = CARD_BY_ID[src.creature.cardId];
  const curHp = currentHp(src.creature);
  const creatures = p.hand.filter(id => CARD_BY_ID[id].type === "creature");
  const res2 = await showDialog({
    title: `🔄 ${tileName(src)} の交代先を選択`,
    body: `駐留: ${ELEMENTS[cur.element].icon}${esc(cur.name)}（${ELEMENTS[cur.element].name}属性・ST${cur.st}/HP${curHp < cur.hp ? `${curHp}/${cur.hp}` : cur.hp}${elemNote(cur, src)}）<br>` +
      `手札のクリーチャーをクリックで交代（召喚コストを支払い、今のカードは手札に戻る。HP全快で駐留）／ 魔力 ${p.magic}G`,
    cards: creatures.map(id => ({ card: CARD_BY_ID[id], disabled: CARD_BY_ID[id].cost > p.magic })),
    peek: true,
    buttons: [{ label: "やめる", value: "cancel" }],
  });
  if (res2.action !== "card") return sources.length === 1 ? false : humanPassSwapFlow(p);
  doPassSwap(p, src, res2.cardId);
  return true;
}

// --- 空き地: 召喚（①停止マスの処理）。召喚したら true、パス/手札なしなら false ---
async function summonFlow(p, tile) {
  const creatures = p.hand.filter(id => CARD_BY_ID[id].type === "creature");
  let cardId = null;
  if (p.isCPU) {
    if (creatures.length === 0) return false;
    await sleep(CPU_WAIT);
    cardId = aiChooseSummon(G, p, tile);
  } else {
    if (creatures.length === 0) return false;
    const res = await showDialog({
      title: `${ELEMENTS[tile.element].icon} 空き地（${ELEMENTS[tile.element].name}属性${tile.level > 1 ? `・Lv${tile.level}` : ""}）`,
      body: `クリーチャーを召喚して土地を確保できます（魔力 ${p.magic}G）<br>属性が一致すると防衛時にHPボーナス` +
        (tile.level > 1 ? `<br><b>Lv${tile.level}の土地（価値${landValue(tile)}G）をそのまま入手！</b>` : ""),
      cards: creatures.map(id => ({ card: CARD_BY_ID[id], disabled: CARD_BY_ID[id].cost > p.magic })),
      peek: true,
      buttons: [{ label: "パス", value: "pass" }],
    });
    if (res.action === "card") cardId = res.cardId;
  }
  if (!cardId) return false;
  const c = CARD_BY_ID[cardId];
  // 魔力の最終チェック（コスト不足での召喚をどの経路からも通さない）
  if (c.cost > p.magic) {
    log(`⚠ 魔力が足りず${c.name}（${c.cost}G）は召喚できない（魔力 ${p.magic}G）`, "warn");
    return false;
  }
  p.magic -= c.cost;
  removeFromHand(p, cardId);
  tile.owner = p.id;
  tile.creature = { cardId, hp: c.hp };
  SFX.summon();
  log(`${p.name}は${c.name}を召喚し、${tileName(tile)}を確保した`);
  renderAll(G);
  return true;
}

// 土地の駐留クリーチャーを手札のクリーチャー(cardId)と交代する。
// 召喚コストを支払い、元のクリーチャーは手札に戻る。新クリーチャーはHP全快で駐留。
// 戻り値: 手札に戻った元カードid（呼び出し側でログ・手札上限処理を行う）
function swapCreatureOnTile(p, tile, cardId) {
  const c = CARD_BY_ID[cardId];
  p.magic -= c.cost;
  removeFromHand(p, cardId);
  const oldId = tile.creature.cardId;
  tile.creature = { cardId, hp: c.hp };
  p.hand.push(oldId);
  SFX.summon();
  return oldId;
}

// --- 自分の土地: レベルアップ or クリーチャー交代 or 駐留クリーチャーの侵攻（①停止マスの処理）。
//     実行したら true、パスなら false。到達した自領のクリーチャーにも命令（交代・侵攻）できる ---
async function ownLandFlow(p, tile) {
  const cost = levelUpCost(tile);
  const cur = CARD_BY_ID[tile.creature.cardId];
  const curHp = tile.creature.hp ?? cur.hp;
  // 到達マスの駐留クリーチャーをそのまま隣へ侵攻に出せるか（不動・費用不足・行き先なし・停戦協定中は不可）
  const canMarchHere = !cur.ab.includes("immobile") && !truceActive(G) &&
    (p.magic >= marchCost(cur) || p.freeMarch) && marchTargets(G, p, tile).length > 0;
  let decision = null; // { action: "up" } / { action: "swap", cardId } / { action: "march", dst? }

  if (p.isCPU) {
    await sleep(CPU_WAIT);
    decision = aiOwnLand(G, p, tile);
  } else {
    const creatures = p.hand.filter(id => CARD_BY_ID[id].type === "creature");
    const buttons = [];
    if (isFinite(cost) && cost <= p.magic) {
      buttons.push({ label: `⬆ レベルアップ（${cost}G）`, value: "up", primary: true });
    }
    if (canMarchHere) {
      buttons.push({ label: `🏇 ${cur.name}で侵攻（行軍費 ${marchCost(cur)}G）`, value: "march" });
    }
    buttons.push({ label: "パス", value: "pass" });
    const res = await showDialog({
      title: `${ELEMENTS[tile.element].icon} 自分の土地（Lv${tile.level}・${ELEMENTS[tile.element].name}属性）`,
      body: `駐留: ${ELEMENTS[cur.element].icon}${esc(cur.name)}（${ELEMENTS[cur.element].name}属性・ST${cur.st}/HP${curHp < cur.hp ? `${curHp}/${cur.hp}` : cur.hp}${elemNote(cur, tile)}）／ 魔力 ${p.magic}G<br>` +
        (isFinite(cost) ? `レベルアップ費用 ${cost}G（価値 ${landValue(tile)}G → ${LAND_VALUE[tile.level]}G）<br>` : "この土地は最大レベルです<br>") +
        (canMarchHere ? `🏇 <b>侵攻</b>：駐留クリーチャーを隣のマスへ進める（元の土地は空き地に戻る）<br>` : "") +
        (creatures.length ? `または手札のクリーチャーをクリックで<b>交代</b>（召喚コストを支払い、今のカードは手札に戻る。HPは全快で駐留）` : ""),
      cards: creatures.map(id => ({ card: CARD_BY_ID[id], disabled: CARD_BY_ID[id].cost > p.magic })),
      peek: true,
      buttons,
    });
    if (res.action === "up") decision = { action: "up" };
    else if (res.action === "march") decision = { action: "march" };
    else if (res.action === "card") decision = { action: "swap", cardId: res.cardId };
  }

  if (!decision) return false;
  if (decision.action === "up") {
    if (!isFinite(cost) || cost > p.magic) return false;
    p.magic -= cost;
    tile.level++;
    log(`${p.name}は${tileName(tile)}をLv${tile.level}に強化した（-${cost}G）`);
  } else if (decision.action === "swap") {
    const c = CARD_BY_ID[decision.cardId];
    if (c.cost > p.magic) {
      log(`⚠ 魔力が足りず交代できない（${c.name} ${c.cost}G／魔力 ${p.magic}G）`, "warn");
      return false;
    }
    const oldId = swapCreatureOnTile(p, tile, decision.cardId);
    log(`${p.name}は${tileName(tile)}の${CARD_BY_ID[oldId].name}を${c.name}に交代した（-${c.cost}G）`);
    await enforceHandLimit(p);
  } else if (decision.action === "march") {
    // 到達した自領のクリーチャーを隣へ侵攻（②のmarchと同じ処理。元の土地は空き地に戻る）
    let dst = decision.dst || null; // CPUは行き先まで決めてくる
    let itemId = null;
    if (!p.isCPU) {
      dst = await humanPickTileOnMap(marchTargets(G, p, tile), {
        title: `🏇 ${ELEMENTS[cur.element].icon}${cur.name}の侵攻先を選択（行軍費 ${marchCost(cur)}G）`,
        body: `空き地なら<b>無血占領</b>（土地レベルごと入手）。敵の土地なら<b>バトル</b>——勝てば制圧・引き分けなら撤退・負ければ消滅！<br>どの場合も出撃した${tileName(tile)}は空き地に戻ります（レベルは残る）`,
        cancelable: true,
        labelFn: t => {
          if (t.owner === null) return `${ELEMENTS[t.element].icon} ${tileName(t)}｜空き地 Lv${t.level}（無血占領）`;
          const d = CARD_BY_ID[t.creature.cardId];
          const dHp = t.creature.hp ?? d.hp;
          const sup = landSupportSt(G, t);
          return `${ELEMENTS[t.element].icon} ${tileName(t)}｜敵地 Lv${t.level}｜${ELEMENTS[d.element].icon}${d.name} ST${d.st}${sup ? `+${sup}` : ""}/HP${dHp < d.hp ? `${dHp}/${d.hp}` : d.hp}${landHpBonus(t, d) ? "+" + landHpBonus(t, d) : ""}`;
        },
      });
      if (!dst) return ownLandFlow(p, tile); // キャンセル→選択に戻る
      if (dst.owner !== null) {
        itemId = await humanPickBattleItem(p, marchCost(cur), `🏇 ${cur.name}にアイテムを装備しますか？`);
      }
    }
    if (!dst) return false;
    await doMarch(p, tile, dst, itemId);
  }
  renderAll(G);
  return true;
}

// --- 敵の土地: 通行料 or 侵略（①停止マスの処理）。侵略バトルをしたら true を返す ---
async function enemyLandFlow(p, tile) {
  const owner = G.players[tile.owner];
  const toll = tollOf(G, tile);
  const defCard = CARD_BY_ID[tile.creature.cardId];
  const defMaxHp = maxHpOf(tile.creature); // 🌱成長分を含めた実最大HP（v19）
  const curHp = tile.creature.hp ?? defMaxHp;
  const support = landSupportSt(G, tile);
  // 結界中・🏳️停戦協定（v20）中は侵略不可（通行料は発生）
  const protectedTile = isSanctuaryProtected(G, tile) || truceActive(G);
  let invade = null; // { cardId, itemId }

  if (p.isCPU) {
    await sleep(CPU_WAIT);
    invade = protectedTile ? null : aiChooseInvade(G, p, tile);
  } else {
    // 不動クリーチャーは侵略に出せない
    const creatures = protectedTile ? [] : p.hand.filter(id => {
      const c = CARD_BY_ID[id];
      return c.type === "creature" && !c.ab.includes("immobile");
    });
    // 属性4すくみの相性ヒント（v22）: 防衛クリーチャーに対して有利/不利になる属性を明示
    const strongVs = LAND_ELEMENTS.find(e => ELEM_ADVANTAGE[e] === defCard.element); // 防衛に有利を取れる属性
    const weakVs = ELEM_ADVANTAGE[defCard.element]; // 防衛が有利を取る＝送り込むと不利な属性
    const elemHint = defCard.element === "neutral"
      ? `<br>⚪ 相手は<b>無属性</b>＝相性の輪の外（どの属性でも有利・不利なし）`
      : `<br>⚖ 相性: ${ELEMENTS[strongVs].icon}<b>${ELEMENTS[strongVs].name}属性なら有利（ST+${ELEM_ADV_ST}）</b>／${ELEMENTS[weakVs].icon}${ELEMENTS[weakVs].name}属性は<b>不利</b>（相手にST+${ELEM_ADV_ST}）`;
    const res = await showDialog({
      title: `⚔ 敵の土地（${ELEMENTS[tile.element].name}属性 Lv${tile.level}）`,
      body: (protectedTile ? `<b>${truceActive(G) ? "🏳️ 停戦協定により侵略できません" : "🛡️ 結界に守られていて侵略できません"}</b><br>` : "") +
        `通行料 <b>${toll}G</b> を支払うか、クリーチャーで侵略します<br>` +
        `防衛: ${ELEMENTS[defCard.element].icon}${esc(defCard.name)}（${ELEMENTS[defCard.element].name}属性・ST${defCard.st}${support ? `+${support}(援護)` : ""}/HP${curHp < defMaxHp ? `${curHp}/${defMaxHp}` : defMaxHp}${landHpBonus(tile, defCard) ? `+${landHpBonus(tile, defCard)}(土地の加護)` : ""}）` +
        elemHint +
        (defCard.ab.length ? `<br>🔖 防衛能力: ${defCard.ab.map(a => ABILITY_INFO[a].name).join("・")}` : "") +
        (defCard.ab.includes("armor") ? `<br><b>⚠ 硬殻持ち</b>：受けるダメージが常に<b>-10</b>されます` : "") +
        (defCard.ab.includes("lastward") ? `<br><b>⚠ 背水持ち</b>：HPが半分以下になるとST+25で反撃してきます` : "") +
        (defCard.ab.includes("absorb") ? `<br><b>⚠ 吸収持ち</b>：与えたダメージの半分だけHPを回復します` : "") +
        (defCard.ab.includes("first") ? `<br><b>⚠ 先制持ち</b>：防衛側が<b>先に</b>攻撃します（HPの低い侵略側は返り討ちに注意）` : "") +
        (defCard.ab.includes("capture") ? `<br><b>⚠ 捕縛持ち</b>：侵略に失敗すると次のターン拘束されます` : "") +
        (defCard.ab.includes("physnull") ? `<br><b>⚠ 物理無効持ち</b>：<b>✨魔法攻撃</b>（魔法攻撃持ちクリーチャー／マジックワンド等の装備）以外ではダメージを与えられません` : "") +
        (defCard.ab.includes("physreflect") ? `<br><b>⚠ 物理反射持ち</b>：物理攻撃は<b>そっくり跳ね返されます</b>（✨魔法攻撃なら通る）` : "") +
        (defCard.ab.includes("mimic") ? `<br><b>⚠ 模倣持ち</b>：バトルであなたのクリーチャーの<b>基本ST・HP・能力を写し取って</b>戦います（送り込んだ強さがそのまま返ってくる）` : "") +
        `<br>侵略はコストのみ（勝てば通行料は不要）。ただし<b>敗れると通行料${toll}Gも徴収</b>され、カードも失います`,
      cards: creatures.map(id => {
        const c = CARD_BY_ID[id];
        // 各候補カードに相性リボン（⚡有利/⚠不利）を付けて一目で分かるように（v22）
        const rel = elemRelation(c.element, defCard.element);
        return {
          card: c, disabled: c.cost > p.magic,
          ribbon: rel === "adv" ? `⚡有利` : rel === "dis" ? `⚠不利` : "",
          ribbonCls: rel === "adv" ? "rib-adv" : rel === "dis" ? "rib-dis" : "",
        };
      }),
      peek: true,
      buttons: [{ label: `通行料を支払う（${toll}G）`, value: "pay", primary: true }],
    });
    if (res.action === "card") {
      const itemId = await humanPickBattleItem(p, CARD_BY_ID[res.cardId].cost,
        `⚔ ${CARD_BY_ID[res.cardId].name}にアイテムを装備しますか？`);
      invade = { cardId: res.cardId, itemId };
    }
  }

  if (invade) {
    const done = await doInvade(p, tile, invade.cardId, invade.itemId);
    if (done !== false) return true;
    // 魔力不足などで侵略が成立しなかった → 通行料の支払いへフォールバック
  }
  // 📜通行手形（v20）: 次に払う通行料1回が無料
  if (p.tollFree) {
    p.tollFree = false;
    log(`📜 ${p.name}は通行手形を差し出した——通行料${toll}Gは無料！`);
    renderAll(G);
    return false;
  }
  log(`${p.name}は通行料${toll}Gを${owner.name}に支払う`);
  await forcePay(G, p, toll, owner, log, landSellChooser(p)); // 払いきれなければ城で再起（敗北はしない）
  // 高額の通行料をせしめた相手キャラはほくそ笑む（存在感の演出）
  if (toll >= 150 && typeof cpuSay === "function") cpuSay(owner, "tollGain");
  renderAll(G);
  return false;
}

// 手札からバトル用アイテムを選ぶ（人間用）。ないなら聞かずに null。
// isDefense: 防衛側の応酬か（💨煙玉など防衛側専用アイテムは侵略側では選べない・v19）
async function humanPickBattleItem(p, committedCost, title, isDefense = false) {
  const budget = p.magic - committedCost;
  const items = p.hand.filter(id => CARD_BY_ID[id].type === "item");
  if (items.length === 0) return null;
  const res = await showDialog({
    title,
    body: `アイテムは使い切りです（残り魔力 ${budget}G）` +
      (isDefense && items.some(id => CARD_BY_ID[id].escape) ? "<br>💨 煙玉＝バトルせず土地を明け渡し、クリーチャーは手札へ退避" : ""),
    cards: items.map(id => ({ card: CARD_BY_ID[id], disabled: CARD_BY_ID[id].cost > budget || (!isDefense && !!CARD_BY_ID[id].escape) })),
    peek: true,
    buttons: [{ label: "装備しない", value: "no", primary: true }],
  });
  return res.action === "card" ? res.cardId : null;
}

// 防衛側のアイテム応酬 → バトル演出まで（結果の適用は呼び出し側）
// 通常の侵略もクリーチャー侵攻も同じ応酬を通る。
// battleOpts: { attGrown, attSrcId }＝march（盤上からの侵攻）時の成長段階・出撃元（v19）
async function fightFor(p, tile, attCard, attItem, battleOpts = {}) {
  const defender = G.players[tile.owner];
  let defItem = null;
  if (defender.isCPU) {
    const id = aiChooseDefenseItem(G, defender, tile, attCard, attItem);
    if (id) {
      defItem = CARD_BY_ID[id];
      defender.magic -= defItem.cost;
      discardFromHand(defender, id);
    }
  } else {
    const defCard = CARD_BY_ID[tile.creature.cardId];
    const itemId2 = await humanPickBattleItem(defender, 0,
      `🛡 防衛！ ${defCard.name}にアイテムを装備しますか？` +
      `（敵: ${attCard.name} ST${attCard.st + (attItem ? attItem.st : 0)}/HP${attCard.hp + (attItem ? attItem.hp : 0)}）`, true);
    if (itemId2) {
      defItem = CARD_BY_ID[itemId2];
      defender.magic -= defItem.cost;
      discardFromHand(defender, itemId2);
    }
  }

  // 💨煙玉（escape・v19）: 防衛側専用。バトルを行わず土地を明け渡し、クリーチャーは手札へ退避する
  if (defItem && defItem.escape) {
    const defCard = CARD_BY_ID[tile.creature.cardId];
    SFX.spell();
    log(`💨 ${defender.name}は煙玉を投げた！ ${defCard.name}は${tileName(tile)}を明け渡して手札へ退避（バトル不成立）`, "warn");
    return {
      escaped: true, attackerWins: true, log: [],
      attHp: attCard.hp + (battleOpts.attGrown || 0) * 5 + (attItem ? attItem.hp : 0),
      attExtra: attItem ? attItem.hp : 0, defHp: 0, defExtra: 0,
      attDrain: 0, defDrain: 0, attRebirth: false, defRebirth: false, defCapture: false,
    };
  }

  // バトル支援スペル（v20）: ウォークライ/決死の覚悟（攻守どちらでも）・攻城の号令（攻）・護りの風（守）。
  // このバトルで消費する（resolveBattleへoptsで渡す＝resolveBattle自体は状態非破壊のまま）
  const spellBuffs = {
    attStBonus: (p.nextBattleSt || 0) + (p.siegeSt || 0),
    defStBonus: defender.nextBattleSt || 0,
    defHpBonus: defender.nextDefHp || 0,
    attCritRate: p.nextBattleCrit || 0,
    defCritRate: defender.nextBattleCrit || 0,
  };
  p.nextBattleSt = 0; p.nextBattleCrit = 0;
  defender.nextBattleSt = 0; defender.nextDefHp = 0; defender.nextBattleCrit = 0;

  // バトル演出（結果は先に計算し、カットインで表示だけ流す。実戦は会心あり・土地の援護・群れあり）
  // ⏩スキップが押されたら残りのログを一括表示して即座に決着へ（UI.battleSkip）
  const result = resolveBattle(attCard, tile, attItem, defItem,
    { rng: true, g: G, attackerId: p.id, ...spellBuffs, ...battleOpts });
  openBattleView(G, p.name, attCard, attItem, tile, defItem);
  await sleep(600);
  await playBattleLines(result.log);
  // 吸奪武器（グリードファング＝drainMagic）: バトルで奪った魔力をここで実際に移動する
  // （resolveBattle は状態非破壊のため。相手の所持魔力が上限）
  if (result.attDrain) {
    const amt = Math.min(result.attDrain, defender.magic);
    defender.magic -= amt;
    p.magic += amt;
    if (amt < result.attDrain) log(`（${defender.name}の魔力が足りず、強奪は${amt}Gにとどまった）`, "warn");
    renderPanels(G);
  }
  if (result.defDrain) {
    const amt = Math.min(result.defDrain, p.magic);
    p.magic -= amt;
    defender.magic += amt;
    if (amt < result.defDrain) log(`（${p.name}の魔力が足りず、強奪は${amt}Gにとどまった）`, "warn");
    renderPanels(G);
  }
  await sleep(UI.battleSkip ? 250 : 900);
  closeBattleView();
  return result;
}

async function doInvade(p, tile, cardId, itemId = null) {
  const c = CARD_BY_ID[cardId];
  const attItem = itemId ? CARD_BY_ID[itemId] : null;
  // 魔力の最終チェック（コスト不足での侵略をどの経路からも通さない）
  const total = c.cost + (attItem ? attItem.cost : 0);
  if (total > p.magic) {
    log(`⚠ 魔力が足りず${c.name}での侵略はできない（必要 ${total}G／魔力 ${p.magic}G）`, "warn");
    return false;
  }
  p.magic -= c.cost + (attItem ? attItem.cost : 0);
  removeFromHand(p, cardId);
  if (itemId) discardFromHand(p, itemId);
  log(`⚔ ${p.name}は${c.name}で${tileName(tile)}に侵略開始！`, "battle");
  if (typeof cpuSay === "function") cpuSay(p, "invade");
  renderAll(G);

  const defender = G.players[tile.owner];
  const result = await fightFor(p, tile, c, attItem);
  // バトルの勝敗にキャラが反応する（攻守どちらのCPUも）
  if (typeof cpuSay === "function") {
    if (result.attackerWins) { cpuSay(p, "battleWin"); cpuSay(defender, "battleLose"); }
    else { cpuSay(defender, "battleWin"); cpuSay(p, "battleLose"); }
  }

  if (result.attackerWins) {
    // 倒された防衛クリーチャー: 💨煙玉で退避／🔁転生なら手札へ、通常は捨札へ（v19）
    if (result.escaped || result.defRebirth) {
      defender.hand.push(tile.creature.cardId);
      if (result.defRebirth) log(`🔁 ${CARD_BY_ID[tile.creature.cardId].name}の転生！ 倒れても${defender.name}の手札に戻った`);
      await enforceHandLimit(defender);
    } else {
      defender.discard.push(tile.creature.cardId);
    }
    tile.owner = p.id;
    tile.creature = { cardId, hp: woundedHp(result.attHp, result.attExtra, c.hp) }; // 戦闘後HP残量で駐留
    grantWarfire(p); // 🔥狼煙台（戦意）: 侵略勝利ボーナス（v19）
  } else {
    // 侵略失敗したクリーチャー: 🔁転生なら手札に戻る（v19）
    if (result.attRebirth) {
      p.hand.push(cardId);
      log(`🔁 ${c.name}の転生！ 倒れても${p.name}の手札に戻った`);
      await enforceHandLimit(p);
    } else {
      p.discard.push(cardId);
    }
    const dc = CARD_BY_ID[tile.creature.cardId]; // 撃退した防衛側
    tile.creature.hp = woundedHp(result.defHp, result.defExtra, maxHpOf(tile.creature));
    if (result.defCapture) { // チェインネット等アイテム由来の捕縛も含む実効判定（v19）
      p.skipTurn = true;
      p.skipReason = "capture";
      log(`🕸️ ${dc.name}の捕縛！ ${p.name}は次のターン動けない`, "warn");
    }
    // 侵略に失敗＝その敵地に留まったまま。踏み倒しにならないよう通行料を徴収する
    // （足止めの罠で止められた末に侵略して敗れた場合も同じく徴収される）
    const toll = tollOf(G, tile);
    if (toll > 0) {
      log(`${p.name}は侵略に失敗し、通行料${toll}Gを${defender.name}に支払う`, "warn");
      await forcePay(G, p, toll, defender, log, landSellChooser(p)); // 払いきれなければ城で再起
      renderAll(G);
    }
  }
  renderAll(G);
}

// 🔥狼煙台（戦意・v19）: 自軍が侵略・侵攻のバトルに勝つたび、所有する狼煙台1つにつき+40G
function grantWarfire(p) {
  const towers = ownedLands(G, p.id).filter(t =>
    t.creature && CARD_BY_ID[t.creature.cardId].ab.includes("warfire")).length;
  if (towers === 0) return;
  const gain = towers * 40;
  p.magic += gain;
  SFX.coin();
  log(`🔥 狼煙が上がる！ 戦勝の報せで${p.name}は+${gain}G`);
}

// ---------- クリーチャー侵攻（march） ----------
// 停止マスのアクションを放棄し、このターン通過した自軍クリーチャーを隣のマスへ進める。
// 空き地なら無血占領、敵地ならバトル（負ければクリーチャー消滅）。どちらも元の土地は空き地に戻る。
// 自分のコマが止まったわけではないので通行料は発生しない。

// 人間用: 出撃元 → 行き先を選んで実行。キャンセルなら false（元のマスのアクションへ戻る）
async function humanMarchFlow(p) {
  const sources = marchSources(G, p);
  if (sources.length === 0) return false;
  // 1. 出撃元の選択（盤面からも選べる）
  let src;
  if (sources.length === 1) {
    src = sources[0];
  } else {
    src = await humanPickTileOnMap(sources, {
      title: "🏇 クリーチャー侵攻 — 出撃元を選択",
      body: "このターンに通過した自分のクリーチャーを、隣のマスへ進められます（行軍費を支払う。元の土地は空き地に戻る）",
      cancelable: true,
      labelFn: t => { const c = CARD_BY_ID[t.creature.cardId]; return `${ELEMENTS[t.element].icon} ${tileName(t)}｜${ELEMENTS[c.element].icon}${c.name}（行軍費 ${marchCost(c)}G）`; },
    });
    if (!src) return false;
  }
  const card = CARD_BY_ID[src.creature.cardId];
  // 2. 行き先の選択（盤面からも選べる）
  const targets = marchTargets(G, p, src);
  const dst = await humanPickTileOnMap(targets, {
    title: `🏇 ${ELEMENTS[card.element].icon}${card.name}の侵攻先を選択（行軍費 ${marchCost(card)}G）`,
    body: `空き地なら<b>無血占領</b>（土地レベルごと入手）。敵の土地なら<b>バトル</b>——勝てば制圧・引き分けなら元の土地へ撤退・負ければ${esc(card.name)}は消滅（元の土地も失う）！<br>占領・消滅した場合、元の${tileName(src)}は空き地に戻ります（レベルは残る）`,
    cancelable: true,
    labelFn: t => {
      let info;
      if (t.owner === null) info = `空き地 Lv${t.level}（無血占領）`;
      else {
        const d = CARD_BY_ID[t.creature.cardId];
        const dHp = t.creature.hp ?? d.hp;
        const sup = landSupportSt(G, t);
        info = `敵地 Lv${t.level}｜${ELEMENTS[d.element].icon}${d.name} ST${d.st}${sup ? `+${sup}` : ""}/HP${dHp < d.hp ? `${dHp}/${d.hp}` : d.hp}${landHpBonus(t, d) ? "+" + landHpBonus(t, d) : ""}`;
      }
      return `${ELEMENTS[t.element].icon} ${tileName(t)}｜${info}`;
    },
  });
  if (!dst) return sources.length === 1 ? false : humanMarchFlow(p);
  // 3. 敵地ならアイテム装備を確認
  let itemId = null;
  if (dst.owner !== null) {
    itemId = await humanPickBattleItem(p, marchCost(card), `🏇 ${card.name}にアイテムを装備しますか？`);
  }
  await doMarch(p, src, dst, itemId);
  return true;
}

async function doMarch(p, src, dst, itemId = null) {
  const card = CARD_BY_ID[src.creature.cardId];
  // 🎺進軍号令（v20・freeMarch）: このターンの侵攻は行軍費なし
  const cost = p.freeMarch ? 0 : marchCost(card);
  if (p.freeMarch) p.freeMarch = false;
  // 魔力の最終チェック（行軍費＋アイテム費が払えなければ侵攻不可）
  const item = itemId ? CARD_BY_ID[itemId] : null;
  if (cost + (item ? item.cost : 0) > p.magic) {
    log(`⚠ 魔力が足りず${card.name}は侵攻できない（必要 ${cost + (item ? item.cost : 0)}G／魔力 ${p.magic}G）`, "warn");
    return false;
  }
  p.magic -= cost;
  SFX.dice();
  log(`🏇 ${p.name}の${card.name}が${tileName(src)}から${tileName(dst)}へ侵攻！（${cost > 0 ? `行軍費 -${cost}G` : "🎺進軍号令＝行軍費なし"}）`, "battle");
  renderAll(G);

  // 🫧 分裂（v24・split）: 侵攻で移動先を占領できたとき、元の土地にも分裂体が残る（HPは折半・切り上げ）
  // ＝元の土地は自領のまま「元と移動先」の2体に増える。無力化の霧（nulled）中は発動しない
  const trySplit = () => {
    if (!card.ab.includes("split") || creatureNulled(G, dst.creature)) return false;
    const half = Math.max(1, Math.ceil(currentHp(dst.creature) / 2));
    dst.creature.hp = half;
    src.owner = p.id;
    src.creature = { cardId: card.id, hp: half };
    SFX.summon();
    log(`🫧 ${card.name}の分裂！ ${tileName(src)}にも分裂体が残った（HPは${half}ずつに折半）`, "battle");
    return true;
  };

  if (dst.owner === null) {
    // 無血占領: クリーチャーごと領地が移る
    dst.owner = p.id;
    dst.creature = src.creature;
    src.owner = null;
    src.creature = null;
    SFX.summon();
    if (!trySplit()) log(`🏇 ${card.name}は${tileName(dst)}を無血占領した！ 元の土地は空き地に戻った`);
    else log(`🏇 ${card.name}は${tileName(dst)}を無血占領した！`);
  } else {
    // 敵地: 通常侵略と同じアイテム応酬つきバトル
    const attItem = itemId ? CARD_BY_ID[itemId] : null;
    if (attItem) {
      p.magic -= attItem.cost;
      discardFromHand(p, itemId);
    }
    const defender = G.players[dst.owner];
    // march は盤上のクリーチャーの出撃＝🌱成長段階・無力化・出撃元（群れの自己除外）をバトルへ引き継ぐ（v19/v20）
    const result = await fightFor(p, dst, card, attItem, {
      attGrown: Math.min(5, src.creature.grown || 0),
      attSrcId: src.id,
      attNulled: creatureNulled(G, src.creature),
    });
    if (result.attackerWins) {
      // 勝ち: 占領。侵攻側は傷を持ち越して移動。元の土地は空き地に戻る
      if (result.escaped || result.defRebirth) { // 💨煙玉・🔁転生（v19）: 防衛側は手札へ
        defender.hand.push(dst.creature.cardId);
        if (result.defRebirth) log(`🔁 ${CARD_BY_ID[dst.creature.cardId].name}の転生！ 倒れても${defender.name}の手札に戻った`);
        await enforceHandLimit(defender);
      } else {
        defender.discard.push(dst.creature.cardId);
      }
      src.creature.hp = woundedHp(result.attHp, result.attExtra, maxHpOf(src.creature));
      dst.owner = p.id;
      dst.creature = src.creature; // 成長段階（grown）ごと移動
      src.owner = null;
      src.creature = null;
      log(`🏇 ${card.name}は${tileName(dst)}を制圧した！`, "battle");
      trySplit(); // 🫧分裂: 制圧に成功したら元の土地にも分裂体が残る（v24）
      grantWarfire(p); // 🔥狼煙台（戦意）: 侵攻勝利ボーナス（v19）
    } else if (result.attHp > 0) {
      // 引き分け・両者生存: 侵攻側は傷を負って元の領地へ撤退。領地の変動なし
      src.creature.hp = woundedHp(result.attHp, result.attExtra, maxHpOf(src.creature));
      const dc = CARD_BY_ID[dst.creature.cardId];
      dst.creature.hp = woundedHp(result.defHp, result.defExtra, maxHpOf(dst.creature));
      if (result.defCapture) {
        p.skipTurn = true;
        p.skipReason = "capture"; // v13: skipReason 未設定だとメッセージの出し分けが崩れるため必ずセット
        log(`🕸️ ${dc.name}の捕縛！ ${p.name}は次のターン動けない`, "warn");
      }
      log(`🏇 ${card.name}は攻めきれず${tileName(src)}へ撤退した（傷を負って帰還）`, "warn");
    } else {
      // 負け（討ち死に）: 侵攻側は消滅し、元の土地も失う（🔁転生なら手札に戻る・v19）
      const dc = CARD_BY_ID[dst.creature.cardId];
      dst.creature.hp = woundedHp(result.defHp, result.defExtra, maxHpOf(dst.creature));
      if (result.defCapture) {
        p.skipTurn = true;
        p.skipReason = "capture"; // v13: skipReason 未設定だとメッセージの出し分けが崩れるため必ずセット
        log(`🕸️ ${dc.name}の捕縛！ ${p.name}は次のターン動けない`, "warn");
      }
      if (result.attRebirth) {
        p.hand.push(src.creature.cardId);
        log(`🔁 ${card.name}の転生！ 倒れても${p.name}の手札に戻った（元の土地は失う）`);
        await enforceHandLimit(p);
      } else {
        p.discard.push(src.creature.cardId);
      }
      src.owner = null;
      src.creature = null;
      log(`🏇 ${card.name}は敗れて${result.attRebirth ? "手札へ退いた" : "消滅"}… 元の土地も失った`, "warn");
    }
  }
  renderAll(G);
}

// ---------- 盤面のマス情報（クリックで確認） ----------
// 盤面のマスをクリックすると、そのマスの情報——特に領地に駐留する敵クリーチャーの
// 能力・現在HP・実効防衛値（援護/土地の加護/守護）——を確認できる（v13）。
// passive:true の受け身ダイアログなので、ゲーム進行側のダイアログが開くときは自動で閉じられる。
function showTileInfo(tile) {
  const parts = [];
  let cards = null;
  if (tile.type === "LAND") {
    const ownerTxt = tile.owner === null ? "空き地"
      : `<b style="color:${PLAYER_COLORS[tile.owner]}">${P_ICONS[tile.owner]} ${esc(G.players[tile.owner].name)}の領地</b>`;
    parts.push(`${ELEMENTS[tile.element].icon} ${ELEMENTS[tile.element].name}属性 ／ Lv${tile.level} ／ 価値 ${landValue(tile)}G ／ ${ownerTxt}`);
    if (tile.owner !== null) {
      parts.push(`通行料 <b>${tollOf(G, tile)}G</b>（${ELEMENTS[tile.element].icon}連鎖 ${chainCount(G, tile.owner, tile.element)}）`);
    }
    if (tile.creature) {
      const c = CARD_BY_ID[tile.creature.cardId];
      const cur = currentHp(tile.creature);
      const mx = maxHpOf(tile.creature); // 🌱成長分を含めた実最大HP（v19）
      const sup = landSupportSt(G, tile);
      const bonus = landHpBonus(tile, c);
      const grown = c.ab.includes("grow") ? Math.min(5, tile.creature.grown || 0) : 0;
      parts.push(`駐留: ${ELEMENTS[c.element].icon}${esc(c.name)}${elemNote(c, tile)}${grown ? `　🌱成長+${grown * 5}` : ""}<br>` +
        `実効防衛値: ST ${c.st + grown * 5}${sup ? `+${sup}(援護)` : ""} ／ HP ${cur < mx ? `${cur}/${mx}` : mx}` +
        `${bonus ? `+${bonus}(土地の加護)` : ""}${c.ab.includes("guard") ? "+20(守護)" : ""}`);
      if (c.ab.length) {
        parts.push(c.ab.map(a => `🔖 <b>${ABILITY_INFO[a].name}</b>：${ABILITY_INFO[a].desc}`).join("<br>"));
      }
      cards = [{ card: c }];
    }
    const ov = overlayOf(G, tile);
    if (ov) parts.push(ov.kind === "sanctuary"
      ? `🛡️ 結界に守られている（侵略・侵攻・敵スペルの対象にならない）`
      : `🕸️ 罠が仕掛けられている（術者以外が通過・停止すると足止め）`);
  } else {
    const descs = {
      CASTLE: "🏰 城 — 関門を規定数そろえて通過・停止すると周回ボーナス（魔力＋全回復）。ぴったり停止で領地コントロール。目標資産で帰還すれば勝利！",
      GATE:   `⛩️ 関門 — 通過で+${RULES.gateBonus}G。規定数そろえて城へ戻ると周回ボーナス`,
      CARD:   "🎴 カードマス — 止まるとカードを1枚引く",
      MAGIC:  `💎 魔力マス — 止まると+${RULES.magicTileG}G`,
      WARP:   "🌀 ワープマス — 止まると対のマスへ移動する",
      MAGMA:  `🌋 マグママス — 止まると魔力を失う（-${RULES.magmaLoss}G）`,
      BOOST:  "💨 疾風マス — 止まるとさらに2マス進む",
      FORTUNE: "🎰 運命マス — 止まるとルーレット！ 大当り+300G／+150G／2枚ドロー／次のダイス2倍／🌀時空の渦（進行方向が反転）／はずれ-100G のどれかが起きる",
      SPRING: "⛲ 泉マス — 止まると自軍クリーチャーのHPが全回復＋60G",
    };
    parts.push(descs[tile.type] || "");
  }
  return showDialog({
    // LANDのtileNameは既に「#id」を含むので、非LANDのときだけ#idを前置する
    title: `🔍 ${tile.type === "LAND" ? tileName(tile) : `#${tile.id} ${tileName(tile)}`}`,
    body: parts.join("<br>"),
    cards,
    passive: true, // ゲーム進行のダイアログが開くときは自動で閉じてよい（情報表示のみ）
    buttons: [{ label: "閉じる", value: "close", primary: true }],
  });
}

// ---------- 🎁 シールド戦の開始フロー（v21） ----------
// ステージ決定後: 確認 → 第一弾5＋第二弾5パックをその場で開封 → プールから30枚を構築 → 開戦。
// 開封プールはコレクションに加算しない（使い捨て）。構築を「やめる」とプールごと破棄して false を返す
async function startSealed(stageIdx) {
  const stage = STAGES[stageIdx];
  const ok = await showDialog({
    title: `🎁 シールド戦 — ${stage.icon} ${esc(stage.name)}`,
    body: `その場で<b>第一弾${SEALED_PACKS_PER_SET}パック＋第二弾${SEALED_PACKS_PER_SET}パック（計${SEALED_PACKS_PER_SET * SEALED_PACK_SIZE * 2}枚）</b>を開封し、
      出たカードだけで<b>${DECK_SIZE}枚デッキ</b>を組んで <b>${esc(stage.cpuName)}</b> に挑みます。<br><br>
      ⚠ 開封したカードは<b>この1戦だけの使い捨て</b>です（コレクションには入りません）。<br>
      🏆 勝てば通常どおり<b>勝利報酬パック（${REWARD_WIN}枚）</b>を獲得できます（こちらはコレクションに入ります）。`,
    buttons: [
      { label: "🎁 パックを開封する", value: "open", primary: true },
      { label: "やめる", value: "cancel" },
    ],
  });
  if (ok.action !== "open") return false;
  const pool = drawSealedPool();
  await showPackReveal(pool.set1, `🎁 シールド戦 — ✦第一弾パック×${SEALED_PACKS_PER_SET}`,
    `第一弾のカード${pool.set1.length}枚を開封！（プールは使い捨て・コレクションには入りません）`, { noNew: true });
  await showPackReveal(pool.set2, `🎁 シールド戦 — ⏳第二弾パック×${SEALED_PACKS_PER_SET}`,
    `第二弾のカード${pool.set2.length}枚を開封！ ここから${DECK_SIZE}枚のデッキを組もう`, { noNew: true });
  const deck = await showSealedBuilder(pool.pool);
  if (!deck) return false;
  startGame(stageIdx, { sealed: true, sealedDeck: deck });
  return true;
}

// ---------- タイトル（ステージ選択）画面 ----------
async function titleScreen() {
  document.body.classList.remove("in-game"); // タイトルでは固定ウィンドウを隠す
  document.body.style.background = ""; // ステージのテーマ背景を解除して既定に戻す
  showSurrenderButton(false);
  while (true) {
    const res = await showStageSelect();
    if (res === "help") { await showHelp(); continue; }
    if (res === "profile") { await showProfilePicker(); continue; }
    if (res === "album") { await showAlbum(); continue; }
    if (res === "deck") { await showDeckBuilder(); continue; }
    if (res === "difficulty") { await showDifficultyPicker(); continue; }
    if (res === "matchlen") { await showMatchLengthPicker(); continue; }
    if (res === "workshop") { await showWorkshop(); continue; }
    if (res === "weekly") { await showWeeklyDialog(); continue; }
    if (res === "royale") {
      // ⚔ 三つ巴（人間1 + CPU2）: 全ステージから盤面を選ぶ。乱入者は対戦ごとにランダム
      while (true) {
        const t = await showStageSelect({ royale: true });
        if (typeof t === "number") { startGame(t, { royale: true }); return; }
        if (t === "difficulty") { await showDifficultyPicker(); continue; }
        break; // "back"
      }
      continue;
    }
    if (res === "sealed") {
      // 🎁 シールド戦: 全ステージから盤面を選ぶ → その場でパック開封 → プールから構築 → 1戦
      while (true) {
        const t = await showStageSelect({ sealed: true });
        if (typeof t === "number") { if (await startSealed(t)) return; continue; }
        if (t === "difficulty") { await showDifficultyPicker(); continue; }
        break; // "back"
      }
      continue;
    }
    if (res === "versus") {
      // 2人対戦（ホットシート）: 2人のプロファイルを選ぶ → 全ステージからステージを選ぶ
      const setup = await showVersusSetup();
      if (!setup) continue;
      const names = [profileName(setup.p0), profileName(setup.p1)];
      const t = await showStageSelect({ versus: { names } });
      if (typeof t === "number") { startGame(t, { versus: setup }); return; }
      continue; // "back"
    }
    if (res === "training") {
      while (true) {
        const t = await showStageSelect({ training: true });
        if (typeof t === "number") { startGame(t, { training: true }); return; }
        if (t === "difficulty") { await showDifficultyPicker(); continue; }
        break; // "back"
      }
      continue;
    }
    startGame(res); // ステージ index（数値）
    return;
  }
}

// ---------- 遊び方ヘルプ ----------
// passive:true（v23）: 三つ巴では閲覧中もCPUの手番が進み、防衛アイテム選択などの進行ダイアログが
// 割り込むことがある。受け身登録が無いと上書きされて dialogBusy が1のまま残り、以後ヘルプ/捨札/
// マス情報が二度と開けなくなる（捨て札ビューアと同型の袋小路）
function showHelp() {
  return showDialog({
    passive: true,
    title: "❓ 遊び方",
    body: `
      <b>勝利条件</b>: 総資産（魔力＋土地価値）がステージの目標に達した状態で🏰城に到達（凱旋）する。
      目標に達すると<b>⚑凱旋リーチ</b>が表示される。ラウンド上限で決着しない場合は総資産の多い方が勝ち。<br>
      <b>💸 魔力が尽きても敗北にはならない</b>: 支払いきれないときは土地を売却し、それでも足りなければ
      持てる魔力を全て渡して<b>🏰城へ帰還し、初期魔力で再スタート</b>する（相手を身ぐるみ剥いでも決着はつかない——勝つには自分が凱旋するしかない）。<br>
      <b>⏱ 決着モード</b>: タイトルの「⏱ 決着」で<b>短期戦／標準／長期戦／大戦</b>を選べる。目標資産とラウンド上限が変わり、対戦の長さを好みに調整できる。<br>
      <b>🎁 シールド戦</b>: その場で開封した<b>第一弾5＋第二弾5パック（計50枚）</b>だけで30枚デッキを組んで1戦する特別モード。
      開封プールは<b>使い捨て</b>（コレクションには入らない）なので、コレクションの厚さに関係なく誰でも対等に遊べる。勝てば通常の勝利報酬あり（進行度は変化しない）。<br><br>
      <b>ターンの流れ</b>: カードを1枚引く → （任意で手札のスペルをクリックして使用・1回まで）→ 🎲ダイスで移動<br>
      <b>🧭 移動は進行方向へ（v24）</b>: コマは<b>今の進行方向を保って</b>進む＝<b>逆走はできない</b>。
      分かれ道・交差点では背後以外の<b>行く手を選べる</b>（ルートプレビュー付きダイアログ）。
      ゲーム開始直後・💫テレポート・🌀ワープ・城への帰還などの直後は方向が未確定＝どの方向へも出発できる。<br>
      <b>🔄 逆方向へ進むには</b>: <b>時流逆転</b>（スペル。自分に使えば来た道を戻れる／相手に使えば高額地帯へ押し返せる）か、
      🎰運命マスの<b>時空の渦</b>（イベント）で進行方向が反転したときだけ。相手から強制的に反転させられることもある。<br>
      <b>➡ 一方通行マス</b>: 大きな矢印が明滅しているマスは<b>矢印の方向へしか進めない特別マス</b>（出口側から入ることもできない）。
      S10の地獄回廊・S14の歯車道など、盤面の見どころとして残る唯一の方向制限。<br><br>
      <b>マスに止まったとき — このターンの「能動的な行動」は合計1回だけ（その発動場所が①到達マスか②通過マスに変わる）</b><br>
      <b>① 到着マスのイベント</b>: 空き地は召喚、自分の土地はレベルアップ／交代、
      敵の土地は<b>通行料の支払い or クリーチャーで侵略（バトル）</b>のどちらか。
      <b>侵略に勝てば土地を奪取し通行料は不要。ただし侵略に敗れると、その土地に留まった扱いで通行料も徴収される</b>
      （足止めの罠で止められて侵略に敗れた場合も同じ）。
      関門・魔力・城・カードなどのマスは受け身のイベントだけが起きる。<br>
      <b>② 通過アクション（①で能動行動しなかったターンだけ・1つ）</b>: <b>①で能動的な行動（召喚・レベルアップ・交代・侵攻・侵略）をしなかった</b>ターンに限り、
      このターンに<b>通過した</b>自分の領地について次のどれか1つを行える。<br>
      <b>＝そのターンの能動行動は1回まで。①で行動すれば②は無し。①が受け身マス／通行料のみ／パス／召喚できる手札が無い場合に、権利が②へ回る</b>（実際に選べる項目だけボタンが出る）。<br>
      ・<b>クリーチャー侵攻</b> … 通過した自分のクリーチャーを隣のマスへ進める（行軍費を支払う）。
        空き地なら無血占領、敵地ならバトル（勝てば制圧／引き分けなら元の土地へ撤退／負ければ消滅し元の土地も失う）<br>
      ・<b>クリーチャー交代</b> … 通過した自分の土地の駐留クリーチャーを、手札のクリーチャーと入れ替える（召喚コストを支払う）<br>
      ・<b>通過地レベルアップ</b> … 通過した自分の土地を1つレベルアップする<br>
      ※<b>自分の土地に到達</b>したときは、①でレベルアップ・交代に加えて<b>駐留クリーチャーの侵攻</b>も選べる。<br>
      ※<b>出発マス（ターン開始時にいたマス）は②の対象外</b>（前のターンの到達アクションで命令できたため）。<br>
      ※領地・クリーチャーの選択では、盤面の各マスに振られた<b>#番号</b>で選択肢とマスが対応します。<b>「👁 盤面から選ぶ」</b>で盤面を表示し、<b>光っているマスを直接クリック</b>しても選べます。<br>
      ※選択中でないときに<b>盤面のマスをクリック</b>すると、そのマスの情報——<b>駐留クリーチャーの能力・現在HP・実効防衛値（援護/土地の加護/守護）・通行料</b>——を確認できます（敵の領地もOK）。<br>
      ※自分のターンで🎲を振る前は、ヘッダーの<b>🏳 投了</b>でゲームを中断できます。<br><br>
      <b>🏰 土地の援護</b>: 防衛クリーチャーは、隣接する自分の土地1つにつき<b>ST+10</b>（最大+40）。
      十字や固まった領地ほど守りが固くなる。<br>
      <b>🩹 戦闘後のHP</b>: バトル後のクリーチャーは<b>残りHPのまま</b>駐留し、傷を引き継ぐ。
      <b>周回達成（関門を揃えて城を通過・停止）で自軍クリーチャーのHPが全回復</b>（負傷は💚リジェネでも回復可）。<br><br>
      <b>盤面エフェクト</b>（スペル枠で発動・2ラウンドで消える）<br>
      ・🛡️ サンクチュアリ … 自分の土地に結界。侵略・侵攻・敵スペルの対象にならない<br>
      ・🕸️ スネアトラップ … 土地に罠。相手が通過・停止するとその場で足止め（移動終了）<br>
      ・🚧 バリケード … 土地1つを通行止めに。全プレイヤー（自分も含む）が進入できず<b>迂回を強いられる</b>（全方向を塞がれたコマは例外的に通れる）<br>
      ・💚 リジェネ … 負傷した自分のクリーチャー1体のHPを全回復（周回を待たず立て直せる）<br>
      ・✨ 引き直し … 手札をすべて捨てて新たに6枚引く（手札事故のリセット）<br><br>
      <b>マスの種類</b><br>
      ・空き地 … クリーチャーを召喚して土地を確保（コスト支払い）<br>
      ・自分の土地 … 土地レベルアップ、またはクリーチャーを手札と<b>交代</b>できる<br>
      ・敵の土地 … 通行料を支払う or クリーチャーで侵略バトル<br>
      ・🎴カード＝1枚ドロー ／ 💎魔力＝魔力ゲット ／ ⛩️関門＝通過でボーナス<br>
      ・🌀ワープ＝対のマスへ移動 ／ 🌋マグマ＝魔力を失う ／ 💨疾風＝さらに2マス進む<br>
      ・🎰<b>運命</b>＝ルーレット（大当り+300G／+150G／2枚ドロー／次のダイス2倍／🌀時空の渦＝進行方向が反転／はずれ-100G） ／
      ⛲<b>泉</b>＝自軍クリーチャー全回復＋60G<br><br>
      <b>連鎖</b>: 同じ属性の土地を複数持つと通行料が倍増（2つ→×1.5、3つ→×2.0、4つ以上→×2.5）<br>
      <b>周回</b>: 関門を規定数そろえて城を<b>通過または停止</b>すると<b>周回ボーナス＝魔力（基本${DEFAULT_RULES.lapBase}G＋所有土地×40G）＋自軍クリーチャーHP全回復</b>。大きく劣勢のときは魔力<b>1.5倍</b>！<br>
      <b>🏰 領地コントロール</b>: 城にコマが<b>ぴったり停止（通過ではなく丁度）</b>すると、周回に関係なく<b>支配する全領地を対象に1回だけ行動</b>できる（侵攻／交代／レベルアップ）。
      ダイスでぴったり止まれない時は<b>✨リコール</b>で城へ帰ればこの権利が得られる（＝リコールの使いどころ）。<br><br>
      <b>属性相性</b>: 🔥火 → 🌳木 → ⛰️地 → 💧水 → 🔥火（左が右に強い・<b>4すくみ</b>／＝水＞火＞木＞地＞水）。バトルで有利属性はST+${ELEM_ADV_ST}。
      <b>バトル開始時のカットインに⚡有利/⚠不利のバッジと相性の輪が表示</b>され、侵略時のクリーチャー選択でも各カードに⚡/⚠リボンが付く<br>
      <b>⚪ 無属性クリーチャー</b>: 相性の輪の<b>外</b>＝有利も不利も取らず、<b>土地の加護（属性一致HP+）も受けない</b>。
      そのぶんコスト効率が高く、全員レア以上でユニークな能力を持つ（どの土地に置いても同じ強さ）。<br>
      <b>バトル</b>: 侵略側が先攻（防衛側が<b>先制</b>持ちなら防衛が先攻）。土地と同属性の防衛側はHP+（土地Lv×10）。
      各攻撃は低確率で<b>💫会心の一撃</b>（ダメージ1.5倍）！ バトルログには<b>📊【式】</b>で実効ST/HPの内訳と必要手数が残るので、勝敗の計算を確認できる。<br>
      <span class="ab">先制</span>防衛でも先に攻撃 ／ <span class="ab">貫通</span>土地HPボーナス無視 ／
      <span class="ab">強襲</span>侵略時ST+20 ／ <span class="ab">守護</span>防衛時HP+20 ／
      <span class="ab">豪運</span>会心率アップ ／ <span class="ab">捕縛</span>撃退した侵略者を1ターン拘束 ／
      <span class="ab">不動</span>侵略・侵攻に出せない防御専用 ／
      <span class="ab">護法</span>敵の対象指定スペル（メテオ・バニッシュ・ガスト）の対象にならない ／
      <span class="ab">連撃</span>バトルで続けて2回攻撃する ／
      <span class="ab">物理無効</span>物理攻撃（魔法以外）が効かない ／
      <span class="ab">物理反射</span>物理攻撃をそっくり攻撃側へ跳ね返す ／
      <span class="ab">魔法攻撃</span>攻撃が魔法＝物理無効・物理反射を貫く ／
      <span class="ab">模倣</span>バトル時、相手の基本ST・HP・能力をそっくり写し取って戦う（ドッペルゲンガー）<br>
      ※無属性の<b>ファントム（物理無効）・ミラージュ（物理反射）</b>には通常の攻撃が通らない。対策は
      <b>✨魔法攻撃</b>（魔法攻撃持ちクリーチャー or マジックワンド等の装備）か、除去スペル（☄️メテオ等）。そのぶん両者ともHPは低い。<br><br>
      <b>アイテム</b>: バトル時に⚔️武器（ST+）や🛡️防具（HP+）を装備できる（使い切り）。防衛側も応戦可能。<br>
      ・🚫 <b>ディスペルワード</b> … 相手のアイテム効果を打ち消す ／ 🪞 <b>ミラーシールド</b> … 受けた攻撃の一部を反射<br>
      ・✨ <b>マジックワンド／アルカナロッド</b> … 武器よりST補正は控えめだが<b>攻撃が魔法になる</b>＝物理無効・物理反射を貫く（防衛時の反撃にも有効）<br>
      ・💰 <b>グリードファング</b> … ST+25の吸奪武器。<b>与えたダメージ×2倍の魔力を相手から強奪</b>する（攻撃が通らなければ強奪もなし）<br>
      <b>逆転のスペル</b>: リベンジ（劣勢時に資産を奪う）、リコール（城へ帰還。達成で勝利、領地コントロール発動、関門が揃えば周回ボーナスも）、
      💰 <b>プランダー</b>（相手の所持金の半分を奪う）、🎲 <b>ダイスブースト</b>（次の出目を2倍）など<br>
      <b>除去・妨害スペル</b>: ☄️ <b>メテオ</b>（安価・敵1体に40ダメージ＝削り／削り切れば破壊）、
      ✨ <b>バニッシュ</b>（高価・レジェンド／敵1体を<b>HP不問で確実に消滅</b>）、
      🌬️ <b>ガスト</b>（敵クリーチャーを隣の空き地へ<b>強制移動</b>＝連鎖崩し・防衛どかし）<br>
      <b>資金スペル</b>: ⚗️ <b>アルケミー</b>（手札1枚を捨てて120Gに変える＝使わないカードを資金化）<br>
      <b>移動スペル</b>: 💫 <b>テレポート</b>（自分のコマを好きなマスへ飛ばす。城以外・マスの効果や関門通過は発生せず、その後ダイスで移動）、
      🚪 <b>トランスポート</b>（自分のクリーチャーを好きな<b>空き地</b>へ転送＝連鎖の組み替え・遠征）、
      🐇 <b>リープ</b>（自分のクリーチャーを<b>2マス先</b>の空き地へ跳躍）。どちらも元の土地は空き地に戻る（レベルは残る・不動は対象外）<br>
      <b>🗑 捨札の確認</b>: ヘッダーの<b>🗑 捨札</b>で全員の捨てカードを<b>プレイヤーのタブ切替</b>で確認できる。<b>山札が尽きると捨札を切り直して山札に戻り</b>、ログ（📜）で「🔀」と合図する。<br>
      <b>⚙ 難易度</b>: タイトル画面で<b>イージー／ノーマル／ハード</b>を選べる。相手ごとの強さの違いはそのままに、CPUの積極性・デッキ・資金力が変わる。<br>
      <b>👤 プレイヤー</b>: タイトル画面の「👤」で<b>5人まで</b>切り替えられる。プレイヤーごとに<b>コレクション・デッキ（5つまで保存）・ステージ進行度</b>が別々に記録される（名前は「✎」で変更）。<br>
      <b>レア度</b>: カードには★（コモン）〜★★★★（レジェンド）のレア度があり、パックでは低レアほど出やすい。<br>
      <b>🔍 カード詳細</b>: 📚アルバムの所持カードをクリック、🛠デッキ構築・🎁シールド戦の<b>🔍</b>、🗑捨札の行をクリックすると、
      <b>カードの詳細ポップアップ</b>＝フルサイズのカード表示＋ステータス＋<b>特性（能力）の説明文</b>＋属性相性を確認できる。<br><br>
      <b>⚔ 三つ巴</b>: あなた＋ステージの主＋<b>ランダムな乱入キャラ</b>の3人で戦うモード。<b>全ステージ</b>から選べ、勝てばカードを<b>${REWARD_WIN + REWARD_ROYALE_BONUS}枚</b>獲得＝1対1より+${REWARD_ROYALE_BONUS}枚（進行度は変化しない）。🎪週替りONならさらに+${WEEKLY_BONUS_CARDS}枚。
      対象を選ぶスペル（ドレイン・フリーズ等）は<b>相手を選択</b>して撃つ。3人だと相手を金欠にしても止まらないので、<b>自分の凱旋</b>を最短で狙うのが鍵。<br>
      <b>🎮 2人対戦（ホットシート）</b>: 同じ端末を交互に操作する<b>人間同士の対戦</b>。プレイヤーを2人選び、<b>全ステージ</b>から盤面を選べる。
      各自の<b>使用中デッキ</b>（未構築ならおまかせ）で戦い、手番の交代時は手札が伏せられる（報酬・進行度は変化しない）。<br>
      <b>♻️ ポイント交換所</b>: 同名<b>4枚目以降の余剰カード</b>を<b>🎟パックポイント</b>にスクラップ（★+1〜★★★★+8）し、
      貯めて<b>カードパック（5枚入り・25🎟）</b>を購入できる。第一弾／第二弾のどちらのパックも買える。
      パック購入<b>10回ごとに🌟救いの回</b>＝1枚が<b>未所持カード確定</b>（アルバムのコンプリートの出口）。<br>
      <b>⏳ 第二弾「時流の回路」</b>: パック・交換所・報酬（弾を選択）で集める拡張カード群。新能力——
      <span class="ab">成長</span>ターン開始ごとにST/HP+5（上限+25） ／ <span class="ab">群れ</span>自軍の同属性1体につきST+5 ／
      <span class="ab">遠隔</span>侵略・侵攻で反撃を受けない ／ <span class="ab">吸収</span>与えたダメージの半分HP回復 ／
      <span class="ab">硬殻</span>受けるダメージ-10 ／ <span class="ab">背水</span>HP半分以下でST+25 ／
      <span class="ab">採掘</span>ターン開始時+15G ／ <span class="ab">転生</span>倒されても手札に戻る ／
      <span class="ab">飛翔</span>侵攻で2マス先まで ／ <span class="ab">看破</span>相手のアイテムを打ち消す。<br>
      🏛<b>建造物</b>（ST0・不動・反撃しない施設）は通行料アップ・採掘・回復などの恒常効果で領地を支える。
      📜<b>巻物</b>は攻撃を「記載ST固定の魔法攻撃」に変える（低STの壁が魔導砲台に）。
      👑<b>精霊王</b>（300G）は各属性の頂点に立つ別格のレジェンド。<br>
      ✨<b>第二弾スペル（55種）</b>: 🕯️<b>儀式</b>は追加コストに<b>手札1枚を捧げる</b>大型スペル（豊穣・猛火・蘇生・星霜・時の儀など）。
      <b>盤面エフェクト</b>（市場開放・魔力嵐・戦火の世・静寂のとばり・女神の加護・停戦協定・蜃気楼）は2Rの間、盤面全体のルールを変える。
      ほかに永続強化（🕊️ブレッシング・💎鉱脈発見・🏯城塞化）、移動妨害（🎲呪いのダイス・🟤泥沼・🏰強制送還）、
      🌫️無力化の霧（敵の能力を消す）・🤫沈黙の霧（スペル封じ）など。<br>
      ⏳<b>第二弾ステージ（S13〜S16）</b>: 大型の「隊商の大草原」「時計仕掛けの大環」を越えた先に、
      👑精霊王を従えるボス——「五王の間」の巫女セレスティアと、最終決戦「時流の玉座」の時空王アイオーンが待つ
      （ボスは精霊王を<b>確定でデッキに投入</b>してくる）。<br>
      <b>🎪 ウィークリールール</b>: 毎週月曜に切り替わる特殊ルール（通行料2倍・初期手札レジェンド保証など）。タイトルの「🎪 週替り」でON/OFF。
      ONで正規対戦に勝つと<b>ボーナスカード+${typeof WEEKLY_BONUS_CARDS !== "undefined" ? WEEKLY_BONUS_CARDS : 2}枚</b>（トレーニングには適用されない）。<br>
      <b>🎵 BGM</b>: ヘッダーの🎵でBGMのON/OFF（効果音と同じくオフラインで自動生成。🔊は効果音の切替）。`,
    buttons: [{ label: "閉じる", value: "close", primary: true }],
  });
}

// ---------- 起動 ----------
window.addEventListener("DOMContentLoaded", async () => {
  // 別のダイアログ表示中・決定待ち中は開かない（上書きするとゲームが止まるため）。
  // オーバーレイ表示チェックだけでは不十分——「👁 盤面を確認」で一時的に閉じている間は
  // オーバーレイ非表示のままダイアログが決定待ちなので、UI.dialogBusy も必ず確認する
  // （これを見ていなかったため、盤面確認中に❓/🗑を押すと進行が止まるバグがあった。v13で修正）。
  const canOpenExtraDialog = () =>
    !document.getElementById("overlay").classList.contains("show") && UI.dialogBusy === 0;
  document.getElementById("help-btn").addEventListener("click", () => {
    if (canOpenExtraDialog()) showHelp();
  });
  document.getElementById("mute-btn").addEventListener("click", e => {
    e.currentTarget.textContent = SFX.toggle() ? "🔊" : "🔇";
  });
  // BGM（WebAudioループ生成）: 🎵でON/OFF。保存がONなら最初のクリックで再生開始（自動再生制限対応）
  const bgmBtn = document.getElementById("bgm-btn");
  bgmBtn.classList.toggle("off", !BGM.init());
  bgmBtn.addEventListener("click", () => bgmBtn.classList.toggle("off", !BGM.toggle()));
  // 両者の捨てカード確認（別のダイアログ表示中・決定待ち中は開かない）
  document.getElementById("discard-btn").addEventListener("click", () => {
    if (G && canOpenExtraDialog()) showDiscardViewer();
  });
  // 盤面のマスをクリックして情報を確認（駐留クリーチャーの能力・実効防衛値など）。
  // 決定待ちのダイアログ中・領地選択中（光っているマスを選ぶモード）は開かない
  document.getElementById("board").addEventListener("click", e => {
    if (!G || !canOpenExtraDialog() || UI.selectableTiles) return;
    const gEl = e.target.closest && e.target.closest(".tile");
    if (!gEl) return;
    showTileInfo(G.tiles[Number(gEl.dataset.tile)]);
  });
  // 途中棄権（投了）
  document.getElementById("surrender-btn").addEventListener("click", requestSurrender);
  // 固定フローティングウィンドウ（ステータス／手札）の開閉
  initHudWindows();
  // 盤面ズーム
  document.getElementById("zoom-in").addEventListener("click", () => zoomBoard(ZOOM_STEP));
  document.getElementById("zoom-out").addEventListener("click", () => zoomBoard(-ZOOM_STEP));
  document.getElementById("zoom-label").addEventListener("click", resetZoom);
  document.getElementById("zoom-fit").addEventListener("click", () => fitBoard());
  // Ctrl + マウスホイールで盤面を拡大縮小（ブラウザ拡大の代わりに盤面だけ拡大）
  const boardWrap = document.getElementById("board-wrap");
  boardWrap.addEventListener("wheel", e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBoard(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }, { passive: false });
  // スマホ: 2本指ピンチで盤面を拡大縮小（1本指のスクロールはCSSの touch-action で維持）
  let pinchDist = 0;
  const touchDist = e => Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY);
  boardWrap.addEventListener("touchstart", e => {
    if (e.touches.length === 2) pinchDist = touchDist(e);
  }, { passive: true });
  boardWrap.addEventListener("touchmove", e => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const d = touchDist(e);
    if (!pinchDist) { pinchDist = d; return; }
    if (Math.abs(d - pinchDist) >= 30) { // 指の距離が30px変わるごとに1段階
      zoomBoard(d > pinchDist ? ZOOM_STEP : -ZOOM_STEP);
      pinchDist = d;
    }
  }, { passive: false });
  boardWrap.addEventListener("touchend", () => { pinchDist = 0; });
  boardWrap.addEventListener("touchcancel", () => { pinchDist = 0; });
  applyZoom();
  await showTitleScreen(); // 世界観を伝えるタイトル画面（クリックで開始）。最初のタップ＝BGM自動再生の解禁も兼ねる
  titleScreen();
});
