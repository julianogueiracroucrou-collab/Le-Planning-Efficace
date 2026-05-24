"use strict";

const STORAGE_KEY = "studyflow_v3";
const app = document.getElementById("app");
const toastContainer = document.getElementById("toastContainer");

let state = {
  currentUser: null,
  users: {}
};

let currentPage = "home";
let addType = "eval";
let listFilter = "tout";
let listQuery = "";
let listSort = "date";
let calendarCursor = new Date();
let selectedColor = "#7c6bff";
let pendingOTP = null;

let focus = {
  running: false,
  phase: "work",
  elapsed: 0,
  workMin: 25,
  pauseMin: 5,
  sessionsToday: 0,
  intervalId: null,
  presetId: null,
  subjectId: ""
};

const COLORS = ["#7c6bff", "#4ade80", "#fbbf24", "#f87171", "#60a5fa", "#f472b6", "#34d399", "#fb7185"];
const BADGES = [
  { id: "streak3", icon: "🔥", name: "3 jours", desc: "3 jours d'affilée" },
  { id: "streak7", icon: "🔥", name: "En feu", desc: "7 jours d'affilée" },
  { id: "hour1", icon: "⏱", name: "1ère heure", desc: "60 min de révision" },
  { id: "hour10", icon: "📚", name: "Studieux", desc: "10 h de révision" },
  { id: "focus10", icon: "🎯", name: "Focus master", desc: "10 sessions focus" },
  { id: "done5", icon: "✅", name: "Carré", desc: "5 tâches terminées" },
  { id: "done20", icon: "🏆", name: "Champion", desc: "20 tâches terminées" }
];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[ch]));
}

function toLocalISO(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return toLocalISO(new Date());
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntil(dateStr) {
  const now = new Date(`${todayStr()}T12:00:00`);
  const date = new Date(`${dateStr}T12:00:00`);
  return Math.round((date - now) / 86400000);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = migrateState(JSON.parse(raw));
  } catch {
    state = { currentUser: null, users: {} };
  }
}

function migrateState(data) {
  data.users ||= {};
  Object.values(data.users).forEach(user => {
    user.subjects ||= [];
    user.unitTypes ||= [];
    user.events ||= [];
    user.units ||= [];
    user.sessions ||= [];
    user.notes ||= [];
    user.focusPresets ||= [{ id: uid(), work: 25, pause: 5, label: "25/5" }];
    user.spacedrep ||= [];
    user.availability ||= { days: ["lundi", "mardi", "mercredi", "jeudi", "vendredi"], slots: ["soir"], maxSessionMin: 90 };
    user.settings ||= { theme: "dark", notifications: false, dndMode: false };
    user.stats ||= { totalMinutes: 0, dailyMinutes: {}, streak: 0, lastActiveDate: null, badgesEarned: [] };
  });
  return data;
}

function getUser() {
  return state.currentUser ? state.users[state.currentUser] : null;
}

function updateUser(fn) {
  const user = getUser();
  if (!user) return;
  fn(user);
  saveState();
  applyTheme();
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function defaultUserData(username, email) {
  const subjects = [
    { id: uid(), name: "Mathématiques", color: "#7c6bff", coeff: 3 },
    { id: uid(), name: "Histoire", color: "#4ade80", coeff: 2 },
    { id: uid(), name: "Anglais", color: "#fbbf24", coeff: 2 },
    { id: uid(), name: "Physique", color: "#60a5fa", coeff: 3 }
  ];
  return {
    username,
    email,
    avatar: username.slice(0, 2).toUpperCase(),
    createdAt: Date.now(),
    subjects,
    unitTypes: [
      { id: uid(), name: "Flashcards", unit: "fiche", baseTime: 40, unitLabel: "s" },
      { id: uid(), name: "Définitions", unit: "définition", baseTime: 5, unitLabel: "min" },
      { id: uid(), name: "Plan de cours", unit: "page", baseTime: 15, unitLabel: "min" }
    ],
    diffCoeffs: { facile: 1, moyen: 1.5, difficile: 2 },
    availability: { days: ["lundi", "mardi", "mercredi", "jeudi", "vendredi"], slots: ["soir"], maxSessionMin: 90 },
    events: [],
    units: [],
    sessions: [],
    notes: [],
    focusPresets: [
      { id: uid(), work: 25, pause: 5, label: "25/5" },
      { id: uid(), work: 45, pause: 10, label: "45/10" },
      { id: uid(), work: 50, pause: 15, label: "50/15" }
    ],
    spacedrep: [],
    stats: { totalMinutes: 0, dailyMinutes: {}, streak: 0, lastActiveDate: null, badgesEarned: [] },
    settings: { theme: "dark", notifications: false, dndMode: false }
  };
}

function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = "slideOut .2s ease forwards";
    setTimeout(() => el.remove(), 220);
  }, 3000);
}

function applyTheme() {
  const user = getUser();
  document.documentElement.dataset.theme = user?.settings?.theme === "light" ? "light" : "dark";
}

function icon(name) {
  const icons = {
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>`,
    list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    timer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 3 5"/><path d="m19 3 2 2"/><path d="M12 2v3"/></svg>`,
    stats: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`,
    share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`
  };
  return icons[name] || "";
}

function subjectOptions(selected = "") {
  const user = getUser();
  return (user?.subjects || []).map(s => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}

function getSubject(user, id) {
  return (user.subjects || []).find(s => s.id === id);
}

function subjectName(user, id) {
  return getSubject(user, id)?.name || "Sans matière";
}

function subjectColor(user, id) {
  return getSubject(user, id)?.color || "#8b8ba3";
}

function calcUnitTime(user, typeId, quantity, difficulty) {
  const t = (user.unitTypes || []).find(x => x.id === typeId);
  if (!t) return 0;
  const coeff = user.diffCoeffs?.[difficulty] || 1;
  const seconds = t.unitLabel === "s" ? t.baseTime * quantity * coeff : t.baseTime * quantity * 60 * coeff;
  return Math.max(1, Math.round(seconds / 60));
}

function allItems(user) {
  return [
    ...(user.events || []).map(x => ({ ...x, _kind: x.type, _date: x.date, _title: x.title })),
    ...(user.units || []).map(x => ({ ...x, _kind: "unit", _date: x.dueDate, _title: x.name }))
  ];
}

function checkStreak(user) {
  const today = todayStr();
  if (user.stats.lastActiveDate === today) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const y = toLocalISO(yesterday);
  user.stats.streak = user.stats.lastActiveDate === y ? (user.stats.streak || 0) + 1 : 1;
  user.stats.lastActiveDate = today;
}

function checkBadges(user) {
  const earned = user.stats.badgesEarned ||= [];
  const add = id => {
    if (!earned.includes(id)) {
      earned.push(id);
      toast("Badge débloqué !", "success");
    }
  };
  const done = allItems(user).filter(x => x.done).length;
  if ((user.stats.streak || 0) >= 3) add("streak3");
  if ((user.stats.streak || 0) >= 7) add("streak7");
  if ((user.stats.totalMinutes || 0) >= 60) add("hour1");
  if ((user.stats.totalMinutes || 0) >= 600) add("hour10");
  if ((user.sessions || []).length >= 10) add("focus10");
  if (done >= 5) add("done5");
  if (done >= 20) add("done20");
}

function addMinutes(user, minutes, subjectId = "") {
  const t = todayStr();
  user.stats.totalMinutes = (user.stats.totalMinutes || 0) + minutes;
  user.stats.dailyMinutes ||= {};
  user.stats.dailyMinutes[t] = (user.stats.dailyMinutes[t] || 0) + minutes;
  user.sessions ||= [];
  user.sessions.push({ id: uid(), date: t, duration: minutes, subjectId, type: "manual" });
  checkStreak(user);
  checkBadges(user);
}

function notify(title, body) {
  const user = getUser();
  if (!user?.settings?.notifications || user.settings.dndMode) return;
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function renderApp() {
  const user = getUser();
  applyTheme();
  if (!user) {
    renderAuth();
    return;
  }

  app.innerHTML = `
    <main class="main-layout">
      ${["home", "list", "calendar", "focus", "stats", "profile"].map(page => `
        <section id="page-${page}" class="page ${page === currentPage ? "active" : ""}">
          <div id="${page}-content"></div>
        </section>
      `).join("")}
    </main>
    <nav class="bottom-nav">
      ${navButton("home", "Accueil", "home")}
      ${navButton("list", "Tâches", "list")}
      ${navButton("calendar", "Agenda", "calendar")}
      <button class="nav-fab" onclick="openAddModal()" aria-label="Ajouter">${icon("plus")}</button>
      ${navButton("focus", "Focus", "timer")}
      ${navButton("stats", "Stats", "stats")}
      ${navButton("profile", "Profil", "user")}
    </nav>
    ${renderModals()}
  `;
  renderPage(currentPage);
}

function navButton(page, label, iconName) {
  return `<button class="nav-item ${currentPage === page ? "active" : ""}" onclick="navigate('${page}')">${icon(iconName)}<span>${label}</span></button>`;
}

function navigate(page) {
  currentPage = page;
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === `page-${page}`));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  renderPage(page);
  renderApp();
}

