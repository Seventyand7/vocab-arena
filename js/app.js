/* ============================================================
   VOCAB QUEST — 主程式
   ============================================================ */

import {
  resolveConfig, saveLocalConfig, initFirebase,
  signInWithGoogle, signOutUser, watchAuth, consumeRedirectResult,
} from "./firebase.js";
import {
  setUid, loadWords, getWords, addWord, deleteWord,
  loadSettings, saveSettings,
} from "./store.js";
import { translateWord, testApiKey } from "./gemini.js";
import { countDue } from "./scheduler.js";
import { DEFAULT_MODEL } from "./config.js";
import { $, $$, show, setText, showScreen, toast, showAlert, relativeDay } from "./ui.js";
import { initFlashcards, startSession } from "./flashcards.js";
import { initMatch, startRound } from "./match.js";

const session = {
  user: null,
  apiKey: "",
  model: DEFAULT_MODEL,
  preview: null,      // 翻譯結果，按下「確認加入」前不會寫進 Firestore
  currentView: "add",
};

/* ============================================================
   啟動
   ============================================================ */

function boot() {
  const cfg = resolveConfig();
  if (!cfg) {
    setupScreen();
    return;
  }

  try {
    initFirebase(cfg);
  } catch (err) {
    console.error(err);
    showScreen("setup-screen");
    showAlert($("#setup-error"), `Firebase 初始化失敗：${err.message}`);
    setupScreen();
    return;
  }

  wireStaticHandlers();
  initFlashcards(refreshStats);
  initMatch(refreshStats);

  // redirect 登入流程回來時先收掉結果（popup 流程這裡會是 null）
  consumeRedirectResult().catch((err) => {
    console.error(err);
    showAlert($("#login-error"), translateAuthError(err));
  });

  watchAuth(onAuthChange);
}

/* ---------- Firebase config 引導畫面 ---------- */

function setupScreen() {
  showScreen("setup-screen");
  const ta = $("#setup-config");
  ta.placeholder = [
    "{",
    '  "apiKey": "AIza...",',
    '  "authDomain": "your-project.firebaseapp.com",',
    '  "projectId": "your-project",',
    '  "storageBucket": "your-project.firebasestorage.app",',
    '  "messagingSenderId": "1234567890",',
    '  "appId": "1:1234567890:web:abcdef"',
    "}",
  ].join("\n");

  $("#setup-save").addEventListener("click", () => {
    const raw = ta.value.trim();
    if (!raw) return showAlert($("#setup-error"), "請先貼上 firebaseConfig。");
    try {
      // 允許直接貼 `const firebaseConfig = {...};` 這種整段程式碼
      const jsonish = raw.replace(/^[^{]*/, "").replace(/;?\s*$/, "");
      const cfg = JSON.parse(
        jsonish.replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":').replace(/'/g, '"')
      );
      if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
        return showAlert($("#setup-error"), "缺少 apiKey / projectId / appId，請確認貼上的內容完整。");
      }
      saveLocalConfig(cfg);
      location.reload();
    } catch (err) {
      showAlert($("#setup-error"), `解析失敗：${err.message}`);
    }
  });
}

/* ============================================================
   認證
   ============================================================ */

function translateAuthError(err) {
  const map = {
    "auth/unauthorized-domain": "這個網域還沒加進 Firebase 授權清單。請到 Firebase Console → Authentication → Settings → Authorized domains 加入目前網域。",
    "auth/operation-not-allowed": "Firebase 專案還沒啟用 Google 登入。請到 Authentication → Sign-in method 開啟 Google。",
    "auth/popup-closed-by-user": "登入視窗被關閉了，請再試一次。",
    "auth/network-request-failed": "網路連線有問題，請稍後再試。",
  };
  return map[err?.code] || err?.message || "登入失敗，請再試一次。";
}

async function onAuthChange(user) {
  if (!user) {
    session.user = null;
    setUid(null);
    showScreen("login-screen");
    return;
  }

  session.user = user;
  setUid(user.uid);
  showScreen("app-screen");
  renderAccount(user);

  try {
    const [, settings] = await Promise.all([loadWords(), loadSettings()]);
    session.apiKey = settings.apiKey;
    session.model = settings.model;
    $("#api-key-input").value = settings.apiKey;
    $("#model-select").value = settings.model;
    refreshStats();
    renderWordList();
    if (!settings.apiKey) {
      toast("還沒設定 Gemini API key，翻譯功能會無法使用。");
    }
  } catch (err) {
    console.error(err);
    // Security Rules 鎖定擁有者本人時，其他人登入會拿到 permission-denied
    if (err?.code === "permission-denied") {
      await signOutUser();
      showAlert($("#login-error"), "這是個人使用的工具，只有擁有者本人的帳號能存取資料。");
      return;
    }
    toast(`讀取資料失敗：${err.message}`, true);
  }
}

