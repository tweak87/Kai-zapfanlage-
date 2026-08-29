import {
  DEFAULT_SETTINGS,
  aggregateHistory,
  createPourRecord,
  getScenario,
  hashPin,
  historyToCsv,
  normalizeSettings
} from "./core.js";
import { WebSerialTransport } from "./serial.js";

const STORAGE = {
  history: "kai-tap.history.v1",
  settings: "kai-tap.settings.v1",
  pin: "kai-tap.admin-pin.v1",
  cleaningBase: "kai-tap.cleaning-base.v1"
};

const VIEW_META = {
  betrieb: ["LIVE-BETRIEB", "Zapfanlage"],
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

const state = {
  history: readJson(STORAGE.history, []),
  settings: normalizeSettings(readJson(STORAGE.settings, DEFAULT_SETTINGS)),
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

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatTime(isoDate) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "medium" }).format(new Date(isoDate));
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
    node.innerHTML = `<div class="glass" style="--fill: 0%" aria-hidden="true"></div><span class="slot-number">${slot.slot}</span>`;
    node.setAttribute("aria-label", `Position ${slot.slot}: ${slot.present ? `${slot.glassMl} Milliliter Glas erkannt` : "kein Glas"}`);
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
      <td>${record.source === "serial" ? "Arduino" : "Mock"}</td>
      <td><span class="table-status${okay ? "" : " warning"}">${okay ? "IM ZIEL" : "ABWEICHUNG"}</span></td>
    </tr>`;
  }).join("");
  empty.hidden = sorted.length > 0;
  body.closest("table").hidden = sorted.length === 0;
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
}

function recordPour(record) {
  state.history.push(record);
  if (state.history.length > 5000) state.history = state.history.slice(-5000);
  saveHistory();
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
  state.slots = getScenario($("#scenario-select").value, state.settings.targetVolumeMl);
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
      await animatePhase("pour", 760 + (10 - state.settings.flowRate) * 25, index, 0, slot.fillPercent);
      await animatePhase("foam", 180 + state.settings.foamLevel * 18, index);
      recordPour(createPourRecord({
        slot: slot.slot,
        glassMl: slot.glassMl,
        fillPercent: slot.fillPercent,
        temperatureC: 5.4 + (Math.random() - .5) * .4,
        source: "mock"
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
    "setting-sound": "soundEnabled",
    "setting-physical-confirm": "physicalConfirmation"
  };
  Object.entries(map).forEach(([id, key]) => {
    const input = $(`#${id}`);
    if (input.type === "checkbox") input.checked = Boolean(state.settings[key]);
    else input.value = state.settings[key];
  });
  $("#setting-new-pin").value = "";
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
  state.slots = getScenario($("#scenario-select").value, state.settings.targetVolumeMl);
  setupRing();
  updateRing();
  renderStats();
  $("#settings-dirty").textContent = "Gespeichert";
  toast("Einstellungen gespeichert", state.connected ? "Parameter wurden lokal gespeichert und an den Arduino gesendet." : "Parameter gelten für die nächsten Mock-Durchläufe.");
}

function setupEvents() {
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$("[data-go-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.goView)));
  $("#start-cycle").addEventListener("click", startCycle);
  $("#stop-cycle").addEventListener("click", stopCycle);
  $("#connect-button").addEventListener("click", toggleSerial);
  $("#system-connect").addEventListener("click", toggleSerial);
  $("#scenario-select").addEventListener("change", () => {
    state.slots = getScenario($("#scenario-select").value, state.settings.targetVolumeMl);
    state.slotFill = Array(6).fill(0);
    setupRing();
    updateRing();
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
});

serial.addEventListener("pour", (event) => recordPour(event.detail));
serial.addEventListener("protocol-error", () => toast("Protokollfehler", "Eine serielle Nachricht konnte nicht verarbeitet werden.", "error"));

function initialize() {
  setupRing();
  updateRing();
  updateProgress(0);
  renderStats();
  updateConnectionUi();
  setupEvents();
  const requestedView = location.hash.slice(1);
  setView(VIEW_META[requestedView] ? requestedView : "betrieb");
  const supportNote = $("#serial-support-note");
  if (!WebSerialTransport.isSupported()) {
    supportNote.textContent = "Web Serial ist in diesem Browser nicht verfügbar. Der vollständige Mock-Modus kann trotzdem genutzt werden; für USB später Chrome oder Edge verwenden.";
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

initialize();
