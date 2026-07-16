// ============================================================
// chars.js — 対戦相手キャラクター（顔絵・性格・セリフ）
// 「相手の存在を感じられる」ようにする v18 の要。
//   CHARACTERS: ステージid をキーにしたキャラ定義（face絵文字・色・肩書き・セリフ集）
//   cpuSay(p, cat): 対戦中に吹き出しでセリフを表示（非ブロッキング）
//   showMatchIntro(g): 対戦開始前の「VS 口上」画面
//   pickRoyaleRival(stage): 三つ巴モードの乱入キャラを選ぶ
// ============================================================
"use strict";

// セリフのカテゴリ:
//   greet=開幕の挨拶 / taunt=手番のひとりごと（ときどき） / invade=侵略開始 /
//   battleWin=バトル勝利 / battleLose=バトル敗北 / tollGain=通行料をせしめた /
//   lap=周回達成 / reach=目標資産に到達 / restart=魔力が尽きて城で再起 /
//   win=最終勝利 / lose=最終敗北
const CHARACTERS = {
  s1: {
    face: "🌱", color: "#8ee0a0", title: "見習いセプター",
    lines: {
      greet: ["よ、よろしくお願いします！ 僕だって練習してきたんですから！"],
      taunt: ["えっと……次はどうしよう", "先生の教え、思い出せ……僕！", "このマス、良さそうだなあ"],
      invade: ["い、いきます！ 侵略です！", "勇気を出して……突撃ーっ！"],
      battleWin: ["や、やった！ 勝てました！", "見ましたか！？ 今の僕の戦い！"],
      battleLose: ["うわーん、負けちゃった……", "つ、次は勝ちますから！"],
      tollGain: ["わあ、通行料が入りました！ えへへ", "ありがとうございます……！"],
      lap: ["一周できました！ 順調です！"],
      reach: ["目標に届いてる……！ お城に帰れば僕の勝ちです！"],
      restart: ["お金が尽きちゃった……お城で立て直します！"],
      win: ["僕の……僕の勝ちです！ やったああ！"],
      lose: ["負けちゃいました……でも、いい勝負でした！"],
    },
  },
  s2: {
    face: "🔥", color: "#ff7a4d", title: "火術師",
    lines: {
      greet: ["この峠を越えたくば、我が炎を越えてみせよ！"],
      taunt: ["燃えろ、燃え上がれ……！", "この土地は熱いぞ、覚悟はいいか", "ふん、ぬるい手を打つ"],
      invade: ["焼き払え！ 侵略だ！", "我が炎の前に立つか、愚か者め！"],
      battleWin: ["灰も残らんわ！ はっはっは！", "これが火術の真髄よ！"],
      battleLose: ["ば、馬鹿な……我が炎が消されただと！？", "ぐぬぬ……水でもかけられた気分だ"],
      tollGain: ["通行料だ、置いていけ！", "熱い道を通るなら対価を払え！"],
      lap: ["峠をひと回り！ 火勢はますます強まるぞ！"],
      reach: ["見よ、財は燃え盛る炎のごとし！ あとは玉座に戻るのみ！"],
      restart: ["火が……消えた……だがまだ火種は残っているッ！"],
      win: ["すべては灰燼と帰した！ 我が勝利だ！"],
      lose: ["我が炎が……敗れるとは……見事だ"],
    },
  },
  s3: {
    face: "🌊", color: "#6ec3ff", title: "水賢者",
    lines: {
      greet: ["ようこそ水の都へ。流れを読める者が、この盤を制します"],
      taunt: ["流れが変わりましたね", "水は形を選ばない……盤面も同じこと", "静かに、深く"],
      invade: ["失礼。その土地、頂きます", "波が引くとき、岸は変わるのです"],
      battleWin: ["水の流れには逆らえません", "お見事……とは言えませんね"],
      battleLose: ["ほう……流れを読み違えましたか", "一敗。ですが水は涸れません"],
      tollGain: ["渡し賃を頂きます", "水路の通行料です。ご協力を"],
      lap: ["ひと巡り。潮が満ちてきました"],
      reach: ["満潮です。あとは城へ帰るだけ"],
      restart: ["干上がりましたか……ですが、雨はまた降る"],
      win: ["水は低きに流れ、勝利は備えた者に流れる。当然の帰結です"],
      lose: ["見事な流れでした。私の負けです"],
    },
  },
  s4: {
    face: "🍃", color: "#9be07a", title: "疾風の旅人",
    lines: {
      greet: ["よう！ 足の遅いヤツから負けてくんだぜ、この高地はな！"],
      taunt: ["風が呼んでるぜ", "とろとろしてると置いてくぜー？", "スピード勝負といこうや"],
      invade: ["風より速く、奪い去る！", "そこ、もらったぜ！"],
      battleWin: ["あばよ！ 風のように勝つのさ", "軽い軽い！"],
      battleLose: ["うおっと、向かい風か！", "ちっ、今のはノーカン！"],
      tollGain: ["まいどあり！ 風の通り賃だ", "へへ、いただき！"],
      lap: ["ひとっ飛びで一周！ 風は俺の味方だぜ"],
      reach: ["目標クリア！ あとは城まで駆け抜けるだけだ！"],
      restart: ["すっからかんかよ！ ま、身軽になったってことで！"],
      win: ["ゴールテープは俺のもんだ！ あばよ！"],
      lose: ["マジかよ、俺より速いヤツがいたとはな……"],
    },
  },
  s5: {
    face: "⛰️", color: "#d0a878", title: "岩人",
    lines: {
      greet: ["……よく来た。山は、逃げぬ。ワシも、逃げぬ"],
      taunt: ["……ふむ", "大地は急がぬ", "岩のように、待つ"],
      invade: ["……砕く", "その土地、大地に返してもらう"],
      battleWin: ["岩は、砕けぬ", "……当然の重さよ"],
      battleLose: ["ぬう……岩が、削られた", "……硬さが、足りなんだ"],
      tollGain: ["山の通行料じゃ", "……置いていけ"],
      lap: ["……ひと回り。大地が肥えた"],
      reach: ["実りは十分……あとは山頂の城へ戻るだけよ"],
      restart: ["すべて土に還ったか……また積み上げるまでよ"],
      win: ["大地は、裏切らぬ。ワシの勝ちじゃ"],
      lose: ["……見事。山より高い志であった"],
    },
  },
  s6: {
    face: "🌀", color: "#c9a0ff", title: "幻術師",
    lines: {
      greet: ["ふふ……この回廊で、どちらが本物のあなたか、確かめましょう"],
      taunt: ["それは幻？ それとも真実？", "ふふふ……", "迷いましたね？"],
      invade: ["幻惑の刃を受けなさい", "その土地は、最初から私のものだったのよ"],
      battleWin: ["幻に敗れる者に、実体は掴めないわ", "ふふ、種も仕掛けもあるのよ"],
      battleLose: ["あら……幻が破られた", "本体に届くなんて、驚いた"],
      tollGain: ["通行料……夢の中でも、お代は頂くわ"],
      lap: ["八の字をひと巡り……現と幻の境をね"],
      reach: ["これは幻じゃない、本物の財……あとは城へ帰るだけ"],
      restart: ["富も幻のように消えた……なら、また紡ぐまで"],
      win: ["最後まで幻の中にいたのは、あなたの方だったようね"],
      lose: ["幻術が解けた……あなたが、本物だったのね"],
    },
  },
  s7: {
    face: "💰", color: "#ffd76a", title: "大商人",
    lines: {
      greet: ["いらっしゃい！ この市場じゃ、金がすべてを語るんでな！ がっはっは！"],
      taunt: ["儲かってまっか？", "投資は連鎖が基本よ", "金の匂いがするな……"],
      invade: ["敵対的買収といこうか！", "その土地、査定させてもらうぞ！"],
      battleWin: ["商談成立！ がっはっは！", "安い買い物だったわい！"],
      battleLose: ["おおっと、赤字だ赤字！", "ぐぬぬ、査定ミスか！"],
      tollGain: ["まいどあり〜！ それが商売よ！", "チャリンチャリン、いい音だわい"],
      lap: ["市場をひと回り！ 景気は上々！"],
      reach: ["目標達成！ あとは城で祝杯じゃ！"],
      restart: ["は、破産じゃと！？ ……いや、商人は転んでもタダでは起きんぞ！"],
      win: ["商売とは勝つことよ！ がっはっは！"],
      lose: ["わしの負けか……あんた、商才あるよ"],
    },
  },
  s8: {
    face: "⚔️", color: "#ff9a9a", title: "剣闘士",
    lines: {
      greet: ["この闘技場に来たからには、逃げ場はないと知れ！"],
      taunt: ["血が滾るぜ……！", "戦え！ それが礼儀だ！", "退屈させるなよ"],
      invade: ["いくぞ、正面から叩き潰す！", "闘技場流の挨拶だ！"],
      battleWin: ["勝者への喝采を！", "これが闘技場の流儀だ！"],
      battleLose: ["ぐっ……いい一撃だ……！", "俺を倒すとは、観客が沸くぞ！"],
      tollGain: ["観戦料をもらうぜ！"],
      lap: ["アリーナ一周！ 声援が聞こえるぜ！"],
      reach: ["勝利は目前……玉座へ凱旋する！"],
      restart: ["すっからかんか……だが闘志までは奪えんぞ！"],
      win: ["勝者は俺だ！ 観客よ、吠えろ！"],
      lose: ["完敗だ……お前こそ真の剣闘士だ"],
    },
  },
  s9: {
    face: "⚡", color: "#ffe066", title: "雷帝",
    lines: {
      greet: ["我が峡谷に足を踏み入れたこと、後悔させてやろう"],
      taunt: ["雷鳴が聞こえるか？", "ひれ伏せ", "遅い。すべてが遅い"],
      invade: ["雷光の如く、奪う！", "裁きの雷を受けよ！"],
      battleWin: ["塵と化せ", "抵抗など無意味だ"],
      battleLose: ["おのれ……この我に傷を！？", "小癪な……！"],
      tollGain: ["貢物として受け取っておこう", "通行税だ。感謝して払え"],
      lap: ["峡谷をひと巡り……我が雷は衰えぬ"],
      reach: ["財は満ちた……あとは玉座に戻り、貴様の敗北を見届けるだけよ"],
      restart: ["我が財が尽きただと……！？ 覚えておれ……！"],
      win: ["ひれ伏せ！ これが雷帝の力だ！"],
      lose: ["馬鹿な……この我が、敗れるとは……"],
    },
  },
  s10: {
    face: "👑", color: "#ff5b5b", title: "魔王",
    lines: {
      greet: ["よくぞここまで来た、人の子よ。だが、ここが貴様の終着点だ"],
      taunt: ["くくく……", "絶望はまだか？", "踊れ、我が盤上で"],
      invade: ["滅びよ", "我が軍勢の前に、道を開けるがいい"],
      battleWin: ["脆い、脆いぞ人の子よ", "これが魔王の力……刻み込め"],
      battleLose: ["ほう……我が配下を破るか", "面白い……少しは楽しめそうだ"],
      tollGain: ["魂の代わりに金で許してやろう", "貢げ、人の子よ"],
      lap: ["我が城郭をひと巡り……闇は深まるばかりよ"],
      reach: ["富は満ちた……玉座へ戻り、貴様の絶望を眺めるとしよう"],
      restart: ["この魔王が金欠だと……！？ 笑わせる……だが滅びはせぬ！"],
      win: ["これが絶望だ。よく味わうがいい"],
      lose: ["馬鹿な……魔王たる我が……人の子に敗れるとは……見事だ"],
    },
  },
  s11: {
    face: "✨", color: "#a0c8ff", title: "星詠み",
    lines: {
      greet: ["星々は告げています……今宵、大きな勝負が動くと"],
      taunt: ["星の巡りが見える……", "運命は、四つ辻で交わる", "次の一手は、もう視えています"],
      invade: ["星の導きのままに", "この一手は、昨夜の星が告げたもの"],
      battleWin: ["星の予言どおりです", "運命には逆らえません"],
      battleLose: ["……予言に、ないはずの一手", "星が、曇っている……？"],
      tollGain: ["星の通り道です。お代を頂きます"],
      lap: ["四つの辻を巡り終えました……星回りは良好"],
      reach: ["吉兆……あとは城へ帰るだけと、星が告げています"],
      restart: ["流れ星のように財が消えた……でも星は巡り、また昇る"],
      win: ["すべては星の予言のままに"],
      lose: ["星に映らぬ未来があったなんて……あなたは星の外を歩く人ね"],
    },
  },
  s12: {
    face: "🎭", color: "#e0a0ff", title: "円卓の盟主",
    lines: {
      greet: ["ようこそ円卓へ。ここでは全員が敵、全員が客人だ"],
      taunt: ["三つ巴とは、実に美しい", "さて、誰から崩れるかな", "同盟？ そんなものは幻想だよ"],
      invade: ["円卓の流儀で、頂くとしよう", "悪く思うな。これが円卓だ"],
      battleWin: ["これぞ円卓の采配", "席がひとつ、空いたようだ"],
      battleLose: ["ほう、私の席を脅かすか", "……面白くなってきた"],
      tollGain: ["円卓の席料だ、置いていきたまえ"],
      lap: ["円卓をひと巡り。盤上は私の庭だよ"],
      reach: ["準備は整った。あとは玉座に着くだけだ"],
      restart: ["丸裸か……いいだろう、ここからが盟主の腕の見せどころだ"],
      win: ["円卓の主は、常にひとり。私だ"],
      lose: ["円卓の席を、君に譲ろう……見事だった"],
    },
  },
};

