import { initializeApp } from "./vendor/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "./vendor/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "./vendor/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDh_T9P1-_oNfCO44GHTTBCZqNibUmI1U4",
  authDomain: "q-path.firebaseapp.com",
  projectId: "q-path",
  storageBucket: "q-path.firebasestorage.app",
  messagingSenderId: "14142318406",
  appId: "1:14142318406:web:4def7b3161b447af01a747",
  measurementId: "G-6LJXNBX2LW",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const collectionName = "jukenbansoSpaces";
const storedCodeKey = "jukenbanso-cloud-personal-code-v1";
const syncInput = document.getElementById("personal-code-input");
const createButton = document.getElementById("create-cloud-code");
const openButton = document.getElementById("open-cloud-code");
const saveButton = document.getElementById("save-cloud-code");

let activeCode = localStorage.getItem(storedCodeKey) || "";
let activeDocId = "";
let readyPromise;
let saveTimer = 0;
let lastSavedBody = "";

if (activeCode) syncInput.value = formatPersonalCode(activeCode);

createButton.addEventListener("click", createCloudCodeImproved);
openButton.addEventListener("click", () => openCloudCode(syncInput.value));
saveButton.addEventListener("click", () => saveCloudSnapshot({ force: true }));
window.addEventListener("jukenbanso:planner-saved", scheduleCloudSave);
window.addEventListener("jukenbanso:theme-saved", scheduleCloudSave);

ensureFirebaseReady()
  .then(async () => {
    setStatus(activeCode ? "前回の個人コードを確認しています。" : "個人コードを作成、または入力できます。");
    if (activeCode) await openCloudCode(activeCode, { quiet: true });
  })
  .catch((error) => {
    console.error(error);
    setStatus("オンライン同期を開始できませんでした。Firebaseの設定を確認してください。");
  });

function ensureFirebaseReady() {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        unsubscribe();
        resolve(user);
        return;
      }

      try {
        await signInAnonymously(auth);
      } catch (error) {
        unsubscribe();
        reject(error);
      }
    });
  });

  return readyPromise;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createCloudCode() {
  await ensureFirebaseReady();
  const code = generatePersonalCode();
  await connectToCode(code);
  await saveCloudSnapshot({ force: true });
  syncInput.value = formatPersonalCode(code);

  try {
    await navigator.clipboard.writeText(formatPersonalCode(code));
    setStatus(`個人コード ${formatPersonalCode(code)} を作成し、コピーしました。`);
  } catch {
    setStatus(`個人コード ${formatPersonalCode(code)} を作成しました。別端末でこのコードを開いてください。`);
  }
}

async function createCloudCodeImproved() {
  const code = generatePersonalCode();
  const formattedCode = formatPersonalCode(code);
  syncInput.value = formattedCode;
  syncInput.select();
  setStatus(`個人コード ${formattedCode} を作成しました。オンライン保存を試しています。`);
  await connectToCode(code);

  try {
    await navigator.clipboard.writeText(formattedCode);
  } catch {
    // Clipboard access may be blocked; the code is still visible in the input.
  }

  try {
    await saveCloudSnapshot({ force: true });
    setStatus(`個人コード ${formattedCode} を作成して同期しました。別端末ではこのコードを開いてください。`);
  } catch (error) {
    console.error(error);
    setStatus(
      `個人コード ${formattedCode} は作成しましたが、オンライン保存に失敗しました。Firebaseの許可設定を確認してから「今すぐ同期」を押してください。`,
    );
  }
}

async function openCloudCode(code, { quiet = false } = {}) {
  const normalized = normalizePersonalCode(code);
  if (!isValidPersonalCode(normalized)) {
    setStatus("個人コードの形式が正しくありません。");
    return;
  }

  await ensureFirebaseReady();
  const docId = await hashPersonalCode(normalized);
  const snapshot = await getDoc(doc(db, collectionName, docId));
  if (!snapshot.exists()) {
    setStatus("この個人コードの保存データはまだありません。初回端末でコードを生成してください。");
    return;
  }

  const data = snapshot.data();
  if (data?.planner) window.jukenbansoApp.setPlanner(data.planner);
  if (data?.theme) window.jukenbansoApp.setTheme(data.theme);
  await connectToCode(normalized);
  lastSavedBody = currentSnapshotBody();
  syncInput.value = formatPersonalCode(normalized);
  if (!quiet) setStatus("個人コードのデータを読み込みました。以後、この端末の変更も同期されます。");
}

async function connectToCode(code) {
  activeCode = normalizePersonalCode(code);
  activeDocId = await hashPersonalCode(activeCode);
  localStorage.setItem(storedCodeKey, activeCode);
}

function scheduleCloudSave() {
  if (!activeCode) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveCloudSnapshot().catch((error) => {
      console.error(error);
      setStatus("変更の同期に失敗しました。通信状態を確認してください。");
    });
  }, 700);
}

async function saveCloudSnapshot({ force = false } = {}) {
  if (!activeCode || !activeDocId) {
    setStatus("先に個人コードを生成するか、既存コードを開いてください。");
    return;
  }

  await ensureFirebaseReady();
  const body = currentSnapshotBody();
  if (!force && body === lastSavedBody) return;

  const payload = JSON.parse(body);
  await setDoc(
    doc(db, collectionName, activeDocId),
    {
      ...payload,
      app: "jukenbanso",
      schemaVersion: 1,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  lastSavedBody = body;
  setStatus(`個人コード ${formatPersonalCode(activeCode)} に同期しました。`);
}

function currentSnapshotBody() {
  return JSON.stringify({
    planner: window.jukenbansoApp.getPlanner(),
    theme: window.jukenbansoApp.getTheme(),
  });
}

function setStatus(message) {
  window.jukenbansoApp.setStatus(message);
}

function normalizePersonalCode(code) {
  return String(code ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function formatPersonalCode(code) {
  const normalized = normalizePersonalCode(code);
  if (normalized.startsWith("JKB") && normalized.length === 11) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3, 7)}-${normalized.slice(7, 11)}`;
  }
  if (!normalized.startsWith("JUKEN") || normalized.length !== 17) return normalized;
  return `${normalized.slice(0, 5)}-${normalized.slice(5, 9)}-${normalized.slice(9, 13)}-${normalized.slice(13, 17)}`;
}

function isValidPersonalCode(code) {
  const normalized = normalizePersonalCode(code);
  return /^JKB[A-Z0-9]{8}$/.test(normalized) || /^JUKEN[A-Z0-9]{12}$/.test(normalized);
}

function generatePersonalCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  const values = crypto.getRandomValues(new Uint32Array(8));
  for (const value of values) body += alphabet[value % alphabet.length];
  return `JKB${body}`;
}

async function hashPersonalCode(code) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizePersonalCode(code)),
  );
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
