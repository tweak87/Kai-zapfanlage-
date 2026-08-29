import {
  DEFAULT_SETTINGS,
  aggregatePersonalHistory,
  aggregateHistory,
  calculateGamification,
  createGlassAssignment,
  createPourRecord,
  getScenario,
  hashPin,
  historyToCsv,
  isAssignmentActive,
  normalizeGlassToken,
  normalizeSettings,
  resolveGlassAssignment
} from "./core.js";
import { WebSerialTransport } from "./serial.js";

const STORAGE = {
  history: "kai-tap.history.v1",
  settings: "kai-tap.settings.v1",
  pin: "kai-tap.admin-pin.v1",
  cleaningBase: "kai-tap.cleaning-base.v1",
  profiles: "kai-tap.profiles.v1",
  assignments: "kai-tap.glass-assignments.v1",
  event: "kai-tap.event.v1",
  sessionUser: "kai-tap.session-user.v1"
};

const VIEW_META = {
  betrieb: ["LIVE-BETRIEB", "Zapfanlage"],
  personal: ["OPTIONALER MODUS", "Personal Glass"],
  historie: ["PROTOKOLL", "Historie"],
  analyse: ["AUSWERTUNG", "Analyse"],
  system: ["GERÄT & ERWEITERUNG", "System"]
};

const PHASES = ["scan", "lower", "pour", "foam", "rotate"];
const PHASE_LABELS = {
  scan: "Glas wird geprüft",
  lower: "Schlitten fährt zum Glasboden",
  pour: "Bier wird gezapft",
  foam: "Schaumkrone wird dosiert",
  rotate: "Rondell fährt zur nächsten Position"
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

const DEMO_PROFILES = [
  { id: "user-kai", name: "Kai", createdAt: "2026-08-29T12:00:00.000Z" },
  { id: "user-mia", name: "Mia", createdAt: "2026-08-29T12:01:00.000Z" },
  { id: "user-jens", name: "Jens", createdAt: "2026-08-29T12:02:00.000Z" }
];

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createEvent(name = "Aktuelles Testevent", ttlHours = 12, startedAt = new Date()) {
  const starts = new Date(startedAt);
  return {
    id: `event-${starts.getTime()}`,
    name: String(name).trim().slice(0, 60) || "Aktuelles Testevent",
    startsAt: starts.toISOString(),
    expiresAt: new Date(starts.getTime() + Number(ttlHours) * 60 * 60 * 1000).toISOString()
  };
}

const initialSettings = normalizeSettings(readJson(STORAGE.settings, DEFAULT_SETTINGS));
const storedEvent = readJson(STORAGE.event, null);
const initialEvent = storedEvent && new Date(storedEvent.expiresAt) > new Date()
  ? storedEvent
  : createEvent("Sommerfest · Proof of Concept", initialSettings.glassAssignmentHours);
const initialProfiles = readJson(STORAGE.profiles, DEMO_PROFILES);
const initialAssignments = localStorage.getItem(STORAGE.assignments) === null
  ? [
      createGlassAssignment({ tokenId: "KAI-G01", userId: "user-kai", userName: "Kai", eventId: initialEvent.id, preferences: { glassMl: 500, fillPercent: 92, foamLevel: 4, flowRate: 7 }, ttlHours: initialSettings.glassAssignmentHours, eventExpiresAt: initialEvent.expiresAt }),
      createGlassAssignment({ tokenId: "KAI-G02", userId: "user-mia", userName: "Mia", eventId: initialEvent.id, preferences: { glassMl: 300, fillPercent: 88, foamLevel: 6, flowRate: 6 }, ttlHours: initialSettings.glassAssignmentHours, eventExpiresAt: initialEvent.expiresAt }),
      createGlassAssignment({ tokenId: "KAI-G03", userId: "user-jens", userName: "Jens", eventId: initialEvent.id, preferences: { glassMl: 500, fillPercent: 96, foamLevel: 3, flowRate: 8 }, ttlHours: initialSettings.glassAssignmentHours, eventExpiresAt: initialEvent.expiresAt })
    ]
  : readJson(STORAGE.assignments, []);

const state = {
  history: readJson(STORAGE.history, []),
  settings: initialSettings,
  profiles: initialProfiles,
  assignments: initialAssignments,
  event: initialEvent,
  currentUserId: localStorage.getItem(STORAGE.sessionUser) || null,
  cleaningBase: Number(localStorage.getItem(STORAGE.cleaningBase) || 0),
  mode: "mock",
  connected: false,
  running: false,
  abortRequested: false,
  activeSlot: null,
  phase: null,
  slotFill: Array(6).fill(0),
  slots: getScenario("full", DEFAULT_SETTINGS.targetVolumeMl),
  sessionStartedAt: new Date().toISOString(),
  adminUnlocked: false
};

const serial = new WebSerialTransport();
let qrScannerStream = null;
let qrScannerTimer = null;
let lastGeneratedQrUrl = null;

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatTime(isoDate) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "medium" }).format(new Date(isoDate));
}

function formatDuration(milliseconds) {
  const safe = Math.max(0, milliseconds);
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  return hours ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
}

function currentUser() {
  return state.profiles.find((profile) => profile.id === state.currentUserId) || null;
}