// プレイヤー(CPU)のキャラ定義を取得（charKey はステージid）
function charOf(p) {
  return (p && p.charKey && CHARACTERS[p.charKey]) || null;
}

// キャラの顔絵（円形メダリオンのSVG）。id を使わないので何個並べても安全
function charPortraitSVG(ch, size = 48) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="30" cy="30" r="28" fill="#1a1526"/>
    <circle cx="30" cy="30" r="28" fill="${ch.color}" opacity="0.28"/>
    <circle cx="30" cy="21" r="16" fill="${ch.color}" opacity="0.18"/>
    <text x="30" y="40" font-size="28" text-anchor="middle">${ch.face}</text>
    <circle cx="30" cy="30" r="27.5" fill="none" stroke="${ch.color}" stroke-width="1.6" opacity="0.9"/>
    <circle cx="30" cy="30" r="24.5" fill="none" stroke="#ffd76a" stroke-width="0.8" opacity="0.6"/>
  </svg>`;
}

// キャラのセリフを1つ取り出す（無ければ ""）
function charLine(p, cat) {
  const ch = charOf(p);
  const pool = ch && ch.lines[cat];
  if (!pool || !pool.length) return "";
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- セリフ吹き出し（非ブロッキング・自動で消える） ----------
let _bubbleTimer = null;
function cpuSay(p, cat) {
  const ch = charOf(p);
  if (!ch || !p.isCPU) return;
  const text = charLine(p, cat);
  if (!text) return;
  let el = document.getElementById("cpu-bubble");
  if (!el) {
    el = document.createElement("div");
    el.id = "cpu-bubble";
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="cb-face">${charPortraitSVG(ch, 42)}</span>
    <span class="cb-main"><b style="color:${ch.color}">${esc(p.name)}</b><span class="cb-text">${esc(text)}</span></span>`;
  el.style.borderColor = ch.color;
  el.classList.remove("cb-show");
  void el.offsetWidth; // アニメ再発火
  el.classList.add("cb-show");
  if (_bubbleTimer) clearTimeout(_bubbleTimer);
  _bubbleTimer = setTimeout(() => el.classList.remove("cb-show"), 3600);
}