function renderPage(page) {
  if (!getUser()) return;
  ({ home: renderHome, list: renderList, calendar: renderCalendar, focus: renderFocus, stats: renderStats, profile: renderProfile }[page] || renderHome)();
}

function renderModals() {
  return `
    ${modal("addModal", "Ajouter", `<div id="addModalBody"></div>`)}
    ${modal("unitModal", "Unité de révision", `<div id="unitModalBody"></div>`)}
    ${modal("noteModal", "Note rapide", `
      <div class="form-group"><label>Matière</label><select id="noteSubject">${subjectOptions()}</select></div>
      <div class="form-group"><label>Note</label><textarea id="noteText"></textarea></div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal('noteModal')">Annuler</button><button class="btn btn-primary" onclick="saveNote()">Enregistrer</button></div>
    `)}
    ${modal("shareModal", "Partager / importer", `<div id="shareBody"></div>`)}
    ${modal("srModal", "Répétition espacée", `<div id="srModalBody"></div>`)}
    ${modal("subjectModal", "Matière", `<div id="subjectModalBody"></div>`)}
  `;
}

function modal(id, title, body) {
  return `<div class="modal-overlay" id="${id}" onclick="overlayClose(event,'${id}')"><div class="modal">
    <div class="modal-header"><div class="modal-title">${title}</div><button class="modal-close" onclick="closeModal('${id}')">×</button></div>
    <div class="modal-body">${body}</div>
  </div></div>`;
}

function overlayClose(event, id) {
  if (event.target.id === id) closeModal(id);
}

function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}