function buildScenario(name) {
  const baseSlots = getScenario(name, state.settings.targetVolumeMl);
  if (name === "personal") {
    const reserved = new Set(baseSlots.map((slot) => slot.tokenId).filter(Boolean));
    const newestAdditional = state.assignments
      .filter((assignment) => !reserved.has(assignment.tokenId) && isAssignmentActive(assignment, { eventId: state.event.id }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    if (newestAdditional) baseSlots[3] = { ...baseSlots[3], tokenId: newestAdditional.tokenId };
  }
  return baseSlots.map((slot) => {
    if (!slot.tokenId) return slot;
    const assignment = resolveGlassAssignment(state.assignments, slot.tokenId, state.event.id);
    if (!assignment) return { ...slot, glassMl: state.settings.targetVolumeMl, fillPercent: 98, identityState: "unknown" };
    return {
      ...slot,
      glassMl: assignment.preferences.glassMl,
      fillPercent: assignment.preferences.fillPercent,
      assignment,
      identityState: "personalized"
    };
  });
}

function toast(title, message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.innerHTML = `<i></i><div><strong></strong><small></small></div>`;
  $("strong", element).textContent = title;
  $("small", element).textContent = message;
  $("#toast-region").append(element);
  window.setTimeout(() => element.remove(), 4400);
}

function setView(view) {
  if (!VIEW_META[view]) return;
  $$("[data-view-panel]").forEach((panel) => {
    const isActive = panel.dataset.viewPanel === view;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });
  $$("[data-view]").forEach((button) => {
    const isActive = button.dataset.view === view;
    button.classList.toggle("is-active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#view-kicker").textContent = VIEW_META[view][0];
  $("#view-title").textContent = VIEW_META[view][1];
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  if (view === "historie") renderHistory();
  if (view === "analyse") renderAnalytics();
  if (view === "personal") renderPersonal();
}

function setupRing() {
  const ring = $("#carousel-ring");
  $$(".slot-node", ring).forEach((node) => node.remove());
  state.slots.forEach((slot, index) => {
    const angle = -90 + index * 60;
    const radians = angle * Math.PI / 180;
    const radius = 39;
    const node = document.createElement("div");
    node.className = `slot-node${slot.present ? "" : " missing"}`;
    node.dataset.slot = String(slot.slot);
    node.style.left = `${50 + Math.cos(radians) * radius}%`;
    node.style.top = `${50 + Math.sin(radians) * radius}%`;
    const personalName = slot.assignment?.userName;
    node.classList.toggle("personalized", Boolean(personalName));
    node.innerHTML = `<div class="glass" style="--fill: 0%" aria-hidden="true"></div><span class="slot-number">${slot.slot}</span>${personalName ? `<small class="personal-slot-name">${escapeHtml(personalName)}</small>` : ""}`;
    node.setAttribute("aria-label", `Position ${slot.slot}: ${slot.present ? `${slot.glassMl} Milliliter Glas erkannt${personalName ? `, personalisiert für ${personalName}` : ""}` : "kein Glas"}`);
    ring.append(node);
  });
}

function updateRing() {
  state.slots.forEach((slot, index) => {
    const node = $(`.slot-node[data-slot="${slot.slot}"]`);
    if (!node) return;
    node.classList.toggle("missing", !slot.present);
    node.classList.toggle("is-active", state.activeSlot === slot.slot);
    node.classList.toggle("pouring", state.activeSlot === slot.slot && state.phase === "pour");
    $(".glass", node).style.setProperty("--fill", `${clamp(state.slotFill[index] || 0, 0, 100)}%`);
  });
  $("#active-position").textContent = state.activeSlot ? String(state.activeSlot).padStart(2, "0") : "—";
  $("#active-phase").textContent = state.phase ? PHASE_LABELS[state.phase] : "Wartet";
}

function updateProgress(percent, label = "Bereit für neuen Durchlauf") {
  const value = clamp(Math.round(percent), 0, 100);
  $("#progress-bar").style.width = `${value}%`;
  $("#progress-value").textContent = `${value} %`;
  $("#progress-label").textContent = label;
  $$("[data-phase]").forEach((element) => {
    const phaseIndex = PHASES.indexOf(element.dataset.phase);
    const activeIndex = PHASES.indexOf(state.phase);
    element.classList.toggle("is-active", element.dataset.phase === state.phase);
    element.classList.toggle("is-done", state.phase && phaseIndex < activeIndex);
  });
}

function renderStats() {
  const stats = aggregateHistory(state.history, state.settings);
  $("#metric-pours").textContent = stats.todayCount;
  $("#metric-pours-detail").textContent = stats.todayCount
    ? `${formatNumber(stats.todayVolumeMl / 1000, 1)} Liter seit Tagesbeginn`
    : "Noch kein Zapfvorgang heute";
  $("#metric-volume").textContent = formatNumber(stats.todayVolumeMl / 1000, 1);
  if (stats.averageFillPercent == null) {
    $("#metric-fill").textContent = "—";
    $("#metric-fill-unit").textContent = "";
    $("#metric-fill-detail").textContent = "Noch keine Messwerte";
  } else {
    $("#metric-fill").textContent = formatNumber(stats.averageFillPercent, 0);
    $("#metric-fill-unit").textContent = " %";
    $("#metric-fill-detail").textContent = `Zielband ±${state.settings.fillTolerancePercent} %`;
  }
  $("#metric-keg").textContent = formatNumber(stats.remainingKegMl / 1000, 1);
  $("#metric-keg-detail").textContent = stats.remainingKegMl === 0 ? "Fasswechsel empfohlen" : "Geschätzt aus Startvolumen";

  const slotGrid = $("#slot-grid");
  slotGrid.innerHTML = stats.slotStats.map((slot) => `
    <article class="slot-stat">
      <header><span>POSITION</span><span class="slot-badge">${slot.slot}</span></header>
      <strong>${slot.count}<small> Gläser</small></strong>
      <footer><span>${formatNumber(slot.volumeMl / 1000, 1)} L</span><span>Ø ${slot.averageFillPercent == null ? "—" : `${formatNumber(slot.averageFillPercent)} %`}</span></footer>
    </article>`).join("");
  renderMaintenance(stats);
}

function renderHistory() {
  const body = $("#history-body");
  const empty = $("#history-empty");
  const sorted = [...state.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  body.innerHTML = sorted.map((record) => {
    const deviation = Math.abs(Number(record.fillPercent) - 100);
    const okay = deviation <= state.settings.fillTolerancePercent;
    return `<tr>
      <td>${formatTime(record.timestamp)}</td>
      <td><strong>Position ${record.slot}</strong></td>
      <td>${record.glassMl} ml</td>
      <td>${record.fillPercent} %</td>
      <td><strong>${record.volumeMl} ml</strong></td>
      <td>${record.personalized ? `<strong>${escapeHtml(record.userName || "Profil")}</strong><small class="table-subline">${escapeHtml(record.glassToken || "")}</small>` : "Anonym"}</td>
      <td>${record.source === "serial" ? "Arduino" : "Mock"}</td>
      <td><span class="table-status${okay ? "" : " warning"}">${okay ? "IM ZIEL" : "ABWEICHUNG"}</span></td>
    </tr>`;
  }).join("");
  empty.hidden = sorted.length > 0;
  body.closest("table").hidden = sorted.length === 0;
}

function renderPersonal() {
  const user = currentUser();
  const now = new Date();
  const eventActive = new Date(state.event.expiresAt) > now;
  const activeAssignments = state.assignments.filter((assignment) => isAssignmentActive(assignment, { eventId: state.event.id, now }));

  $("#event-name").textContent = state.event.name;
  $("#event-expiry").textContent = formatTime(state.event.expiresAt);
  $("#event-countdown").textContent = eventActive
    ? `Noch ${formatDuration(new Date(state.event.expiresAt) - now)}`
    : "Event beendet · Zuordnungen sind abgelaufen";
  $("#event-state").textContent = eventActive ? "AKTIV" : "ABGELAUFEN";
  $("#event-state").className = `pill ${eventActive ? "success" : "error"}`;
  $("#event-assignment-count").textContent = String(activeAssignments.length);

  const profileSelect = $("#profile-select");
  const selected = profileSelect.value || state.currentUserId || state.profiles[0]?.id || "";
  profileSelect.innerHTML = state.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join("");
  if (state.profiles.some((profile) => profile.id === selected)) profileSelect.value = selected;

  $("#personal-auth-logged-out").hidden = Boolean(user);
  $("#personal-auth-logged-in").hidden = !user;
  $("#registration-fields").classList.toggle("is-disabled", !user || !eventActive);
  $("#register-glass").disabled = !user || !eventActive;
  $("#registration-user-note").textContent = !eventActive
    ? "Das Event ist beendet. Ein Admin kann ein neues Event starten."
    : user
      ? `Die Glas-ID wird für ${user.name} bis spätestens zum Eventende reserviert.`
      : "Zum Registrieren zuerst ein Mock-Profil anmelden.";

  if (user) {
    $("#profile-avatar").textContent = user.name.slice(0, 1).toUpperCase();
    $("#profile-name").textContent = user.name;
    $("#profile-session-note").textContent = "Lokale POC-Sitzung · keine echte Authentifizierung";
  }

  const stats = user ? aggregatePersonalHistory(state.history, user.id, state.event.id) : aggregatePersonalHistory([], "", state.event.id);
  $("#personal-stat-volume").textContent = formatNumber(stats.totalVolumeMl / 1000, 2);
  $("#personal-stat-pours").textContent = String(stats.pours);
  $("#personal-stat-event").textContent = formatNumber(stats.currentEventVolumeMl / 1000, 2);
  $("#personal-stat-highscore").textContent = String(stats.highscorePoints);

  const game = user
    ? calculateGamification(state.history, user.id, state.assignments, state.event.id)
    : calculateGamification([], "", [], state.event.id);
  $("#personal-level").textContent = String(game.level);
  $("#personal-xp").textContent = String(game.xp);
  $("#personal-xp-copy").textContent = `${game.xpToNextLevel} XP bis Level ${game.level + 1}`;
  $("#personal-xp-progress").style.width = `${game.levelProgressPercent}%`;
  $("#achievement-grid").innerHTML = game.badges.map((badge) => `<article class="achievement ${badge.unlocked ? "is-unlocked" : ""}">
    <span aria-hidden="true">${badge.icon}</span><div><strong>${badge.title}</strong><small>${badge.description}</small></div><em>${badge.unlocked ? "FREIGESCHALTET" : "NOCH OFFEN"}</em>
  </article>`).join("");

  const myAssignments = user
    ? state.assignments.filter((assignment) => assignment.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8)
    : [];
  $("#my-glasses-list").innerHTML = myAssignments.length ? myAssignments.map((assignment) => {
    const active = isAssignmentActive(assignment, { eventId: state.event.id, now });
    return `<article class="glass-assignment ${active ? "" : "is-expired"}">
      <div class="token-mark" aria-hidden="true">⌁</div>
      <div><strong>${escapeHtml(assignment.tokenId)}</strong><small>${assignment.preferences.glassMl} ml · ${assignment.preferences.fillPercent} % · Schaum ${assignment.preferences.foamLevel}</small><small>${active ? `gültig bis ${formatTime(assignment.expiresAt)}` : "Zuordnung abgelaufen oder freigegeben"}</small></div>
      ${active ? `<button class="text-button danger-text" type="button" data-release-assignment="${escapeHtml(assignment.id)}">Freigeben</button>` : `<span class="pill neutral">INAKTIV</span>`}
    </article>`;
  }).join("") : `<div class="inline-empty"><strong>${user ? "Noch kein Glas registriert" : "Noch nicht angemeldet"}</strong><span>${user ? "QR-/NFC-Code scannen oder eine Glas-ID eingeben." : "Wähle links ein Profil für die persönliche Ansicht."}</span></div>`;

  const leaderboard = state.profiles.map((profile) => {
    const personal = aggregatePersonalHistory(state.history, profile.id, state.event.id);
    return { profile, volumeMl: personal.currentEventVolumeMl, pours: personal.currentEventPours, points: personal.currentEventQualityPoints };
  }).filter((entry) => entry.pours > 0).sort((a, b) => b.points - a.points || b.pours - a.pours);
  $("#event-leaderboard").innerHTML = leaderboard.length ? leaderboard.map((entry, index) => `<li>
    <span class="leader-rank">${index + 1}</span><span><strong>${escapeHtml(entry.profile.name)}</strong><small>${entry.pours} Zapfung${entry.pours === 1 ? "" : "en"} · ${formatNumber(entry.volumeMl / 1000, 2)} L</small></span><strong>${entry.points} Pkt.</strong>
  </li>`).join("") : `<li class="inline-empty"><strong>Noch keine personalisierte Zapfung</strong><span>Wähle im Betrieb das Testszenario „Personal Glass“.</span></li>`;
}

function renderAnalytics() {
  const stats = aggregateHistory(state.history, state.settings);
  const max = Math.max(1, ...stats.slotStats.map((slot) => slot.count));
  $("#slot-chart").innerHTML = stats.slotStats.map((slot) => `
    <div class="bar-item">
      <div class="bar-track"><span class="bar-value" data-value="${slot.count}" style="height:${slot.count ? Math.max(4, slot.count / max * 100) : 0}%"></span></div>
      <span>POS ${slot.slot}</span>
    </div>`).join("");
  const quality = stats.quality;
  $("#quality-gauge").style.setProperty("--value", quality.percent ?? 0);
  $("#quality-value").textContent = quality.percent == null ? "—" : `${quality.percent} %`;
  $("#quality-low").textContent = quality.low;
  $("#quality-ok").textContent = quality.ok;
  $("#quality-high").textContent = quality.high;

  if (!stats.count) {
    $("#insight-title").textContent = "Ersten Testlauf starten";
    $("#insight-copy").textContent = "Danach bewertet das Dashboard Verteilung, Füllgenauigkeit und mögliche Abweichungen je Position.";
  } else {
    const leastUsed = [...stats.slotStats].sort((a, b) => a.count - b.count)[0];
    if (quality.low > 0) {
      $("#insight-title").textContent = `${quality.low} Unterfüllung${quality.low === 1 ? "" : "en"} erkannt`;
      $("#insight-copy").textContent = "Prüfe Füllhöhe, Durchfluss und Glasprofil. Mit einem realen Mengensensor lässt sich die Ursache später positionsgenau bestätigen.";
    } else {
      $("#insight-title").textContent = "Füllprofil arbeitet gleichmäßig";
      $("#insight-copy").textContent = `Alle erfassten Gläser liegen im definierten Zielband. Position ${leastUsed.slot} wurde bisher am seltensten verwendet.`;
    }
  }
  renderMaintenance(stats);
}

function renderMaintenance(stats = aggregateHistory(state.history, state.settings)) {
  const sinceCleaning = Math.max(0, stats.count - state.cleaningBase);
  const remaining = Math.max(0, state.settings.cleaningInterval - sinceCleaning);
  const percent = clamp(sinceCleaning / state.settings.cleaningInterval * 100, 0, 100);
  $("#cleaning-copy").textContent = remaining
    ? `Noch ${remaining} Zapfung${remaining === 1 ? "" : "en"} bis zur Empfehlung`
    : "Reinigung wird empfohlen";
  $("#cleaning-progress").style.width = `${percent}%`;
  $("#cleaning-state").textContent = remaining ? "OK" : "FÄLLIG";
  $("#cleaning-state").className = `pill ${remaining ? "success" : "error"}`;
}

function saveHistory() {
  writeJson(STORAGE.history, state.history);
  renderStats();
  if (!$("#view-historie").hidden) renderHistory();
  if (!$("#view-analyse").hidden) renderAnalytics();
  if (!$("#view-personal").hidden) renderPersonal();
}

function recordPour(record) {
  const beforeBadges = record.userId
    ? new Set(calculateGamification(state.history, record.userId, state.assignments, state.event.id).badges.filter((badge) => badge.unlocked).map((badge) => badge.id))
    : new Set();
  state.history.push(record);
  if (state.history.length > 5000) state.history = state.history.slice(-5000);
  saveHistory();
  if (record.userId) {
    const newlyUnlocked = calculateGamification(state.history, record.userId, state.assignments, state.event.id).badges
      .find((badge) => badge.unlocked && !beforeBadges.has(badge.id));
    if (newlyUnlocked) toast("Erfolg freigeschaltet", `${newlyUnlocked.icon} ${newlyUnlocked.title}: ${newlyUnlocked.description}`);
  }
}

function setMachineState(label, kind = "success") {
  const badge = $("#machine-state");
  badge.textContent = label;
  badge.className = `pill ${kind}`;
}

function assertNotStopped() {
  if (state.abortRequested) throw new DOMException("Zyklus gestoppt", "AbortError");
}

async function animatePhase(phase, duration, slotIndex, startFill = null, endFill = null) {
  state.phase = phase;
  updateRing();
  const slotPart = slotIndex / 6;
  const phasePart = PHASES.indexOf(phase) / PHASES.length / 6;
  updateProgress((slotPart + phasePart) * 100, `Position ${slotIndex + 1}: ${PHASE_LABELS[phase]}`);
  const steps = endFill == null ? 1 : 14;
  for (let step = 1; step <= steps; step += 1) {
    assertNotStopped();
    if (endFill != null) {
      state.slotFill[slotIndex] = startFill + (endFill - startFill) * step / steps;
      updateRing();
      const phaseProgress = step / steps / PHASES.length / 6;
      updateProgress((slotPart + phasePart + phaseProgress) * 100, `Position ${slotIndex + 1}: ${PHASE_LABELS[phase]}`);
    }
    await sleep(duration / steps);
  }
}

async function startMockCycle() {
  state.running = true;
  state.abortRequested = false;
  state.slotFill = Array(6).fill(0);
  state.slots = buildScenario($("#scenario-select").value);
  setupRing();
  setMachineState("ZYKLUS AKTIV", "warning");
  $("#start-cycle").disabled = true;
  $("#stop-cycle").disabled = false;
  $("#scenario-select").disabled = true;

  try {
    for (let index = 0; index < state.slots.length; index += 1) {
      const slot = state.slots[index];
      state.activeSlot = slot.slot;
      await animatePhase("scan", 190, index);
      if (!slot.present) {
        await animatePhase("rotate", 260, index);
        continue;
      }
      await animatePhase("lower", 360 + (10 - state.settings.liftSpeed) * 15, index);
      const profile = slot.assignment?.preferences;
      await animatePhase("pour", 760 + (10 - (profile?.flowRate || state.settings.flowRate)) * 25, index, 0, slot.fillPercent);
      await animatePhase("foam", 180 + (profile?.foamLevel || state.settings.foamLevel) * 18, index);
      recordPour(createPourRecord({
        slot: slot.slot,
        glassMl: slot.glassMl,
        fillPercent: slot.fillPercent,
        temperatureC: 5.4 + (Math.random() - .5) * .4,
        source: "mock",
        userId: slot.assignment?.userId,
        userName: slot.assignment?.userName,
        glassToken: slot.assignment?.tokenId,
        assignmentId: slot.assignment?.id,
        eventId: slot.assignment?.eventId,
        targetFillPercent: slot.assignment?.preferences.fillPercent
      }));
      await animatePhase("rotate", 250 + (10 - state.settings.carouselSpeed) * 18, index);
    }
    updateProgress(100, "6er-Zyklus abgeschlossen");
    setMachineState("BEREIT", "success");
    toast("Zapfzyklus abgeschlossen", `${state.slots.filter((slot) => slot.present).length} Gläser wurden protokolliert.`);
    beep(740, .08);
  } catch (error) {
    if (error.name !== "AbortError") throw error;
    updateProgress(0, "Zyklus sicher gestoppt");
    setMachineState("GESTOPPT", "error");
    toast("Zyklus gestoppt", "Hahn geschlossen, Schlitten und Rondell simuliert auf Null gestellt.", "error");
  } finally {
    state.running = false;
    state.abortRequested = false;
    state.activeSlot = null;
    state.phase = null;
    $("#start-cycle").disabled = false;
    $("#stop-cycle").disabled = true;
    $("#scenario-select").disabled = false;
    updateRing();
  }
}

async function startCycle() {
  if (state.running) return;
  if (state.mode === "serial" && state.connected) {
    try {
      await serial.send({ type: "cycle.start", slots: 6 });
      toast("Startbefehl gesendet", "Der Arduino führt den 6er-Zyklus aus.");
      setMachineState("ARDUINO AKTIV", "warning");
    } catch (error) {
      toast("Start fehlgeschlagen", error.message, "error");
    }
    return;
  }
  await startMockCycle();
}

async function stopCycle() {
  if (state.mode === "serial" && state.connected) {
    try {
      await serial.send({ type: "cycle.stop", reason: "web-ui" });
      toast("Stoppbefehl gesendet", "Die Anlage soll den Hahn schließen und referenzieren.", "error");
    } catch (error) {
      toast("Stopp fehlgeschlagen", error.message, "error");
    }
    return;
  }
  state.abortRequested = true;
}

function beep(frequency, duration) {
  if (!state.settings.soundEnabled) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.05, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  } catch {}
}

function updateConnectionUi() {
  const box = $("#connection-state");
  const dot = $(".status-dot", box);
  const strong = $("strong", box);
  const small = $("small", box);
  const connected = state.mode === "serial" && state.connected;
  dot.className = `status-dot ${connected ? "ok" : "mock"}`;
  strong.textContent = connected ? "ESP32 verbunden" : "Mock-Arduino";
  small.textContent = connected ? "USB · 115200 Baud" : "Simuliert · bereit";
  $("#connect-button").innerHTML = connected ? "<span aria-hidden=\"true\">×</span> Trennen" : "<span aria-hidden=\"true\">⌁</span> USB verbinden";
  $("#system-connect").textContent = connected ? "Arduino trennen" : "Echten Arduino verbinden";
  $("#serial-badge").textContent = connected ? "USB VERBUNDEN" : "MOCK AKTIV";
  $("#serial-badge").className = `pill ${connected ? "success" : "warning"}`;
  $("#device-detail").textContent = connected ? "Seriell verbunden" : "Virtuelles Gerät";
}

async function toggleSerial() {
  if (state.connected) {
    await serial.disconnect();
    return;
  }
  if (!WebSerialTransport.isSupported()) {
    toast("Web Serial nicht verfügbar", "Nutze Chrome oder Edge auf einem Desktopgerät. Der Mock-Modus bleibt aktiv.", "error");
    return;
  }
  try {
    await serial.connect();
    state.mode = "serial";
    state.connected = true;
    updateConnectionUi();
    toast("Arduino verbunden", "Status- und Zapftelegramme können jetzt empfangen werden.");
  } catch (error) {
    toast("Verbindung nicht hergestellt", error.message || "Die Geräteauswahl wurde geschlossen.", "error");
  }
}

function populateSettingsForm() {
  const map = {
    "setting-volume": "targetVolumeMl",
    "setting-flow": "flowRate",
    "setting-foam": "foamLevel",
    "setting-height": "fillHeight",
    "setting-lift": "liftSpeed",
    "setting-delay": "tapDelay",
    "setting-carousel": "carouselSpeed",
    "setting-keg": "kegSizeLiters",
    "setting-temp-min": "temperatureMinC",
    "setting-temp-max": "temperatureMaxC",
    "setting-tolerance": "fillTolerancePercent",
    "setting-cleaning": "cleaningInterval",
    "setting-glass-ttl": "glassAssignmentHours",
    "setting-sound": "soundEnabled",
    "setting-physical-confirm": "physicalConfirmation"
  };
  Object.entries(map).forEach(([id, key]) => {
    const input = $(`#${id}`);
    if (input.type === "checkbox") input.checked = Boolean(state.settings[key]);
    else input.value = state.settings[key];
  });
  $("#setting-new-pin").value = "";
  $("#setting-event-name").value = state.event.name;
  updateRangeOutputs();
  $("#settings-dirty").textContent = "Keine ungespeicherten Änderungen";
}

function updateRangeOutputs() {
  for (const name of ["flow", "foam", "height", "lift", "delay", "carousel"]) {
    $(`#output-${name}`).textContent = $(`#setting-${name}`).value;
  }
}

async function openAdmin() {
  const dialog = $("#admin-dialog");
  state.adminUnlocked = false;
  $("#admin-login").hidden = false;
  $("#admin-settings").hidden = true;
  $("#admin-title").textContent = "Einstellungen entsperren";
  $("#admin-pin").value = "";
  $("#pin-error").textContent = "";
  dialog.showModal();
  await sleep(40);
  $("#admin-pin").focus();
}

async function unlockAdmin() {
  const entered = $("#admin-pin").value;
  if (!entered) {
    $("#pin-error").textContent = "Bitte PIN eingeben.";
    return;
  }
  const stored = localStorage.getItem(STORAGE.pin) || await hashPin("2468");
  if (await hashPin(entered) !== stored) {
    $("#pin-error").textContent = "PIN ist nicht korrekt.";
    beep(180, .12);
    return;
  }
  state.adminUnlocked = true;
  $("#admin-login").hidden = true;
  $("#admin-settings").hidden = false;
  $("#admin-title").textContent = "Anlagenparameter";
  populateSettingsForm();
}

function collectSettingsForm() {
  return normalizeSettings({
    targetVolumeMl: $("#setting-volume").value,
    flowRate: $("#setting-flow").value,
    foamLevel: $("#setting-foam").value,
    fillHeight: $("#setting-height").value,
    liftSpeed: $("#setting-lift").value,
    tapDelay: $("#setting-delay").value,
    carouselSpeed: $("#setting-carousel").value,
    kegSizeLiters: $("#setting-keg").value,
    temperatureMinC: $("#setting-temp-min").value,
    temperatureMaxC: $("#setting-temp-max").value,
    fillTolerancePercent: $("#setting-tolerance").value,
    cleaningInterval: $("#setting-cleaning").value,
    glassAssignmentHours: $("#setting-glass-ttl").value,
    soundEnabled: $("#setting-sound").checked,
    physicalConfirmation: $("#setting-physical-confirm").checked
  });
}

async function saveSettings() {
  const nextSettings = collectSettingsForm();
  if (nextSettings.temperatureMaxC <= nextSettings.temperatureMinC) {
    toast("Einstellungen nicht gespeichert", "Die Maximaltemperatur muss über der Minimaltemperatur liegen.", "error");
    return;
  }
  const newPin = $("#setting-new-pin").value.trim();
  if (newPin && newPin.length < 4) {
    toast("PIN zu kurz", "Die neue PIN muss mindestens vier Zeichen enthalten.", "error");
    return;
  }
  state.settings = nextSettings;
  writeJson(STORAGE.settings, state.settings);
  if (newPin) localStorage.setItem(STORAGE.pin, await hashPin(newPin));
  if (state.connected) {
    try {
      await serial.send({ type: "settings.update", settings: state.settings, physicalConfirmation: state.settings.physicalConfirmation });
    } catch (error) {
      toast("Lokal gespeichert", `Übertragung an Arduino fehlgeschlagen: ${error.message}`, "error");
      return;
    }
  }
  state.slots = buildScenario($("#scenario-select").value);
  setupRing();
  updateRing();
  renderStats();
  $("#settings-dirty").textContent = "Gespeichert";
  toast("Einstellungen gespeichert", state.connected ? "Parameter wurden lokal gespeichert und an den Arduino gesendet." : "Parameter gelten für die nächsten Mock-Durchläufe.");
}

function refreshScenario() {
  state.slots = buildScenario($("#scenario-select").value);
  state.slotFill = Array(6).fill(0);
  setupRing();
  updateRing();
}

function loginProfile() {
  const userId = $("#profile-select").value;
  if (!state.profiles.some((profile) => profile.id === userId)) return;
  state.currentUserId = userId;
  localStorage.setItem(STORAGE.sessionUser, userId);
  renderPersonal();
  toast("Profil angemeldet", `${currentUser().name} kann jetzt ein Glas für dieses Event registrieren.`);
}

function createProfile() {
  const input = $("#new-profile-name");
  const name = input.value.trim().replace(/\s+/g, " ").slice(0, 40);
  if (name.length < 2) {
    toast("Profil nicht erstellt", "Bitte einen Namen mit mindestens zwei Zeichen eingeben.", "error");
    return;
  }
  if (state.profiles.some((profile) => profile.name.toLocaleLowerCase("de") === name.toLocaleLowerCase("de"))) {
    toast("Name bereits vorhanden", "Wähle das vorhandene Profil aus der Liste.", "error");
    return;
  }
  const profile = { id: `user-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, name, createdAt: new Date().toISOString() };
  state.profiles.push(profile);
  writeJson(STORAGE.profiles, state.profiles);
  state.currentUserId = profile.id;
  localStorage.setItem(STORAGE.sessionUser, profile.id);
  input.value = "";
  renderPersonal();
  toast("Profil erstellt", `${name} ist für diesen Browser angemeldet.`);
}

function logoutProfile() {
  state.currentUserId = null;
  localStorage.removeItem(STORAGE.sessionUser);
  renderPersonal();
}

function mockScanGlass() {
  const activeTokens = new Set(state.assignments
    .filter((assignment) => isAssignmentActive(assignment, { eventId: state.event.id }))
    .map((assignment) => assignment.tokenId));
  const freeToken = Array.from({ length: 24 }, (_, index) => `KAI-G${String(index + 1).padStart(2, "0")}`)
    .find((token) => !activeTokens.has(token)) || `KAI-${Date.now().toString(36).toUpperCase()}`;
  $("#glass-token-input").value = freeToken;
  generateQrCode(false);
  toast("Mock-Scan erkannt", `${freeToken} wurde aus dem simulierten QR-/NFC-Tag gelesen.`);
}

function registrationUrl(tokenInput) {
  const tokenId = normalizeGlassToken(tokenInput);
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("glass", tokenId);
  url.hash = "personal";
  return url.href;
}

function generateQrCode(announce = true) {
  let tokenId;
  try { tokenId = normalizeGlassToken($("#glass-token-input").value); }
  catch (error) {
    if (announce) toast("QR-Code nicht erstellt", error.message, "error");
    return false;
  }
  if (!window.QRCode) {
    toast("QR-Modul nicht geladen", "Bitte die Seite neu laden. Der manuelle Code bleibt nutzbar.", "error");
    return false;
  }
  const preview = $("#qr-code-preview");
  preview.innerHTML = "";
  lastGeneratedQrUrl = registrationUrl(tokenId);
  new window.QRCode(preview, {
    text: lastGeneratedQrUrl,
    width: 184,
    height: 184,
    colorDark: "#111613",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.M
  });
  $("#qr-code-caption").textContent = `${tokenId} · enthält nur die Registrierungs-URL`;
  $("#download-qr").disabled = false;
  if (announce) toast("QR-Code erstellt", `${tokenId} kann jetzt gedruckt oder mit einem zweiten Handy gescannt werden.`);
  return true;
}

function downloadQrCode() {
  if (!lastGeneratedQrUrl && !generateQrCode(false)) return;
  const preview = $("#qr-code-preview");
  const image = $("img", preview);
  const canvas = $("canvas", preview);
  const dataUrl = image?.src || canvas?.toDataURL("image/png");
  if (!dataUrl) {
    toast("QR-Code noch nicht bereit", "Bitte kurz warten und erneut versuchen.", "error");
    return;
  }
  const tokenId = normalizeGlassToken($("#glass-token-input").value);
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${tokenId}-registrierung.png`;
  link.click();
}

function closeQrScanner() {
  if (qrScannerTimer) window.clearTimeout(qrScannerTimer);
  qrScannerTimer = null;
  qrScannerStream?.getTracks().forEach((track) => track.stop());
  qrScannerStream = null;
  const video = $("#qr-video");
  video.pause();
  video.srcObject = null;
  const dialog = $("#qr-scanner-dialog");
  if (dialog.open) dialog.close();
}

function acceptScannedQr(payload) {
  let tokenId;
  try { tokenId = normalizeGlassToken(payload); }
  catch {
    $("#qr-scanner-status").textContent = "QR-Code erkannt, aber keine gültige Glas-ID gefunden.";
    return false;
  }
  $("#glass-token-input").value = tokenId;
  closeQrScanner();
  generateQrCode(false);
  toast("Glas-Code erkannt", `${tokenId} ist bereit zur Registrierung.`);
  return true;
}

function scanCameraFrame() {
  if (!qrScannerStream) return;
  const video = $("#qr-video");
  const canvas = $("#qr-scan-canvas");
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && window.jsQR) {
    const scale = Math.min(1, 960 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
    if (result?.data && acceptScannedQr(result.data)) return;
  }
  qrScannerTimer = window.setTimeout(scanCameraFrame, 140);
}

async function openQrScanner() {
  const dialog = $("#qr-scanner-dialog");
  $("#qr-scanner-status").textContent = "Kamera wird gestartet …";
  dialog.showModal();
  if (!navigator.mediaDevices?.getUserMedia || !window.jsQR) {
    $("#qr-scanner-status").textContent = "Kamerascanner ist in diesem Browser nicht verfügbar. Nutze die normale Handykamera oder gib die Glas-ID ein.";
    return;
  }
  try {
    qrScannerStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    const video = $("#qr-video");
    video.srcObject = qrScannerStream;
    await video.play();
    $("#qr-scanner-status").textContent = "QR-Code mittig in den Rahmen halten.";
    scanCameraFrame();
  } catch (error) {
    closeQrScanner();
    toast("Kamera nicht verfügbar", "Kamerazugriff wurde nicht erlaubt oder das Gerät besitzt keine nutzbare Kamera.", "error");
  }
}

async function copyRegistrationLink() {
  try {
    const link = registrationUrl($("#glass-token-input").value);
    await navigator.clipboard.writeText(link);
    toast("Registrierungslink kopiert", "Dieser Link kann als QR-Code oder NFC-NDEF-URL auf das Glas gebracht werden.");
  } catch (error) {
    toast("Link nicht kopiert", error.message || "Bitte zuerst eine gültige Glas-ID eingeben.", "error");
  }
}

function registerGlass() {
  const user = currentUser();
  if (!user) {
    toast("Anmeldung erforderlich", "Bitte zuerst ein Profil auswählen.", "error");
    return;
  }
  if (new Date(state.event.expiresAt) <= new Date()) {
    toast("Event abgelaufen", "Ein Admin muss ein neues Event starten.", "error");
    return;
  }
  let tokenId;
  try { tokenId = normalizeGlassToken($("#glass-token-input").value); }
  catch (error) { toast("Ungültige Glas-ID", error.message, "error"); return; }
  const current = resolveGlassAssignment(state.assignments, tokenId, state.event.id);
  if (current && current.userId !== user.id) {
    toast("Glas bereits reserviert", `${tokenId} ist in diesem Event bereits einem anderen Profil zugeordnet.`, "error");
    return;
  }
  if (current) {
    current.status = "released";
    current.releasedAt = new Date().toISOString();
  }
  const assignment = createGlassAssignment({
    tokenId,
    userId: user.id,
    userName: user.name,
    eventId: state.event.id,
    preferences: {
      glassMl: $("#personal-glass-size").value,
      fillPercent: $("#personal-fill").value,
      foamLevel: $("#personal-foam").value,
      flowRate: state.settings.flowRate
    },
    ttlHours: state.settings.glassAssignmentHours,
    eventExpiresAt: state.event.expiresAt
  });
  state.assignments.push(assignment);
  state.assignments = state.assignments.slice(-500);
  writeJson(STORAGE.assignments, state.assignments);
  refreshScenario();
  renderPersonal();
  toast("Glas registriert", `${tokenId} nutzt jetzt ${assignment.preferences.fillPercent} % Füllung für ${user.name}.`);
}

function releaseAssignment(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId && item.userId === state.currentUserId);
  if (!assignment) return;
  assignment.status = "released";
  assignment.releasedAt = new Date().toISOString();
  writeJson(STORAGE.assignments, state.assignments);
  refreshScenario();
  renderPersonal();
  toast("Glas freigegeben", `${assignment.tokenId} kann sofort neu registriert werden.`);
}

function startNewEvent() {
  if (!state.adminUnlocked) return;
  const name = $("#setting-event-name").value.trim() || "Neues Event";
  const hours = clamp(Number($("#setting-glass-ttl").value) || state.settings.glassAssignmentHours, 1, 72);
  if (!window.confirm(`Neues Event „${name}“ für ${hours} Stunden starten? Alle bisherigen Glas-Zuordnungen werden dadurch inaktiv.`)) return;
  state.settings = normalizeSettings({ ...state.settings, glassAssignmentHours: hours });
  writeJson(STORAGE.settings, state.settings);
  state.event = createEvent(name, hours);
  writeJson(STORAGE.event, state.event);
  refreshScenario();
  renderPersonal();
  toast("Neues Event gestartet", "Alte Zuordnungen bleiben im Verlauf, gelten aber nicht mehr für die Anlage.");
}

function setupEvents() {
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$("[data-go-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.goView)));
  $("#start-cycle").addEventListener("click", startCycle);
  $("#stop-cycle").addEventListener("click", stopCycle);
  $("#connect-button").addEventListener("click", toggleSerial);
  $("#system-connect").addEventListener("click", toggleSerial);
  $("#scenario-select").addEventListener("change", () => {
    refreshScenario();
  });
  $("#login-profile").addEventListener("click", loginProfile);
  $("#create-profile").addEventListener("click", createProfile);
  $("#new-profile-name").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); createProfile(); }
  });
  $("#logout-profile").addEventListener("click", logoutProfile);
  $("#mock-scan").addEventListener("click", mockScanGlass);
  $("#open-qr-scanner").addEventListener("click", openQrScanner);
  $("#close-qr-scanner").addEventListener("click", closeQrScanner);
  $("#qr-scanner-dialog").addEventListener("cancel", (event) => { event.preventDefault(); closeQrScanner(); });
  $("#generate-qr").addEventListener("click", () => generateQrCode(true));
  $("#download-qr").addEventListener("click", downloadQrCode);
  $("#glass-token-input").addEventListener("input", () => {
    lastGeneratedQrUrl = null;
    $("#download-qr").disabled = true;
    $("#qr-code-preview").innerHTML = '<span class="qr-placeholder">QR</span>';
    $("#qr-code-caption").textContent = "Glas-ID eingeben und QR-Code erzeugen";
  });
  $("#copy-registration-link").addEventListener("click", copyRegistrationLink);
  $("#register-glass").addEventListener("click", registerGlass);
  $("#personal-fill").addEventListener("input", () => { $("#personal-fill-output").textContent = `${$("#personal-fill").value} %`; });
  $("#personal-foam").addEventListener("input", () => { $("#personal-foam-output").textContent = $("#personal-foam").value; });
  $("#my-glasses-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-release-assignment]");
    if (button) releaseAssignment(button.dataset.releaseAssignment);
  });
  $("#admin-button").addEventListener("click", openAdmin);
  $("#unlock-admin").addEventListener("click", unlockAdmin);
  $("#admin-pin").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); unlockAdmin(); }
  });
  $("#lock-admin").addEventListener("click", () => {
    state.adminUnlocked = false;
    $("#admin-dialog").close();
  });
  $("#save-settings").addEventListener("click", saveSettings);
  $("#start-new-event").addEventListener("click", startNewEvent);
  $$("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.settingsTab;
    $$("[data-settings-tab]").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
    $$("[data-settings-panel]").forEach((panel) => {
      const active = panel.dataset.settingsPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  }));
  $$("#admin-settings input").forEach((input) => input.addEventListener("input", () => {
    updateRangeOutputs();
    $("#settings-dirty").textContent = "Ungespeicherte Änderungen";
  }));
  $("#export-csv").addEventListener("click", () => {
    if (!state.history.length) { toast("Kein Export", "Es sind noch keine Zapfungen vorhanden.", "error"); return; }
    const blob = new Blob(["\ufeff", historyToCsv(state.history)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kai-zapfhistorie-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
  $("#clear-history").addEventListener("click", () => {
    if (!state.history.length) return;
    if (!window.confirm("Gesamte lokale Zapfhistorie wirklich löschen?")) return;
    state.history = [];
    state.cleaningBase = 0;
    localStorage.setItem(STORAGE.cleaningBase, "0");
    saveHistory();
    renderHistory();
    toast("Historie gelöscht", "Alle lokal gespeicherten Zapfdaten wurden entfernt.");
  });
  $("#reset-session").addEventListener("click", () => {
    state.history = state.history.filter((record) => new Date(record.timestamp) < new Date(state.sessionStartedAt));
    state.sessionStartedAt = new Date().toISOString();
    saveHistory();
    toast("Session geleert", "Zapfungen seit dem Öffnen der Seite wurden entfernt.");
  });
  $("#mark-cleaned").addEventListener("click", () => {
    state.cleaningBase = state.history.length;
    localStorage.setItem(STORAGE.cleaningBase, String(state.cleaningBase));
    renderMaintenance();
    toast("Reinigung protokolliert", "Der Wartungszähler wurde neu gestartet.");
  });
}

serial.addEventListener("connection", (event) => {
  state.connected = event.detail.connected;
  if (!state.connected) state.mode = "mock";
  updateConnectionUi();
  if (!state.connected) toast("Arduino getrennt", "Der Mock-Modus ist wieder aktiv.");
});

serial.addEventListener("message", (event) => {
  const message = event.detail;
  if (message.type === "state") {
    state.activeSlot = Number(message.slot) || null;
    state.phase = PHASES.includes(message.phase) ? message.phase : null;
    updateRing();
  }
  if (message.type === "temperature") {
    const value = Number(message.valueC);
    if (Number.isFinite(value)) $("#side-temperature").textContent = `${formatNumber(value, 1)} °C`;
  }
  if (message.type === "cycle.completed") {
    setMachineState("BEREIT", "success");
    toast("Arduino-Zyklus abgeschlossen", "Alle bestätigten Zapfungen wurden protokolliert.");
  }
  if (message.type === "glass.detected") {
    const assignment = resolveGlassAssignment(state.assignments, message.tokenId, state.event.id);
    const response = assignment ? {
      type: "glass.profile.apply",
      tokenId: assignment.tokenId,
      assignmentId: assignment.id,
      eventId: assignment.eventId,
      expiresAt: assignment.expiresAt,
      ttlSeconds: Math.max(1, Math.floor((new Date(assignment.expiresAt) - new Date()) / 1000)),
      profile: assignment.preferences
    } : {
      type: "glass.profile.apply",
      tokenId: message.tokenId,
      assignmentId: null,
      eventId: state.event.id,
      fallback: "normal",
      profile: {
        glassMl: state.settings.targetVolumeMl,
        fillPercent: 100,
        foamLevel: state.settings.foamLevel,
        flowRate: state.settings.flowRate
      }
    };
    serial.send(response).catch((error) => toast("Glasprofil nicht übertragen", error.message, "error"));
    toast(
      assignment ? "Persönliches Glas erkannt" : "Unbekanntes Glas",
      assignment ? `${assignment.userName}: ${assignment.preferences.fillPercent} % von ${assignment.preferences.glassMl} ml.` : "Das normale Anlagenprofil wird verwendet."
    );
  }
});

serial.addEventListener("pour", (event) => {
  const record = event.detail;
  const assignment = state.assignments.find((item) => item.id === record.assignmentId)
    || (record.glassToken ? resolveGlassAssignment(state.assignments, record.glassToken, state.event.id) : null);
  recordPour(assignment ? {
    ...record,
    personalized: true,
    userId: assignment.userId,
    userName: assignment.userName,
    glassToken: assignment.tokenId,
    assignmentId: assignment.id,
    eventId: assignment.eventId
  } : record);
});
serial.addEventListener("protocol-error", () => toast("Protokollfehler", "Eine serielle Nachricht konnte nicht verarbeitet werden.", "error"));

function initialize() {
  if (!currentUser()) {
    state.currentUserId = null;
    localStorage.removeItem(STORAGE.sessionUser);
  }
  writeJson(STORAGE.profiles, state.profiles);
  writeJson(STORAGE.assignments, state.assignments);
  writeJson(STORAGE.event, state.event);
  setupRing();
  updateRing();
  updateProgress(0);
  renderStats();
  updateConnectionUi();
  setupEvents();
  renderPersonal();
  const registrationToken = new URLSearchParams(location.search).get("glass");
  if (registrationToken) {
    try {
      $("#glass-token-input").value = normalizeGlassToken(registrationToken);
      generateQrCode(false);
    }
    catch { toast("Ungültiger Registrierungslink", "Die übergebene Glas-ID ist nicht gültig.", "error"); }
  }
  const requestedView = location.hash.slice(1);
  setView(registrationToken ? "personal" : VIEW_META[requestedView] ? requestedView : "betrieb");
  const supportNote = $("#serial-support-note");
  if (!WebSerialTransport.isSupported()) {
    supportNote.textContent = "Web Serial ist in diesem Browser nicht verfügbar. Der vollständige Mock-Modus kann trotzdem genutzt werden; für USB später Chrome oder Edge verwenden.";
  }
  window.setInterval(() => {
    if (!$("#view-personal").hidden) renderPersonal();
  }, 30_000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

initialize();
