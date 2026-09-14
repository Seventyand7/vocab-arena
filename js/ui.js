/* ============================================================
   共用 UI 小工具
   ============================================================ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const show = (el, visible = true) => { if (el) el.hidden = !visible; };

export function setText(el, text) {
  if (el) el.textContent = text ?? "";
}

/** 只切換 .screen 之間的顯示。 */
export function showScreen(id) {
  $$(".screen").forEach((s) => s.classList.toggle("is-active", s.id === id));
}

/** 短暫的浮動提示。 */
export function toast(message, isError = false) {
  const host = $("#toast-host");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " err" : "");
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  }, isError ? 4200 : 2400);
}

/** 顯示／清除面板內的錯誤訊息。 */
export function showAlert(el, message, kind = "error") {
  if (!el) return;
  if (!message) { el.hidden = true; el.textContent = ""; return; }
  el.className = `alert alert-${kind === "ok" ? "ok" : "error"}`;
  el.textContent = message;
  el.hidden = false;
}

/** masteryLevel 的 0–5 格顯示。 */
export function renderPips(container, level) {
  if (!container) return;
  container.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const pip = document.createElement("span");
    pip.className = "pip" + (i < level ? " on" : "");
    container.appendChild(pip);
  }
}

/** 配對成功時的粒子爆發。 */
export function burstSparks(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const host = document.createElement("div");
  host.className = "spark-host";
  document.body.appendChild(host);

  const colors = ["#22D3EE", "#FF4FA3", "#FFC857", "#3DDC97"];
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
    const dist = 46 + Math.random() * 58;
    s.className = "spark";
    s.style.left = `${cx}px`;
    s.style.top = `${cy}px`;
    s.style.background = colors[i % colors.length];
    s.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    host.appendChild(s);
  }
  setTimeout(() => host.remove(), 800);
}

/** 相對時間的中文描述（給單字庫列表用）。 */
export function relativeDay(date, now = new Date()) {
  if (!date) return "—";
  const diff = date.getTime() - now.getTime();
  const days = Math.round(diff / 86400000);
  if (diff <= 0) return "待複習";
  if (days === 0) return "今天稍後";
  if (days === 1) return "明天";
  return `${days} 天後`;
}