function renderAuth(registerMode = false) {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo">Le Planning Efficace</div>
        <div class="auth-tagline">Planifie, révise, progresse.</div>
        <div class="auth-tabs">
          <button class="auth-tab ${registerMode ? "" : "active"}" onclick="renderAuth(false)">Connexion</button>
          <button class="auth-tab ${registerMode ? "active" : ""}" onclick="renderAuth(true)">Créer un compte</button>
        </div>
        ${registerMode ? registerHTML() : loginHTML()}
      </div>
    </div>
  `;
}

function loginHTML() {
  return `
    <div class="form-group"><label>Email ou nom d'utilisateur</label><input id="loginId" autocomplete="username"></div>
    <div class="form-group"><label>Mot de passe</label><input id="loginPass" type="password" autocomplete="current-password"></div>
    <button class="btn btn-primary btn-full" onclick="loginWithPassword()">Se connecter</button>
    <div class="divider"></div>
    <div class="form-group"><label>Connexion par code email simulé</label><input id="otpEmail" type="email" placeholder="votre@email.com"></div>
    <button class="btn btn-secondary btn-full" onclick="sendOTP()">Recevoir un code</button>
    <div id="otpBox"></div>
  `;
}

function registerHTML() {
  return `
    <div class="form-group"><label>Nom d'utilisateur</label><input id="regUsername" autocomplete="username"></div>
    <div class="form-group"><label>Email</label><input id="regEmail" type="email" autocomplete="email"></div>
    <div class="form-group"><label>Mot de passe</label><input id="regPass" type="password" autocomplete="new-password"></div>
    <button class="btn btn-primary btn-full" onclick="register()">Créer mon espace</button>
  `;
}

async function register() {
  const username = document.getElementById("regUsername").value.trim();
  const email = document.getElementById("regEmail").value.trim().toLowerCase();
  const pass = document.getElementById("regPass").value;
  if (!username || !email || pass.length < 6) return toast("Mot de passe de 6 caractères minimum.", "error");
  if (Object.values(state.users).some(u => u.username === username || u.email === email)) return toast("Compte déjà existant.", "error");
  const id = uid();
  state.users[id] = defaultUserData(username, email);
  state.users[id].passwordHash = await sha256(pass);
  state.currentUser = id;
  saveState();
  currentPage = "home";
  renderApp();
  toast(`Bienvenue ${username} !`, "success");
}

async function loginWithPassword() {
  const id = document.getElementById("loginId").value.trim().toLowerCase();
  const pass = document.getElementById("loginPass").value;
  const pair = Object.entries(state.users).find(([, u]) => u.username.toLowerCase() === id || u.email.toLowerCase() === id);
  if (!pair) return toast("Compte introuvable.", "error");
  if (pair[1].passwordHash && pair[1].passwordHash !== await sha256(pass)) return toast("Mot de passe incorrect.", "error");
  state.currentUser = pair[0];
  saveState();
  currentPage = "home";
  renderApp();
  toast(`Bon retour ${pair[1].username} !`, "success");
}

function sendOTP() {
  const email = document.getElementById("otpEmail").value.trim().toLowerCase();
  if (!email) return toast("Entre ton email.", "error");
  pendingOTP = { email, code: String(Math.floor(100000 + Math.random() * 900000)), expiresAt: Date.now() + 5 * 60 * 1000 };
  document.getElementById("otpBox").innerHTML = `
    <div class="divider"></div>
    <div class="card" style="background:var(--green-bg);border-color:rgba(74,222,128,.25)">
      <div class="muted">Simulation email : ton code est <strong>${pendingOTP.code}</strong></div>
    </div>
    <div class="form-group" style="margin-top:12px"><label>Code reçu</label><input id="otpCode" maxlength="6" style="letter-spacing:4px;text-align:center;font-size:22px"></div>
    <button class="btn btn-primary btn-full" onclick="verifyOTP()">Vérifier</button>
  `;
}

function verifyOTP() {
  const code = document.getElementById("otpCode").value.trim();
  if (!pendingOTP || pendingOTP.expiresAt < Date.now() || code !== pendingOTP.code) return toast("Code incorrect ou expiré.", "error");
  let userId = Object.keys(state.users).find(k => state.users[k].email === pendingOTP.email);
  if (!userId) {
    userId = uid();
    state.users[userId] = defaultUserData(pendingOTP.email.split("@")[0], pendingOTP.email);
  }
  state.currentUser = userId;
  saveState();
  currentPage = "home";
  renderApp();
  toast("Connexion réussie.", "success");
}

function logout() {
  state.currentUser = null;
  saveState();
  renderApp();
}

function renderHome() {
  const user = getUser();
  const today = todayStr();
  const itemsToday = allItems(user).filter(x => x._date === today);
  const done = itemsToday.filter(x => x.done).length;
  const pct = itemsToday.length ? Math.round(done / itemsToday.length * 100) : 0;
  const upcoming = allItems(user).filter(x => !x.done && x._date >= today).sort((a, b) => a._date.localeCompare(b._date)).slice(0, 8);
  const alerts = upcoming.filter(x => daysUntil(x._date) <= 3);
  const dateFmt = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const greeting = new Date().getHours() < 12 ? "Bonjour" : new Date().getHours() < 18 ? "Bon après-midi" : "Bonsoir";

  document.getElementById("home-content").innerHTML = `
    <div class="page-header">
      <div><div class="page-title">${greeting}, ${esc(user.username)}</div><div class="page-subtitle">${esc(dateFmt)}</div></div>
      <button class="btn btn-ghost icon-btn" onclick="navigate('profile')" title="Profil"><span class="avatar" style="width:30px;height:30px;font-size:12px">${esc(user.avatar)}</span></button>
    </div>
    <div class="desktop-grid">
      <div class="stack">
        ${alerts.length ? `<div class="card" style="background:var(--amber-bg);border-color:rgba(251,191,36,.25);color:var(--amber)">Attention : ${alerts.length} échéance(s) dans les 3 prochains jours.</div>` : ""}
        <div class="today-header">
          <div class="tiny">AUJOURD'HUI</div>
          <div class="page-title" style="font-size:21px">${itemsToday.length ? `${done} / ${itemsToday.length} tâches accomplies` : "Journée libre"}</div>
          <div class="muted">${pct}% complété</div>
          <div class="progress-wrap"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="week-strip">${renderWeekStrip()}</div>
        <div class="section-label">À venir</div>
        <div class="card compact">${upcoming.length ? upcoming.map(renderEventRow).join("") : empty("Rien à venir")}</div>
      </div>
      <div class="stack">
        <div class="section-label" style="margin-top:0">Actions rapides</div>
        <div class="grid-2">
          <button class="btn btn-primary btn-full" onclick="openAddModal()">${icon("plus")} Ajouter</button>
          <button class="btn btn-secondary btn-full" onclick="openUnitModal()">Révision</button>
          <button class="btn btn-ghost btn-full" onclick="openNoteModal()">Note</button>
          <button class="btn btn-ghost btn-full" onclick="openShareModal()">${icon("share")} Partager</button>
        </div>
        <div class="section-label">Unités récentes</div>
        <div class="card compact">${renderUnitsList()}</div>
      </div>
    </div>
  `;
}

function renderWeekStrip() {
  const today = new Date();
  const names = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const items = allItems(getUser());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = toLocalISO(d);
    const has = items.some(x => x._date === iso);
    return `<div class="week-day ${iso === todayStr() ? "today" : ""}">
      <div class="week-day-name">${names[d.getDay()]}</div>
      <div class="week-day-num">${d.getDate()}</div>
      ${has ? `<span class="calendar-dot" style="background:var(--accent)"></span>` : ""}
    </div>`;
  }).join("");
}

function renderEventRow(item) {
  const user = getUser();
  const d = daysUntil(item._date);
  const dLabel = d === 0 ? "Aujourd'hui" : d === 1 ? "Demain" : d < 0 ? `Retard ${Math.abs(d)}j` : `Dans ${d}j`;
  const color = subjectColor(user, item.subjectId);
  const kindLabel = { eval: "Éval", devoir: "Devoir", rdv: "RDV", unit: "Révision" }[item._kind] || "Tâche";
  const badge = { eval: "badge-red", devoir: "badge-amber", rdv: "badge-blue", unit: "badge-purple" }[item._kind] || "badge-purple";
  return `<div class="event-item">
    <span class="event-dot" style="background:${esc(color)}"></span>
    <div class="event-info">
      <div class="event-name">${esc(item._title || "Sans titre")}</div>
      <div class="event-meta"><span>${esc(subjectName(user, item.subjectId))}</span><span class="badge ${badge}">${kindLabel}</span></div>
    </div>
    <div class="event-time">${dLabel}</div>
  </div>`;
}

function empty(text) {
  return `<div class="empty-state"><div class="empty-state-icon">✓</div><div>${esc(text)}</div></div>`;
}

function renderUnitsList() {
  const user = getUser();
  const units = (user.units || []).slice(-5).reverse();
  if (!units.length) return empty("Aucune unité créée");
  return units.map(u => {
    const t = user.unitTypes.find(x => x.id === u.typeId);
    const min = calcUnitTime(user, u.typeId, u.quantity, u.difficulty);
    return `<div class="event-item">
      <span class="event-dot" style="background:${esc(subjectColor(user, u.subjectId))}"></span>
      <div class="event-info">
        <div class="event-name">${esc(u.name)}</div>
        <div class="event-meta">${esc(t?.name || "Type supprimé")} · ${esc(u.quantity)} ${esc(t?.unit || "")} · ~${min}min ${u.done ? `<span class="badge badge-green">Terminé</span>` : ""}</div>
      </div>
      <button class="btn btn-ghost btn-sm icon-btn" onclick="openUnitModal('${esc(u.id)}')" title="Modifier">${icon("edit")}</button>
    </div>`;
  }).join("");
}

function openAddModal(editId = "", kind = "") {
  addType = kind && kind !== "unit" ? kind : "eval";
  renderAddModal(editId, kind);
  openModal("addModal");
}

function renderAddModal(editId = "", kind = "") {
  const user = getUser();
  const editing = kind && kind !== "unit" ? user.events.find(e => e.id === editId) : null;
  const type = editing?.type || addType;
  addType = type;
  const types = [
    { id: "eval", icon: "📝", label: "Évaluation" },
    { id: "devoir", icon: "📋", label: "Devoir" },
    { id: "rdv", icon: "📅", label: "RDV" }
  ];
  const fields = {
    eval: `
      <div class="form-group"><label>Matière</label><select id="evSubject">${subjectOptions(editing?.subjectId)}</select></div>
      <div class="form-group"><label>Type</label><select id="evSubtype">${["Contrôle","Examen","Oral","Partiel","Dissertation","TP"].map(x => `<option ${editing?.subtype === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="form-group"><label>Titre</label><input id="evTitle" value="${esc(editing?.title || "")}"></div>
      <div class="form-group"><label>Date</label><input id="evDate" type="date" value="${esc(editing?.date || todayStr())}"></div>
      <div class="form-group"><label>Coefficient</label><input id="evCoeff" type="number" min="1" max="10" value="${esc(editing?.coeff || 1)}"></div>
      <div class="form-group"><label>Note perso</label><input id="evNote" value="${esc(editing?.note || "")}"></div>
    `,
    devoir: `
      <div class="form-group"><label>Matière</label><select id="dvSubject">${subjectOptions(editing?.subjectId)}</select></div>
      <div class="form-group"><label>Titre</label><input id="dvTitle" value="${esc(editing?.title || "")}"></div>
      <div class="form-group"><label>Date de rendu</label><input id="dvDate" type="date" value="${esc(editing?.date || todayStr())}"></div>
      <div class="form-group"><label>Priorité</label><select id="dvPriority">${["haute","moyenne","basse"].map(x => `<option value="${x}" ${editing?.priority === x || (!editing && x === "moyenne") ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="form-group"><label>Temps estimé (min)</label><input id="dvTime" type="number" min="5" value="${esc(editing?.estimatedTime || 60)}"></div>
    `,
    rdv: `
      <div class="form-group"><label>Titre</label><input id="rdvTitle" value="${esc(editing?.title || "")}"></div>
      <div class="form-group"><label>Catégorie</label><select id="rdvCat">${["Médecin","Sport","Perso","Autre"].map(x => `<option ${editing?.category === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="form-group"><label>Date</label><input id="rdvDate" type="date" value="${esc(editing?.date || todayStr())}"></div>
      <div class="form-group"><label>Heure</label><input id="rdvTime" type="time" value="${esc(editing?.time || "14:00")}"></div>
      <div class="form-group"><label>Durée (min)</label><input id="rdvDuration" type="number" min="5" value="${esc(editing?.duration || 60)}"></div>
    `
  };
  document.getElementById("addModalBody").innerHTML = `
    <div class="type-grid">${types.map(t => `<div class="type-card ${t.id === type ? "active" : ""}" onclick="selectAddType('${t.id}','${esc(editId)}','${esc(kind)}')"><div class="type-icon">${t.icon}</div><div>${t.label}</div></div>`).join("")}</div>
    ${fields[type]}
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal('addModal')">Annuler</button><button class="btn btn-primary" onclick="saveEvent('${esc(editId)}')">${editId ? "Mettre à jour" : "Ajouter"}</button></div>
  `;
}

function selectAddType(type, editId = "", kind = "") {
  addType = type;
  renderAddModal(editId, kind);
}

function saveEvent(editId = "") {
  let event = { id: editId || uid(), type: addType, done: false, createdAt: Date.now() };
  if (editId) event = { ...(getUser().events.find(e => e.id === editId) || event), type: addType };

  if (addType === "eval") {
    const title = document.getElementById("evTitle").value.trim();
    if (!title) return toast("Entre un titre.", "error");
    Object.assign(event, {
      subjectId: document.getElementById("evSubject").value,
      title,
      subtype: document.getElementById("evSubtype").value,
      date: document.getElementById("evDate").value,
      coeff: Number(document.getElementById("evCoeff").value) || 1,
      note: document.getElementById("evNote").value.trim()
    });
  }
  if (addType === "devoir") {
    const title = document.getElementById("dvTitle").value.trim();
    if (!title) return toast("Entre un titre.", "error");
    Object.assign(event, {
      subjectId: document.getElementById("dvSubject").value,
      title,
      date: document.getElementById("dvDate").value,
      priority: document.getElementById("dvPriority").value,
      estimatedTime: Number(document.getElementById("dvTime").value) || 60
    });
  }
  if (addType === "rdv") {
    const title = document.getElementById("rdvTitle").value.trim();
    if (!title) return toast("Entre un titre.", "error");
    Object.assign(event, {
      subjectId: "",
      title,
      category: document.getElementById("rdvCat").value,
      date: document.getElementById("rdvDate").value,
      time: document.getElementById("rdvTime").value,
      duration: Number(document.getElementById("rdvDuration").value) || 60
    });
  }

  updateUser(user => {
    const index = user.events.findIndex(e => e.id === event.id);
    if (index >= 0) user.events[index] = event;
    else {
      user.events.push(event);
      if (event.type === "eval") autoRevisionPlan(user, event);
    }
  });
  closeModal("addModal");
  toast(editId ? "Élément modifié." : "Élément ajouté.", "success");
  renderPage(currentPage);
}

function autoRevisionPlan(user, ev) {
  const diff = Math.max(1, daysUntil(ev.date));
  const sessions = Math.min(diff, 5);
  const typeId = user.unitTypes[2]?.id || user.unitTypes[0]?.id || "";
  for (let i = sessions; i >= 1; i--) {
    const d = new Date(`${ev.date}T12:00:00`);
    d.setDate(d.getDate() - i);
    user.units.push({
      id: uid(),
      subjectId: ev.subjectId,
      typeId,
      name: `Révision ${ev.title}`,
      quantity: 5,
      difficulty: "moyen",
      dueDate: toLocalISO(d),
      done: false,
      linkedEval: ev.id,
      autoGenerated: true,
      createdAt: Date.now()
    });
  }
}

function openUnitModal(editId = "") {
  const user = getUser();
  const unit = user.units.find(u => u.id === editId);
  const typeOptions = user.unitTypes.map(t => `<option value="${esc(t.id)}" ${unit?.typeId === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  document.getElementById("unitModalBody").innerHTML = `
    <div class="form-group"><label>Matière</label><select id="uSubject">${subjectOptions(unit?.subjectId)}</select></div>
    <div class="form-group"><label>Type de contenu</label><select id="uType" onchange="calcEstimate()">${typeOptions}</select></div>
    <div class="form-group"><label>Nom / chapitre</label><input id="uName" value="${esc(unit?.name || "")}" placeholder="Chapitre 3"></div>
    <div class="form-group"><label>Quantité</label><input id="uQty" type="number" min="1" value="${esc(unit?.quantity || 10)}" oninput="calcEstimate()"></div>
    <div class="form-group"><label>Difficulté</label><select id="uDiff" onchange="calcEstimate()">${["facile","moyen","difficile"].map(x => `<option value="${x}" ${unit?.difficulty === x || (!unit && x === "moyen") ? "selected" : ""}>${x}</option>`).join("")}</select></div>
    <div class="form-group"><label>Date limite</label><input id="uDate" type="date" value="${esc(unit?.dueDate || "")}"></div>
    <div class="card" style="background:var(--accent-bg);border-color:rgba(124,107,255,.3)"><div class="tiny">Temps estimé</div><div id="uEstimate" class="page-title" style="font-size:22px">-</div></div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal('unitModal')">Annuler</button><button class="btn btn-primary" onclick="saveUnit('${esc(editId)}')">Enregistrer</button></div>
  `;
  calcEstimate();
  openModal("unitModal");
}

function calcEstimate() {
  const user = getUser();
  const min = calcUnitTime(user, document.getElementById("uType")?.value, Number(document.getElementById("uQty")?.value) || 1, document.getElementById("uDiff")?.value || "moyen");
  const el = document.getElementById("uEstimate");
  if (el) el.textContent = min < 60 ? `~${min} min` : `~${Math.floor(min / 60)}h ${min % 60}min`;
}

function saveUnit(editId = "") {
  const unit = {
    id: editId || uid(),
    subjectId: document.getElementById("uSubject").value,
    typeId: document.getElementById("uType").value,
    name: document.getElementById("uName").value.trim() || "Révision",
    quantity: Number(document.getElementById("uQty").value) || 1,
    difficulty: document.getElementById("uDiff").value,
    dueDate: document.getElementById("uDate").value,
    done: false,
    createdAt: Date.now()
  };
  updateUser(user => {
    const old = user.units.find(u => u.id === editId);
    if (old) Object.assign(unit, { done: old.done, createdAt: old.createdAt, autoGenerated: old.autoGenerated, linkedEval: old.linkedEval });
    const index = user.units.findIndex(u => u.id === unit.id);
    if (index >= 0) user.units[index] = unit;
    else user.units.push(unit);
  });
  closeModal("unitModal");
  toast("Unité enregistrée.", "success");
  renderPage(currentPage);
}

function renderList() {
  const user = getUser();
  const filters = [
    ["tout", "Tout"], ["eval", "Évals"], ["devoir", "Devoirs"], ["rdv", "RDV"], ["unit", "Révisions"], ["afaire", "À faire"], ["termine", "Terminés"]
  ];
  let items = allItems(user);
  if (listFilter === "afaire") items = items.filter(i => !i.done);
  else if (listFilter === "termine") items = items.filter(i => i.done);
  else if (listFilter !== "tout") items = items.filter(i => i._kind === listFilter);
  const q = listQuery.toLowerCase();
  if (q) items = items.filter(i => `${i._title} ${subjectName(user, i.subjectId)} ${i.note || ""}`.toLowerCase().includes(q));
  items.sort((a, b) => {
    if (listSort === "priority") return priorityRank(a.priority) - priorityRank(b.priority);
    if (listSort === "subject") return subjectName(user, a.subjectId).localeCompare(subjectName(user, b.subjectId));
    return (a._date || "9999").localeCompare(b._date || "9999");
  });

  document.getElementById("list-content").innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Mes tâches</div><div class="page-subtitle">${items.filter(i => !i.done).length} à faire</div></div>
      <button class="btn btn-secondary btn-sm" onclick="openShareModal()">${icon("share")} Partager</button>
    </div>
    <div class="toolbar">
      <input class="toolbar-input" value="${esc(listQuery)}" oninput="listQuery=this.value;renderList()" placeholder="Rechercher...">
      <select class="toolbar-input" onchange="listSort=this.value;renderList()">
        ${[["date","Date"],["priority","Priorité"],["subject","Matière"]].map(([v,l]) => `<option value="${v}" ${listSort === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <button class="btn btn-primary" onclick="openAddModal()">${icon("plus")} Ajouter</button>
    </div>
    <div class="filter-row">${filters.map(([id, label]) => `<button class="filter-chip ${listFilter === id ? "active" : ""}" onclick="listFilter='${id}';renderList()">${label}</button>`).join("")}</div>
    <div class="card compact">${items.length ? items.map(renderListItem).join("") : empty("Aucun élément ici")}</div>
    <div class="section-label">Notes rapides</div>
    <button class="btn btn-ghost btn-full" onclick="openNoteModal()">Ajouter une note</button>
    <div class="card compact" style="margin-top:10px">${renderNotes()}</div>
  `;
}

function priorityRank(p) {
  return { haute: 0, moyenne: 1, basse: 2 }[p] ?? 3;
}

function renderListItem(item) {
  const user = getUser();
  const color = subjectColor(user, item.subjectId);
  const min = item._kind === "unit" ? calcUnitTime(user, item.typeId, item.quantity, item.difficulty) : item.estimatedTime;
  const late = item._date && daysUntil(item._date) < 0 && !item.done;
  return `<div class="list-item" style="${item.done ? "opacity:.56" : ""}">
    <button class="checkbox ${item.done ? "checked" : ""}" onclick="toggleItem('${esc(item.id)}','${esc(item._kind)}')" title="Terminer">${item.done ? "✓" : ""}</button>
    <div class="list-info">
      <div class="list-name ${item.done ? "done" : ""}">${esc(item._title || "Sans titre")}</div>
      <div class="list-meta">
        <span style="background:${esc(color)}22;color:${esc(color)};padding:2px 7px;border-radius:999px">${esc(subjectName(user, item.subjectId))}</span>
        <span>${esc(kindLabel(item._kind))}</span>
        ${item.priority ? `<span>${esc(item.priority)}</span>` : ""}
        ${item._date ? `<span style="color:${late ? "var(--red)" : "var(--text3)"}">${late ? "En retard · " : ""}${formatDate(item._date)}</span>` : ""}
        ${min ? `<span>~${esc(min)}min</span>` : ""}
      </div>
    </div>
    <div class="list-actions">
      <button class="btn btn-ghost btn-sm icon-btn" onclick="${item._kind === "unit" ? `openUnitModal('${esc(item.id)}')` : `openAddModal('${esc(item.id)}','${esc(item._kind)}')`}" title="Modifier">${icon("edit")}</button>
      <button class="btn btn-danger btn-sm icon-btn" onclick="deleteItem('${esc(item.id)}','${esc(item._kind)}')" title="Supprimer">${icon("trash")}</button>
    </div>
  </div>`;
}

function kindLabel(kind) {
  return { eval: "Éval", devoir: "Devoir", rdv: "RDV", unit: "Révision" }[kind] || "Tâche";
}

function toggleItem(id, kind) {
  updateUser(user => {
    const arr = kind === "unit" ? user.units : user.events;
    const item = arr.find(x => x.id === id);
    if (!item) return;
    item.done = !item.done;
    if (item.done) addMinutes(user, kind === "unit" ? calcUnitTime(user, item.typeId, item.quantity, item.difficulty) : 5, item.subjectId);
  });
  renderPage(currentPage);
}

function deleteItem(id, kind) {
  if (!confirm("Supprimer cet élément ?")) return;
  updateUser(user => {
    if (kind === "unit") user.units = user.units.filter(x => x.id !== id);
    else user.events = user.events.filter(x => x.id !== id);
  });
  toast("Supprimé.", "info");
  renderPage(currentPage);
}

function openNoteModal(noteId = "") {
  const note = getUser().notes.find(n => n.id === noteId);
  document.getElementById("noteSubject").value = note?.subjectId || focus.subjectId || getUser().subjects[0]?.id || "";
  document.getElementById("noteText").value = note?.text || "";
  document.getElementById("noteModal").dataset.editId = noteId;
  openModal("noteModal");
}

function saveNote() {
  const subjectId = document.getElementById("noteSubject").value;
  const text = document.getElementById("noteText").value.trim();
  const editId = document.getElementById("noteModal").dataset.editId;
  if (!text) return toast("Entre une note.", "error");
  updateUser(user => {
    const note = { id: editId || uid(), subjectId, text, createdAt: editId ? (user.notes.find(n => n.id === editId)?.createdAt || todayStr()) : todayStr() };
    const index = user.notes.findIndex(n => n.id === note.id);
    if (index >= 0) user.notes[index] = note;
    else user.notes.push(note);
  });
  closeModal("noteModal");
  renderPage(currentPage);
  toast("Note enregistrée.", "success");
}

function renderNotes() {
  const user = getUser();
  const notes = (user.notes || []).slice(-8).reverse();
  if (!notes.length) return empty("Aucune note");
  return notes.map(n => `<div class="note-item">
    <div class="list-info"><div>${esc(n.text)}</div><div class="tiny">${esc(subjectName(user, n.subjectId))} · ${formatDate(n.createdAt)}</div></div>
    <button class="btn btn-ghost btn-sm icon-btn" onclick="openNoteModal('${esc(n.id)}')">${icon("edit")}</button>
    <button class="btn btn-danger btn-sm icon-btn" onclick="deleteNote('${esc(n.id)}')">${icon("trash")}</button>
  </div>`).join("");
}

function deleteNote(id) {
  updateUser(user => user.notes = user.notes.filter(n => n.id !== id));
  renderPage(currentPage);
}

function renderCalendar() {
  const user = getUser();
  const start = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const first = new Date(start);
  first.setDate(1 - ((start.getDay() + 6) % 7));
  const monthLabel = start.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const items = allItems(user);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    const iso = toLocalISO(d);
    const dayItems = items.filter(x => x._date === iso);
    return `<div class="calendar-cell ${iso === todayStr() ? "today" : ""}" style="${d.getMonth() !== start.getMonth() ? "opacity:.45" : ""}">
      <div class="calendar-num">${d.getDate()}</div>
      ${dayItems.slice(0, 3).map(x => `<div class="tiny"><span class="calendar-dot" style="background:${esc(subjectColor(user, x.subjectId))}"></span>${esc(x._title || "Sans titre")}</div>`).join("")}
      ${dayItems.length > 3 ? `<div class="tiny">+${dayItems.length - 3}</div>` : ""}
    </div>`;
  }).join("");
  document.getElementById("calendar-content").innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Agenda</div><div class="page-subtitle">${esc(monthLabel)}</div></div>
      <div class="row"><button class="btn btn-ghost btn-sm" onclick="moveCalendar(-1)">←</button><button class="btn btn-ghost btn-sm" onclick="moveCalendar(1)">→</button></div>
    </div>
    <div class="week-strip" style="margin-bottom:7px">${["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(d => `<div class="tiny" style="text-align:center">${d}</div>`).join("")}</div>
    <div class="calendar-grid">${cells}</div>
  `;
}

function moveCalendar(delta) {
  calendarCursor.setMonth(calendarCursor.getMonth() + delta);
  renderCalendar();
}

function renderFocus() {
  const user = getUser();
  const firstPreset = user.focusPresets[0];
  if (!focus.presetId && firstPreset) {
    focus.presetId = firstPreset.id;
    focus.workMin = firstPreset.work;
    focus.pauseMin = firstPreset.pause;
  }
  const total = (focus.phase === "work" ? focus.workMin : focus.pauseMin) * 60;
  const remaining = Math.max(0, total - focus.elapsed);
  const r = 92;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - (focus.elapsed / total || 0));

  document.getElementById("focus-content").innerHTML = `
    ${user.settings.dndMode ? `<div class="card" style="background:var(--red-bg);border-color:rgba(248,113,113,.25);color:var(--red);margin-bottom:12px">${icon("bell")} Mode ne pas déranger activé</div>` : ""}
    <div class="page-header">
      <div><div class="page-title">Focus</div><div class="page-subtitle">Session ${focus.sessionsToday + 1} du jour</div></div>
      <button class="btn btn-ghost btn-sm" onclick="openNoteModal()">Note</button>
    </div>
    <div class="focus-center">
      <select class="toolbar-input" style="max-width:260px" onchange="focus.subjectId=this.value">
        <option value="">Choisir une matière</option>${subjectOptions(focus.subjectId)}
      </select>
      <div class="filter-row">${user.focusPresets.map(p => `<button class="filter-chip ${focus.presetId === p.id ? "active" : ""}" onclick="selectPreset('${esc(p.id)}')">${esc(p.label)}</button>`).join("")}</div>
      <div class="timer-ring">
        <svg width="230" height="230"><circle class="track" cx="115" cy="115" r="${r}"/><circle class="progress" cx="115" cy="115" r="${r}" stroke="${focus.phase === "work" ? "var(--accent)" : "var(--green)"}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/></svg>
        <div class="timer-display"><div class="timer-time">${formatTime(remaining)}</div><div class="muted">${focus.phase === "work" ? "Travail" : "Pause"}</div></div>
      </div>
      <div class="timer-controls">
        <button class="timer-btn secondary" onclick="resetTimer()" title="Réinitialiser">↺</button>
        <button class="timer-btn play" onclick="toggleTimer()">${focus.running ? "Ⅱ" : "▶"}</button>
        <button class="timer-btn secondary" onclick="skipPhase()" title="Passer">⏭</button>
      </div>
      <div class="session-dots">${Array.from({ length: 8 }, (_, i) => `<span class="session-dot ${i < focus.sessionsToday ? "done" : ""}"></span>`).join("")}</div>
    </div>
    <div class="section-label">Presets</div>
    <div class="card compact">${renderPresets()}</div>
    <button class="btn btn-ghost btn-full" onclick="addPreset()" style="margin-top:10px">Ajouter un preset</button>
  `;
}

function renderPresets() {
  const user = getUser();
  return user.focusPresets.map(p => `<div class="preset-item">
    <div class="list-info"><strong>${esc(p.label)}</strong><div class="tiny">${p.work}min travail / ${p.pause}min pause</div></div>
    <button class="btn btn-danger btn-sm icon-btn" onclick="deletePreset('${esc(p.id)}')">${icon("trash")}</button>
  </div>`).join("");
}

function selectPreset(id) {
  const p = getUser().focusPresets.find(x => x.id === id);
  if (!p) return;
  clearInterval(focus.intervalId);
  Object.assign(focus, { presetId: id, workMin: p.work, pauseMin: p.pause, elapsed: 0, phase: "work", running: false });
  renderFocus();
}

function toggleTimer() {
  focus.running = !focus.running;
  if (!focus.running) {
    clearInterval(focus.intervalId);
    renderFocus();
    return;
  }
  focus.intervalId = setInterval(() => {
    focus.elapsed++;
    const total = (focus.phase === "work" ? focus.workMin : focus.pauseMin) * 60;
    if (focus.elapsed >= total) finishPhase();
    renderFocus();
  }, 1000);
  renderFocus();
}

function finishPhase() {
  if (focus.phase === "work") {
    focus.sessionsToday++;
    updateUser(user => addMinutes(user, focus.workMin, focus.subjectId));
    focus.phase = "pause";
    notify("Le Planning Efficace", "Pause bien méritée.");
    toast("Pause !", "success");
  } else {
    focus.phase = "work";
    notify("Le Planning Efficace", "On repart au travail.");
    toast("Au travail !", "info");
  }
  focus.elapsed = 0;
}

function resetTimer() {
  clearInterval(focus.intervalId);
  Object.assign(focus, { running: false, elapsed: 0, phase: "work" });
  renderFocus();
}

function skipPhase() {
  clearInterval(focus.intervalId);
  Object.assign(focus, { running: false, elapsed: 0, phase: focus.phase === "work" ? "pause" : "work" });
  renderFocus();
}

function addPreset() {
  const work = Number(prompt("Durée de travail (min) ?", "25")) || 25;
  const pause = Number(prompt("Durée de pause (min) ?", "5")) || 5;
  updateUser(user => user.focusPresets.push({ id: uid(), work, pause, label: `${work}/${pause}` }));
  renderFocus();
}

function deletePreset(id) {
  updateUser(user => user.focusPresets = user.focusPresets.filter(p => p.id !== id));
  if (focus.presetId === id) focus.presetId = null;
  renderFocus();
}

function renderStats() {
  const user = getUser();
  const items = allItems(user);
  const total = user.stats.totalMinutes || 0;
  const done = items.filter(x => x.done).length;
  const completion = items.length ? Math.round(done / items.length * 100) : 0;
  const daily = user.stats.dailyMinutes || {};
  const heat = Array.from({ length: 90 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (89 - i));
    const k = toLocalISO(d);
    const m = daily[k] || 0;
    const level = m === 0 ? "" : m < 30 ? "h1" : m < 60 ? "h2" : m < 120 ? "h3" : "h4";
    return `<div class="heatmap-cell ${level}" title="${k}: ${m}min"></div>`;
  }).join("");
  const subjectTimes = {};
  user.sessions.forEach(s => { if (s.subjectId) subjectTimes[s.subjectId] = (subjectTimes[s.subjectId] || 0) + (s.duration || 0); });
  const max = Math.max(1, ...Object.values(subjectTimes));
  document.getElementById("stats-content").innerHTML = `
    <div class="page-header"><div><div class="page-title">Statistiques</div><div class="page-subtitle">Tes progrès en un coup d'œil</div></div><button class="btn btn-secondary btn-sm" onclick="exportStats()">${icon("download")} Export</button></div>
    <div class="grid-2">
      ${stat("Temps total", total >= 60 ? `${Math.floor(total / 60)}h ${total % 60}m` : `${total}m`, "de révision")}
      ${stat("Streak", `${user.stats.streak || 0}`, "jours consécutifs")}
      ${stat("Complétion", `${completion}%`, `${done}/${items.length} tâches`)}
      ${stat("Sessions", `${user.sessions.length}`, "focus et révisions")}
    </div>
    <div class="section-label">Activité</div><div class="card"><div class="heatmap">${heat}</div></div>
    <div class="section-label">Temps par matière</div><div class="card"><div class="bar-chart">${user.subjects.map(s => {
      const t = subjectTimes[s.id] || 0;
      return `<div class="bar-row"><div class="bar-label">${esc(s.name)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(t / max * 100)}%;background:${esc(s.color)}">${t ? `${t}m` : ""}</div></div></div>`;
    }).join("")}</div></div>
    <div class="section-label">Badges</div><div class="badge-grid">${BADGES.map(b => `<div class="badge-card ${(user.stats.badgesEarned || []).includes(b.id) ? "earned" : ""}"><div class="badge-icon">${b.icon}</div><div class="badge-name">${esc(b.name)}</div><div class="badge-desc">${esc(b.desc)}</div></div>`).join("")}</div>
  `;
}

function stat(label, value, sub) {
  return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
}

function exportStats() {
  const user = getUser();
  const payload = {
    exportedAt: new Date().toISOString(),
    user: { username: user.username, email: user.email },
    stats: user.stats,
    sessions: user.sessions,
    tasks: allItems(user)
  };
  downloadFile(`le-planning-efficace-stats-${todayStr()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function renderProfile() {
  const user = getUser();
  const days = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  const slots = ["matin", "après-midi", "soir"];
  document.getElementById("profile-content").innerHTML = `
    <div class="page-header"><div class="row"><div class="avatar">${esc(user.avatar)}</div><div><div class="page-title">${esc(user.username)}</div><div class="page-subtitle">${esc(user.email)}</div></div></div></div>
    <div class="settings-section"><div class="settings-title">Préférences</div><div class="card">
      ${settingToggle("Mode clair", user.settings.theme === "light", "toggleTheme()")}
      ${settingToggle("Notifications", user.settings.notifications, "toggleNotifications()")}
      ${settingToggle("Ne pas déranger", user.settings.dndMode, "toggleDnd()")}
    </div></div>
    <div class="settings-section"><div class="settings-title">Matières</div><div class="card compact">
      ${user.subjects.map(s => `<div class="subject-item"><span class="subject-dot" style="background:${esc(s.color)}"></span><div class="list-info"><strong>${esc(s.name)}</strong><div class="tiny">coeff. ${esc(s.coeff)}</div></div><button class="btn btn-ghost btn-sm icon-btn" onclick="openSubjectModal('${esc(s.id)}')">${icon("edit")}</button><button class="btn btn-danger btn-sm icon-btn" onclick="deleteSubject('${esc(s.id)}')">${icon("trash")}</button></div>`).join("")}
      <button class="btn btn-ghost btn-full" onclick="openSubjectModal()" style="margin-top:10px">Ajouter une matière</button>
    </div></div>
    <div class="settings-section"><div class="settings-title">Temps d'apprentissage</div><div class="card compact">
      ${user.unitTypes.map(t => `<div class="settings-row"><div><div class="settings-label">${esc(t.name)}</div><div class="settings-sub">${esc(t.unit)}</div></div><div class="row"><input class="toolbar-input" style="width:78px" type="number" value="${esc(t.baseTime)}" onchange="updateUnitType('${esc(t.id)}','baseTime',this.value)"><select class="toolbar-input" style="width:78px" onchange="updateUnitType('${esc(t.id)}','unitLabel',this.value)"><option ${t.unitLabel === "min" ? "selected" : ""}>min</option><option ${t.unitLabel === "s" ? "selected" : ""}>s</option></select><button class="btn btn-danger btn-sm icon-btn" onclick="deleteUnitType('${esc(t.id)}')">${icon("trash")}</button></div></div>`).join("")}
      <button class="btn btn-ghost btn-full" onclick="addUnitType()" style="margin-top:10px">Créer un type</button>
    </div></div>
    <div class="settings-section"><div class="settings-title">Disponibilités</div><div class="card">
      <div class="tiny" style="margin-bottom:7px">Jours disponibles</div><div class="filter-row">${days.map(d => `<button class="filter-chip ${user.availability.days.includes(d) ? "active" : ""}" onclick="toggleAvailability('days','${d}')">${d.slice(0,3)}</button>`).join("")}</div>
      <div class="tiny" style="margin:13px 0 7px">Créneaux préférés</div><div class="filter-row">${slots.map(s => `<button class="filter-chip ${user.availability.slots.includes(s) ? "active" : ""}" onclick="toggleAvailability('slots','${s}')">${s}</button>`).join("")}</div>
      <div class="settings-row"><div class="settings-label">Durée max / session</div><div class="row"><input class="toolbar-input" style="width:88px" type="number" value="${esc(user.availability.maxSessionMin)}" onchange="updateMaxSession(this.value)"> min</div></div>
    </div></div>
    <div class="settings-section"><div class="settings-title">Zone sensible</div><button class="btn btn-danger btn-full" onclick="deleteAccount()">Supprimer le compte</button></div>
  `;
}

function settingToggle(label, enabled, action) {
  return `<div class="settings-row"><div class="settings-label">${label}</div><button class="toggle ${enabled ? "on" : ""}" onclick="${action}"></button></div>`;
}

function toggleTheme() {
  updateUser(user => user.settings.theme = user.settings.theme === "light" ? "dark" : "light");
  renderProfile();
}

async function toggleNotifications() {
  const user = getUser();
  if (!user.settings.notifications && "Notification" in window && Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Notifications refusées.", "error");
  }
  updateUser(u => u.settings.notifications = !u.settings.notifications);
  renderProfile();
}

function toggleDnd() {
  updateUser(user => user.settings.dndMode = !user.settings.dndMode);
  renderProfile();
}

function openSubjectModal(id = "") {
  const subject = getUser().subjects.find(s => s.id === id);
  selectedColor = subject?.color || COLORS[0];
  document.getElementById("subjectModalBody").innerHTML = `
    <div class="form-group"><label>Nom</label><input id="subjectName" value="${esc(subject?.name || "")}"></div>
    <div class="form-group"><label>Coefficient</label><input id="subjectCoeff" type="number" min="1" max="10" value="${esc(subject?.coeff || 2)}"></div>
    <div class="form-group"><label>Couleur</label><div class="color-row">${COLORS.map(c => `<button class="color-swatch ${selectedColor === c ? "selected" : ""}" style="background:${c}" onclick="selectSubjectColor(this,'${c}')"></button>`).join("")}</div></div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal('subjectModal')">Annuler</button><button class="btn btn-primary" onclick="saveSubject('${esc(id)}')">Enregistrer</button></div>
  `;
  openModal("subjectModal");
}

function selectSubjectColor(button, color) {
  selectedColor = color;
  button.parentElement.querySelectorAll(".color-swatch").forEach(el => el.classList.remove("selected"));
  button.classList.add("selected");
}

function saveSubject(id = "") {
  const name = document.getElementById("subjectName").value.trim();
  if (!name) return toast("Entre un nom.", "error");
  const coeff = Number(document.getElementById("subjectCoeff").value) || 2;
  updateUser(user => {
    const subject = { id: id || uid(), name, coeff, color: selectedColor };
    const index = user.subjects.findIndex(s => s.id === id);
    if (index >= 0) user.subjects[index] = subject;
    else user.subjects.push(subject);
  });
  closeModal("subjectModal");
  renderProfile();
}

function deleteSubject(id) {
  if (!confirm("Supprimer cette matière ? Les anciennes tâches passeront en 'Sans matière'.")) return;
  updateUser(user => user.subjects = user.subjects.filter(s => s.id !== id));
  renderProfile();
}

function updateUnitType(id, key, value) {
  updateUser(user => {
    const t = user.unitTypes.find(x => x.id === id);
    if (t) t[key] = key === "baseTime" ? (Number(value) || 1) : value;
  });
}

function addUnitType() {
  const name = prompt("Nom du type ?", "Pages de cours");
  if (!name) return;
  const unit = prompt("Unité ?", "page") || "unité";
  const baseTime = Number(prompt("Temps de base ?", "10")) || 10;
  const unitLabel = prompt("min ou s ?", "min") === "s" ? "s" : "min";
  updateUser(user => user.unitTypes.push({ id: uid(), name, unit, baseTime, unitLabel }));
  renderProfile();
}

function deleteUnitType(id) {
  if (!confirm("Supprimer ce type ? Les unités liées garderont leurs données mais leur estimation peut disparaître.")) return;
  updateUser(user => user.unitTypes = user.unitTypes.filter(t => t.id !== id));
  renderProfile();
}

function toggleAvailability(key, value) {
  updateUser(user => {
    const arr = user.availability[key] || [];
    user.availability[key] = arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value];
  });
  renderProfile();
}

function updateMaxSession(value) {
  updateUser(user => user.availability.maxSessionMin = Number(value) || 90);
}

function exportData() {
  const user = getUser();
  downloadFile(`le-planning-efficace-${user.username}-${todayStr()}.json`, JSON.stringify(user, null, 2), "application/json");
}

function importDataPrompt() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = migrateState({ currentUser: "import", users: { import: JSON.parse(reader.result) } }).users.import;
        updateUser(user => Object.assign(user, data, { passwordHash: user.passwordHash, email: user.email, username: user.username }));
        renderApp();
        toast("Données importées.", "success");
      } catch {
        toast("Fichier invalide.", "error");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function openShareModal() {
  const user = getUser();
  const data = {
    v: 1,
    subjects: user.subjects,
    events: user.events,
    units: user.units,
    unitTypes: user.unitTypes
  };
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  document.getElementById("shareBody").innerHTML = `
    <p class="muted">Ce code contient le planning, les matières et les unités. Il peut être copié puis importé sur un autre navigateur.</p>
    <div class="form-group" style="margin-top:12px"><label>Code de partage</label><textarea id="shareCode" readonly>${esc(code)}</textarea></div>
    <button class="btn btn-primary btn-full" onclick="copyShareCode()">Copier</button>
    <div class="divider"></div>
    <div class="form-group"><label>Importer un code</label><textarea id="importCode"></textarea></div>
    <button class="btn btn-secondary btn-full" onclick="importShareCode()">Importer le planning</button>
  `;
  openModal("shareModal");
}

function copyShareCode() {
  const code = document.getElementById("shareCode").value;
  navigator.clipboard?.writeText(code).then(() => toast("Code copié.", "success")).catch(() => toast("Copie impossible.", "error"));
}

function importShareCode() {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(document.getElementById("importCode").value.trim()))));
    updateUser(user => {
      user.subjects = data.subjects || user.subjects;
      user.unitTypes = data.unitTypes || user.unitTypes;
      user.events = data.events || user.events;
      user.units = data.units || user.units;
    });
    closeModal("shareModal");
    renderPage(currentPage);
    toast("Planning importé.", "success");
  } catch {
    toast("Code invalide.", "error");
  }
}

