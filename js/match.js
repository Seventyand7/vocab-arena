/* ============================================================
   介面 3：翻牌配對測驗

   每輪抽 6 組單字（12 張牌：英文卡 + 中文卡），全部背面朝上洗亂。
   配對成功 → 兩張留在翻開狀態，該單字 masteryLevel +1。
   配對失敗 → 兩張翻回背面，兩張所屬的單字各 −2（比單字卡的
             「不熟」溫和，因為失敗可能只是手滑點錯）。
   ============================================================ */

import { $, show, setText, toast, burstSparks } from "./ui.js";
import { MATCH_PAIRS, MATCH_MIN_PAIRS } from "./config.js";
import { buildPool, shuffle, matchHit, matchMiss, milestonePatch } from "./scheduler.js";
import { getWords, saveProgress } from "./store.js";

let els = null;
let onChange = () => {};

const state = {
  cards: [],          // { key, wordId, side, text }
  itemByWordId: new Map(),
  open: [],           // 目前翻開、還沒結算的牌 key
  matched: new Set(), // 已配對的 wordId
  pairCount: 0,
  locked: false,
};

export function initMatch(onDataChange) {
  onChange = onDataChange || (() => {});
  els = {
    empty: $("#match-empty"),
    emptyMsg: $("#match-empty-msg"),
    stage: $("#match-stage"),
    done: $("#match-done"),
    board: $("#match-board"),
    notice: $("#match-notice"),
    found: $("#match-found"),
    pairs: $("#match-pairs"),
    progress: $("#match-progress"),
  };

  $("#match-restart").addEventListener("click", startRound);
  $("#match-again").addEventListener("click", startRound);
  els.board.addEventListener("click", (e) => {
    const btn = e.target.closest(".mcard");
    if (btn) onCardClick(btn);
  });
}

export function startRound() {
  const words = getWords();

  // 降級處理：連最低組數都湊不出來就直接提示
  if (words.length < MATCH_MIN_PAIRS) {
    setText(
      els.emptyMsg,
      `翻牌配對至少需要 ${MATCH_MIN_PAIRS} 個單字才能開一輪，目前只有 ${words.length} 個。先去新增幾個字吧。`
    );
    show(els.empty, true);
    show(els.stage, false);
    show(els.done, false);
    return;
  }

  const pairCount = Math.min(MATCH_PAIRS, words.length);
  const { items } = buildPool(words, pairCount);

  state.cards = [];
  state.itemByWordId = new Map();
  state.open = [];
  state.matched = new Set();
  state.pairCount = items.length;
  state.locked = false;

  for (const item of items) {
    state.itemByWordId.set(item.word.id, item);
    state.cards.push({ key: `${item.word.id}:en`, wordId: item.word.id, side: "en", text: item.word.original });
    state.cards.push({ key: `${item.word.id}:zh`, wordId: item.word.id, side: "zh", text: item.word.translation });
  }
  state.cards = shuffle(state.cards);

  // 組數不足一輪標準量時，縮減這輪組數並告知使用者
  if (state.pairCount < MATCH_PAIRS) {
    setText(els.notice, `單字量不足 ${MATCH_PAIRS} 組，本輪改用 ${state.pairCount} 組進行。`);
    show(els.notice, true);
  } else {
    show(els.notice, false);
  }

  show(els.empty, false);
  show(els.done, false);
  show(els.stage, true);
  renderBoard();
  updateProgress();
}

function renderBoard() {
  els.board.innerHTML = "";
  for (const card of state.cards) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mcard";
    btn.dataset.key = card.key;
    btn.dataset.wordId = card.wordId;

    const inner = document.createElement("div");
    inner.className = "mcard-inner";

    const back = document.createElement("div");
    back.className = "mcard-face mcard-back";
    back.textContent = "?";

    const front = document.createElement("div");
    front.className = `mcard-face mcard-front side-${card.side}`;
    front.textContent = card.text;

    inner.append(back, front);
    btn.appendChild(inner);
    els.board.appendChild(btn);
  }
}

function cardEl(key) {
  return els.board.querySelector(`.mcard[data-key="${CSS.escape(key)}"]`);
}

function updateProgress() {
  setText(els.found, state.matched.size);
  setText(els.pairs, state.pairCount);
  els.progress.style.width = `${(state.matched.size / state.pairCount) * 100}%`;
}

function onCardClick(btn) {
  if (state.locked) return;
  const key = btn.dataset.key;
  if (state.matched.has(btn.dataset.wordId)) return;
  if (state.open.includes(key)) return;

  btn.classList.add("is-open");
  state.open.push(key);

  if (state.open.length === 2) resolvePair();
}

async function resolvePair() {
  state.locked = true;
  const [keyA, keyB] = state.open;
  const elA = cardEl(keyA);
  const elB = cardEl(keyB);
  const wordIdA = elA.dataset.wordId;
  const wordIdB = elB.dataset.wordId;

  // 同一個 wordId 的兩張牌（英文卡 + 中文卡）＝ 配對成功
  if (wordIdA === wordIdB) {
    await handleHit(wordIdA, elA, elB);
  } else {
    await handleMiss(wordIdA, wordIdB, elA, elB);
  }

  state.open = [];
  state.locked = false;
}

async function handleHit(wordId, elA, elB) {
  const item = state.itemByWordId.get(wordId);
  state.matched.add(wordId);

  elA.classList.add("is-matched", "is-hit");
  elB.classList.add("is-matched", "is-hit");
  burstSparks(elA);
  burstSparks(elB);
  setTimeout(() => {
    elA.classList.remove("is-hit");
    elB.classList.remove("is-hit");
  }, 780);

  updateProgress();
  await persist([withMilestones(matchHit(item.word), item)]);

  if (state.matched.size === state.pairCount) {
    setTimeout(() => {
      show(els.stage, false);
      show(els.done, true);
    }, 780);
  }
}

async function handleMiss(wordIdA, wordIdB, elA, elB) {
  const itemA = state.itemByWordId.get(wordIdA);
  const itemB = state.itemByWordId.get(wordIdB);

  elA.classList.add("is-miss");
  elB.classList.add("is-miss");

  await persist([
    withMilestones(matchMiss(itemA.word), itemA),
    withMilestones(matchMiss(itemB.word), itemB),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 820));
  for (const el of [elA, elB]) {
    el.classList.remove("is-miss", "is-open");
  }
}

/** 這個單字這輪已經出現過了，順手把到期的里程碑標成完成。 */
function withMilestones(update, item) {
  const patch = milestonePatch(item.milestones);
  if (patch) update.milestonesDone = patch;
  return update;
}

async function persist(updates) {
  try {
    await saveProgress(updates);
    onChange();
  } catch (err) {
    console.error(err);
    toast("進度沒存成功，請檢查網路連線。", true);
  }
}