function renderAccount(user) {
  const photo = user.photoURL || "";
  for (const el of [$("#user-avatar"), $("#settings-avatar")]) {
    if (photo) el.src = photo; else el.removeAttribute("src");
    el.alt = user.displayName || "帳號";
  }
  setText($("#settings-name"), user.displayName || "（未設定名稱）");
  setText($("#settings-email"), user.email || "");
  $("#uid-display").value = user.uid;
}

/* ============================================================
   靜態事件綁定
   ============================================================ */

function wireStaticHandlers() {
  $("#google-signin").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    showAlert($("#login-error"), "");
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error(err);
      showAlert($("#login-error"), translateAuthError(err));
    } finally {
      btn.disabled = false;
    }
  });

  $("#signout-btn").addEventListener("click", () => signOutUser());

  $("#uid-copy").addEventListener("click", async () => {
    const uid = $("#uid-display").value;
    if (!uid) return;
    try {
      await navigator.clipboard.writeText(uid);
      toast("UID 已複製");
    } catch (_) {
      // 沒有剪貼簿權限（例如非 https）時，退而求其次選起來讓使用者手動複製
      $("#uid-display").select();
      toast("請按 Ctrl+C 複製");
    }
  });

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
  $$(".goto-add").forEach((btn) => btn.addEventListener("click", () => switchView("add")));

  wireAddWord();
  wireSettings();
  wireWordList();
}

function switchView(view) {
  session.currentView = view;
  $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.dataset.view === view));

  if (view === "cards") startSession();
  if (view === "match") startRound();
  if (view === "list") renderWordList();
}

/* ============================================================
   介面 1：新增單字
   ============================================================ */

function wireAddWord() {
  $("#translate-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runTranslate($("#word-input").value);
  });
  $("#retry-translate").addEventListener("click", () => runTranslate(session.preview?.original));
  $("#discard-preview").addEventListener("click", clearPreview);
  $("#confirm-add").addEventListener("click", confirmAdd);
}

async function runTranslate(input) {
  const word = String(input || "").trim();
  showAlert($("#add-error"), "");

  if (!word) return showAlert($("#add-error"), "請先輸入英文單字或片語。");
  if (!session.apiKey) {
    showAlert($("#add-error"), "還沒設定 Gemini API key，請先到「設定」頁輸入。");
    return;
  }

  const dup = getWords().find((w) => w.original.toLowerCase() === word.toLowerCase());
  if (dup) toast(`「${word}」已經在單字庫裡了，還是可以重新翻譯後再加一次。`);

  show($("#preview-panel"), false);
  show($("#translate-loading"), true);
  $("#translate-btn").disabled = true;

  try {
    const result = await translateWord(word, session.apiKey, session.model);
    session.preview = result;
    renderPreview(result);
  } catch (err) {
    console.error(err);
    showAlert($("#add-error"), err.message);
  } finally {
    show($("#translate-loading"), false);
    $("#translate-btn").disabled = false;
  }
}