function openSRModal() {
  const user = getUser();
  const due = user.spacedrep.filter(c => c.nextDate <= todayStr());
  const body = document.getElementById("srModalBody");
  if (!due.length) {
    body.innerHTML = `<p class="muted">Aucune carte à réviser aujourd'hui.</p><button class="btn btn-primary btn-full" onclick="addSRCard()" style="margin-top:12px">Ajouter une carte</button>`;
  } else {
    const card = due[0];
    body.innerHTML = `
      <div class="tiny">${due.length} carte(s) à réviser</div>
      <div class="card" style="margin-top:10px;text-align:center">
        <h3>${esc(card.question)}</h3>
        <div id="srAnswer" style="display:none;margin-top:12px">
          <div class="card" style="background:var(--bg3)">${esc(card.answer)}</div>
          <div class="row" style="justify-content:center;margin-top:12px"><button class="btn btn-danger" onclick="srRate('${esc(card.id)}',false)">Je ne savais pas</button><button class="btn btn-primary" onclick="srRate('${esc(card.id)}',true)">Je savais</button></div>
        </div>
        <button class="btn btn-secondary btn-full" style="margin-top:12px" onclick="document.getElementById('srAnswer').style.display='block';this.remove()">Voir la réponse</button>
      </div>
      <button class="btn btn-ghost btn-full" onclick="addSRCard()" style="margin-top:12px">Ajouter une carte</button>
    `;
  }
  openModal("srModal");
}

function addSRCard() {
  const question = prompt("Question / terme ?");
  if (!question) return;
  const answer = prompt("Réponse / définition ?");
  if (!answer) return;
  updateUser(user => user.spacedrep.push({ id: uid(), question, answer, subjectId: user.subjects[0]?.id || "", nextDate: todayStr(), interval: 1, ease: 2.5 }));
  openSRModal();
}

function srRate(id, knew) {
  updateUser(user => {
    const card = user.spacedrep.find(c => c.id === id);
    if (!card) return;
    if (knew) {
      card.interval = Math.max(1, Math.round(card.interval * card.ease));
      card.ease = Math.min(3, card.ease + 0.1);
    } else {
      card.interval = 1;
      card.ease = Math.max(1.3, card.ease - 0.2);
    }
    const next = new Date();
    next.setDate(next.getDate() + card.interval);
    card.nextDate = toLocalISO(next);
  });
  openSRModal();
}

function deleteAccount() {
  if (!confirm("Supprimer définitivement ce compte local ?")) return;
  delete state.users[state.currentUser];
  state.currentUser = null;
  saveState();
  renderApp();
}

loadState();
renderApp();