// ---------- 対戦前の口上（VS画面） ----------
// CPU対戦相手を紹介するダイアログ。ポートレート＋肩書き＋開幕の挨拶
function showMatchIntro(g) {
  const cpus = g.players.filter(p => p.isCPU && charOf(p));
  if (cpus.length === 0) return Promise.resolve();
  const blocks = cpus.map(p => {
    const ch = charOf(p);
    return `<div class="vs-char" style="border-color:${ch.color}55">
      <div class="vs-portrait">${charPortraitSVG(ch, 76)}</div>
      <div class="vs-info">
        <div class="vs-title" style="color:${ch.color}">${esc(ch.title)}</div>
        <div class="vs-name">${esc(p.name)}</div>
        <div class="vs-quote">「${esc(charLine(p, "greet"))}」</div>
      </div>
    </div>`;
  }).join(`<div class="vs-and">＆</div>`);
  return showDialog({
    title: cpus.length > 1 ? "⚔ 三つ巴の対戦相手" : "⚔ 対戦相手",
    body: `<div class="vs-wrap">${blocks}</div>
      <p class="vs-stage">${g.stage.icon} ${esc(g.stage.name)} ── 目標資産 <b>${RULES.target}G</b> を成して🏰城へ凱旋せよ</p>`,
    buttons: [{ label: "⚔ 対戦開始", value: "go", primary: true }],
  });
}

// ---------- 三つ巴の乱入キャラ ----------
// ステージ本来の相手に加えて、他ステージのキャラが1人乱入する（毎回ランダム）
function pickRoyaleRival(stage) {
  const pool = STAGES.filter(s => s.id !== stage.id && CHARACTERS[s.id]);
  return pool[Math.floor(Math.random() * pool.length)];
}