function renderPreview(r) {
  setText($("#pv-original"), r.original);
  setText($("#pv-pos"), r.partOfSpeech);
  setText($("#pv-translation"), r.translation);
  setText($("#pv-example"), r.example);
  setText($("#pv-example-zh"), r.exampleZh);
  show($("#preview-panel"), true);
  $("#preview-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearPreview() {
  session.preview = null;
  show($("#preview-panel"), false);
}

async function confirmAdd() {
  if (!session.preview) return;
  const btn = $("#confirm-add");
  btn.disabled = true;
  try {
    await addWord(session.preview);
    toast(`已加入「${session.preview.original}」`);
    clearPreview();
    $("#word-input").value = "";
    $("#word-input").focus();
    refreshStats();
    renderWordList();
  } catch (err) {
    console.error(err);
    showAlert($("#add-error"), `寫入失敗：${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

/* ============================================================
   設定
   ============================================================ */

function wireSettings() {
  const input = $("#api-key-input");

  $("#api-key-toggle").addEventListener("click", (e) => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    e.currentTarget.textContent = showing ? "顯示" : "隱藏";
  });

  $("#api-key-save").addEventListener("click", async () => {
    const apiKey = input.value.trim();
    const model = $("#model-select").value;
    if (!apiKey) return showAlert($("#settings-msg"), "請先貼上 Gemini API key。");
    try {
      await saveSettings({ apiKey, model });
      session.apiKey = apiKey;
      session.model = model;
      showAlert($("#settings-msg"), "已儲存到你自己的 Firestore 文件。", "ok");
      toast("API key 已儲存");
    } catch (err) {
      console.error(err);
      showAlert($("#settings-msg"), `儲存失敗：${err.message}`);
    }
  });

  $("#api-key-test").addEventListener("click", async (e) => {
    const apiKey = input.value.trim();
    const model = $("#model-select").value;
    if (!apiKey) return showAlert($("#settings-msg"), "請先貼上 Gemini API key。");
    e.currentTarget.disabled = true;
    showAlert($("#settings-msg"), "測試中…", "ok");
    try {
      await testApiKey(apiKey, model);
      showAlert($("#settings-msg"), `連線成功，${model} 可以使用。`, "ok");
    } catch (err) {
      showAlert($("#settings-msg"), err.message);
    } finally {
      e.currentTarget.disabled = false;
    }
  });

  $("#api-key-clear").addEventListener("click", async () => {
    if (!confirm("確定要清除已儲存的 Gemini API key 嗎？")) return;
    try {
      await saveSettings({ apiKey: "", model: $("#model-select").value });
      session.apiKey = "";
      input.value = "";
      showAlert($("#settings-msg"), "已清除。", "ok");
    } catch (err) {
      showAlert($("#settings-msg"), `清除失敗：${err.message}`);
    }
  });

  $("#model-select").addEventListener("change", async (e) => {
    session.model = e.target.value;
    if (!session.apiKey) return;
    try {
      await saveSettings({ apiKey: session.apiKey, model: session.model });
      toast(`模型已切換為 ${session.model}`);
    } catch (err) {
      console.error(err);
    }
  });
}

/* ============================================================
   單字庫
   ============================================================ */

function wireWordList() {
  $("#list-search").addEventListener("input", renderWordList);
  $("#list-body").addEventListener("click", async (e) => {
    const btn = e.target.closest(".del-btn");
    if (!btn) return;
    const id = btn.dataset.id;
    const word = getWords().find((w) => w.id === id);
    if (!word) return;
    if (!confirm(`確定要刪除「${word.original}」嗎？`)) return;
    try {
      await deleteWord(id);
      toast("已刪除");
      refreshStats();
      renderWordList();
    } catch (err) {
      console.error(err);
      toast(`刪除失敗：${err.message}`, true);
    }
  });
}

function renderWordList() {
  const host = $("#list-body");
  if (!host) return;

  const q = ($("#list-search").value || "").trim().toLowerCase();
  const all = getWords();
  const list = q
    ? all.filter((w) =>
        w.original.toLowerCase().includes(q) || w.translation.toLowerCase().includes(q))
    : all;

  host.innerHTML = "";

  if (!list.length) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = all.length ? "沒有符合的單字。" : "單字庫還是空的，先去「新增單字」加幾個字吧。";
    host.appendChild(note);
    return;
  }

  const now = new Date();
  for (const w of list) {
    const row = document.createElement("div");
    row.className = "word-row";

    const main = document.createElement("div");
    main.className = "word-main";

    const en = document.createElement("div");
    en.className = "word-en";
    en.textContent = w.original;

    const zh = document.createElement("div");
    zh.className = "word-zh";
    zh.textContent = w.translation;

    const meta = document.createElement("div");
    meta.className = "word-meta";
    for (const text of [w.partOfSpeech || "—", `LV ${w.masteryLevel}`, relativeDay(w.nextReviewAt, now)]) {
      const tag = document.createElement("span");
      tag.className = "meta-tag";
      tag.textContent = text;
      meta.appendChild(tag);
    }

    main.append(en, zh, meta);

    const side = document.createElement("div");
    side.className = "word-side";
    const del = document.createElement("button");
    del.className = "del-btn";
    del.dataset.id = w.id;
    del.textContent = "刪除";
    side.appendChild(del);

    row.append(main, side);
    host.appendChild(row);
  }
}

/* ============================================================
   統計
   ============================================================ */

function refreshStats() {
  const words = getWords();
  setText($("#stat-total"), words.length);
  setText($("#stat-due"), countDue(words));
  if (session.currentView === "list") renderWordList();
}

boot();
