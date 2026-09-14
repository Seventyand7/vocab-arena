/* ============================================================
   介面 2：單字卡
   ============================================================ */

import { $, show, setText, renderPips, toast } from "./ui.js";
import { FLASHCARD_SESSION_SIZE } from "./config.js";
import { buildPool, shuffle, gradeKnown, gradeForgot, milestonePatch } from "./scheduler.js";
import { getWords, saveProgress } from "./store.js";

let els = null;
let onChange = () => {};

const state = {
  queue: [],
  index: 0,
  flipped: false,
  locked: false,
  known: 0,
  forgot: 0,
};

export function initFlashcards(onDataChange) {
  onChange = onDataChange || (() => {});
  els = {
    empty: $("#cards-empty"),
    emptyMsg: $("#cards-empty-msg"),
    stage: $("#cards-stage"),
    done: $("#cards-done"),
    card: $("#flashcard"),
    idx: $("#card-idx"),
    total: $("#card-total"),
    progress: $("#card-progress"),
    frontWord: $("#fc-front-word"),
    forcedBadge: $("#fc-badge-forced"),
    pos: $("#fc-pos"),
    translation: $("#fc-translation"),
    example: $("#fc-example"),
    exampleZh: $("#fc-example-zh"),
    mastery: $("#fc-mastery"),
    gradeRow: $("#grade-row"),
    gradeHint: $("#grade-hint"),
    resKnown: $("#res-known"),
    resForgot: $("#res-forgot"),
  };

  els.card.addEventListener("click", flip);
  els.card.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); }
  });
  $("#grade-known").addEventListener("click", () => grade(true));
  $("#grade-forgot").addEventListener("click", () => grade(false));
  $("#cards-restart").addEventListener("click", startSession);
  $("#cards-again").addEventListener("click", startSession);
}

export function startSession() {
  const words = getWords();

  if (!words.length) {
    setText(els.emptyMsg, "單字庫還是空的，先去「新增單字」加幾個字吧。");
    show(els.empty, true);
    show(els.stage, false);
    show(els.done, false);
    return;
  }

  const { items } = buildPool(words, FLASHCARD_SESSION_SIZE);
  state.queue = shuffle(items);
  state.index = 0;
  state.known = 0;
  state.forgot = 0;
  state.locked = false;

  show(els.empty, false);
  show(els.done, false);
  show(els.stage, true);
  renderCard();
}

function currentItem() {
  return state.queue[state.index];
}

function renderCard() {
  const item = currentItem();
  if (!item) return finish();

  const w = item.word;
  setText(els.frontWord, w.original);
  setText(els.pos, w.partOfSpeech || "—");
  setText(els.translation, w.translation);
  setText(els.example, w.example || "");
  setText(els.exampleZh, w.exampleZh || "");
  renderPips(els.mastery, w.masteryLevel);
  show(els.forcedBadge, item.milestones.length > 0);

  setText(els.idx, state.index + 1);
  setText(els.total, state.queue.length);
  els.progress.style.width = `${(state.index / state.queue.length) * 100}%`;

  state.flipped = false;
  els.card.classList.remove("is-flipped");
  show(els.gradeRow, false);
  show(els.gradeHint, true);
}

function flip() {
  if (state.locked || !currentItem()) return;
  state.flipped = !state.flipped;
  els.card.classList.toggle("is-flipped", state.flipped);
  show(els.gradeRow, state.flipped);
  show(els.gradeHint, !state.flipped);
}

async function grade(known) {
  if (state.locked) return;
  const item = currentItem();
  if (!item) return;

  state.locked = true;
  const update = known ? gradeKnown(item.word) : gradeForgot(item.word);

  // 這張卡實際出現過了，把對應的時效性里程碑標成已完成
  const patch = milestonePatch(item.milestones);
  if (patch) update.milestonesDone = patch;

  if (known) state.known++; else state.forgot++;

  // 先翻回正面，等動畫走完再換下一張，避免答案一閃而過
  state.flipped = false;
  els.card.classList.remove("is-flipped");
  show(els.gradeRow, false);

  try {
    await saveProgress([update]);
    onChange();
  } catch (err) {
    console.error(err);
    toast("進度沒存成功，請檢查網路連線。", true);
  }

  setTimeout(() => {
    state.index++;
    state.locked = false;
    if (state.index >= state.queue.length) finish();
    else renderCard();
  }, 340);
}

function finish() {
  els.progress.style.width = "100%";
  setText(els.resKnown, state.known);
  setText(els.resForgot, state.forgot);
  show(els.stage, false);
  show(els.empty, false);
  show(els.done, true);
}
