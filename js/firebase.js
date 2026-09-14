/* ============================================================
   Firebase 初始化（modular SDK，直接從 CDN 載入，不需要打包工具）
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { firebaseConfig as bundledConfig, isConfigPlaceholder } from "./config.js";

const LS_CONFIG_KEY = "vq:firebaseConfig";

/** 優先用 config.js 裡的值；若還是 placeholder，改用 setup 畫面存在本機的那份。 */
export function resolveConfig() {
  if (!isConfigPlaceholder(bundledConfig)) return bundledConfig;
  try {
    const raw = localStorage.getItem(LS_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!isConfigPlaceholder(parsed)) return parsed;
    }
  } catch (_) {
    /* localStorage 可能被瀏覽器封鎖，忽略 */
  }
  return null;
}

export function saveLocalConfig(cfg) {
  localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(cfg));
}

let app = null;
let auth = null;
let db = null;

export function initFirebase(cfg) {
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
  return { app, auth, db };
}

export const getAuthInstance = () => auth;
export const getDb = () => db;

/* ---------------- Auth ---------------- */

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    // 彈窗被瀏覽器擋掉（常見於 iOS Safari / 內嵌瀏覽器）時改用 redirect
    const fallback = [
      "auth/popup-blocked",
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/operation-not-supported-in-this-environment",
    ];
    if (fallback.includes(err?.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

export const signOutUser = () => fbSignOut(auth);
export const consumeRedirectResult = () => getRedirectResult(auth);

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

/* 讓其他模組共用同一份 Firestore API，不必各自從 CDN import */
export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
};
