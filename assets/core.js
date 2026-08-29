export const SLOT_COUNT = 6;
export const DEFAULT_EVENT_TTL_HOURS = 12;

export const DEFAULT_SETTINGS = Object.freeze({
  targetVolumeMl: 500,
  flowRate: 7,
  foamLevel: 4,
  fillHeight: 8,
  liftSpeed: 9,
  tapDelay: 2,
  carouselSpeed: 5,
  kegSizeLiters: 30,
  temperatureMinC: 3.5,
  temperatureMaxC: 7,
  fillTolerancePercent: 5,
  cleaningInterval: 100,
  glassAssignmentHours: DEFAULT_EVENT_TTL_HOURS,
  soundEnabled: false,
  physicalConfirmation: true
});

const numberInRange = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

export function normalizeSettings(input = {}) {
  return {
    targetVolumeMl: numberInRange(input.targetVolumeMl, DEFAULT_SETTINGS.targetVolumeMl, 200, 1000),
    flowRate: numberInRange(input.flowRate, DEFAULT_SETTINGS.flowRate, 1, 10),
    foamLevel: numberInRange(input.foamLevel, DEFAULT_SETTINGS.foamLevel, 1, 10),
    fillHeight: numberInRange(input.fillHeight, DEFAULT_SETTINGS.fillHeight, 1, 10),
    liftSpeed: numberInRange(input.liftSpeed, DEFAULT_SETTINGS.liftSpeed, 1, 10),
    tapDelay: numberInRange(input.tapDelay, DEFAULT_SETTINGS.tapDelay, 1, 10),
    carouselSpeed: numberInRange(input.carouselSpeed, DEFAULT_SETTINGS.carouselSpeed, 1, 10),
    kegSizeLiters: numberInRange(input.kegSizeLiters, DEFAULT_SETTINGS.kegSizeLiters, 5, 100),
    temperatureMinC: numberInRange(input.temperatureMinC, DEFAULT_SETTINGS.temperatureMinC, 0, 15),
    temperatureMaxC: numberInRange(input.temperatureMaxC, DEFAULT_SETTINGS.temperatureMaxC, 1, 20),
    fillTolerancePercent: numberInRange(input.fillTolerancePercent, DEFAULT_SETTINGS.fillTolerancePercent, 1, 15),
    cleaningInterval: Math.round(numberInRange(input.cleaningInterval, DEFAULT_SETTINGS.cleaningInterval, 10, 1000)),
    glassAssignmentHours: Math.round(numberInRange(input.glassAssignmentHours, DEFAULT_SETTINGS.glassAssignmentHours, 1, 72)),
    soundEnabled: Boolean(input.soundEnabled),
    physicalConfirmation: input.physicalConfirmation !== false
  };
}

export function getScenario(name, targetVolumeMl = 500) {
  const full = { present: true, glassMl: targetVolumeMl, fillPercent: 98 };
  const scenarios = {
    full: Array.from({ length: SLOT_COUNT }, (_, index) => ({ ...full, fillPercent: [98, 99, 97, 100, 98, 99][index] })),
    mixed: [
      { present: true, glassMl: 500, fillPercent: 98 },
      { present: true, glassMl: 300, fillPercent: 96 },
      { present: true, glassMl: 500, fillPercent: 99 },
      { present: true, glassMl: 300, fillPercent: 98 },
      { present: true, glassMl: 500, fillPercent: 97 },
      { present: true, glassMl: 300, fillPercent: 99 }
    ],
    missing: [
      { ...full, fillPercent: 98 },
      { ...full, fillPercent: 97 },
      { present: false, glassMl: targetVolumeMl, fillPercent: 0 },
      { ...full, fillPercent: 99 },
      { present: false, glassMl: targetVolumeMl, fillPercent: 0 },
      { ...full, fillPercent: 98 }
    ],
    underfill: Array.from({ length: SLOT_COUNT }, (_, index) => ({ ...full, fillPercent: index === 3 ? 82 : 98 })),
    "empty-keg": Array.from({ length: SLOT_COUNT }, (_, index) => ({ ...full, fillPercent: Math.max(15, 100 - index * 17) })),
    personal: [
      { present: true, glassMl: 500, fillPercent: 92, tokenId: "KAI-G01" },
      { present: true, glassMl: 300, fillPercent: 88, tokenId: "KAI-G02" },
      { present: true, glassMl: 500, fillPercent: 96, tokenId: "KAI-G03" },
      { present: true, glassMl: 500, fillPercent: 98 },
      { present: false, glassMl: 500, fillPercent: 0 },
      { present: true, glassMl: 300, fillPercent: 95 }
    ]
  };
  return (scenarios[name] || scenarios.full).map((slot, index) => ({ slot: index + 1, ...slot }));
}

export function normalizeGlassToken(input) {
  let raw = String(input ?? "").trim();
  if (!raw) throw new Error("Glas-ID fehlt");
  try {
    const parsed = new URL(raw, "https://kai-tap.invalid/");
    raw = parsed.searchParams.get("glass") || parsed.searchParams.get("token") || raw;
  } catch {}
  const token = decodeURIComponent(raw).trim().toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(token)) {
    throw new Error("Glas-ID muss 3–32 Zeichen aus Buchstaben, Zahlen, - oder _ enthalten");
  }
  return token;
}

export function normalizeGlassPreferences(input = {}, defaults = DEFAULT_SETTINGS) {
  return {
    glassMl: Math.round(numberInRange(input.glassMl, defaults.targetVolumeMl, 200, 1000)),
    fillPercent: Math.round(numberInRange(input.fillPercent, 95, 60, 100)),
    foamLevel: Math.round(numberInRange(input.foamLevel, defaults.foamLevel, 1, 10)),
    flowRate: Math.round(numberInRange(input.flowRate, defaults.flowRate, 1, 10))
  };
}

export function createGlassAssignment({
  tokenId,
  userId,
  userName,
  eventId,
  preferences = {},
  createdAt = new Date(),
  ttlHours = DEFAULT_EVENT_TTL_HOURS,
  eventExpiresAt = null
}) {
  if (!String(userId || "").trim()) throw new Error("Benutzer-ID fehlt");
  if (!String(eventId || "").trim()) throw new Error("Event-ID fehlt");
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) throw new Error("Ungültiger Registrierungszeitpunkt");
  const ttlExpiry = created.getTime() + numberInRange(ttlHours, DEFAULT_EVENT_TTL_HOURS, 1, 72) * 60 * 60 * 1000;
  const eventExpiry = eventExpiresAt ? new Date(eventExpiresAt).getTime() : Number.POSITIVE_INFINITY;
  const expiresAt = new Date(Math.min(ttlExpiry, Number.isFinite(eventExpiry) ? eventExpiry : ttlExpiry));
  const normalizedToken = normalizeGlassToken(tokenId);
  return {
    id: `assign-${created.getTime()}-${normalizedToken}-${Math.random().toString(16).slice(2, 8)}`,
    tokenId: normalizedToken,
    userId: String(userId).trim(),
    userName: String(userName || "Gast").trim().slice(0, 40) || "Gast",
    eventId: String(eventId).trim(),
    preferences: normalizeGlassPreferences(preferences),
    createdAt: created.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: "active"
  };
}

export function isAssignmentActive(assignment, { eventId = null, now = new Date() } = {}) {
  if (!assignment || assignment.status === "released") return false;
  if (eventId && assignment.eventId !== eventId) return false;
  const expiry = new Date(assignment.expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > new Date(now).getTime();
}

export function resolveGlassAssignment(assignments = [], tokenInput, eventId, now = new Date()) {
  let tokenId;
  try { tokenId = normalizeGlassToken(tokenInput); } catch { return null; }
  return [...assignments]
    .filter((assignment) => assignment.tokenId === tokenId && isAssignmentActive(assignment, { eventId, now }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

export function createPourRecord({
  slot,
  glassMl,
  fillPercent,
  temperatureC = 5.4,
  source = "mock",
  timestamp = new Date(),
  userId = null,
  userName = null,
  glassToken = null,
  assignmentId = null,
  eventId = null,
  targetFillPercent = null
}) {
  const normalizedFill = numberInRange(fillPercent, 0, 0, 120);
  const normalizedGlass = numberInRange(glassMl, 500, 50, 2000);
  return {
    id: `${new Date(timestamp).getTime()}-${slot}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: new Date(timestamp).toISOString(),
    slot: Math.round(numberInRange(slot, 1, 1, SLOT_COUNT)),
    glassMl: Math.round(normalizedGlass),
    fillPercent: Math.round(normalizedFill),
    volumeMl: Math.round(normalizedGlass * normalizedFill / 100),
    temperatureC: Math.round(numberInRange(temperatureC, 5.4, -20, 60) * 10) / 10,
    source: source === "serial" ? "serial" : "mock",
    personalized: Boolean(userId && glassToken),
    userId: userId ? String(userId).slice(0, 80) : null,
    userName: userName ? String(userName).slice(0, 40) : null,
    glassToken: glassToken ? normalizeGlassToken(glassToken) : null,
    assignmentId: assignmentId ? String(assignmentId).slice(0, 120) : null,
    eventId: eventId ? String(eventId).slice(0, 120) : null,
    targetFillPercent: targetFillPercent == null ? null : Math.round(numberInRange(targetFillPercent, 100, 60, 100))
  };
}

export function aggregatePersonalHistory(records = [], userId, currentEventId = null) {
  const personal = records.filter((record) => record?.personalized && record.userId === userId && Number.isFinite(Number(record.volumeMl)));
  const byEvent = new Map();
  for (const record of personal) {
    const key = record.eventId || "legacy";
    const summary = byEvent.get(key) || { eventId: key, pours: 0, volumeMl: 0, qualityTotal: 0 };
    summary.pours += 1;
    summary.volumeMl += Number(record.volumeMl);
    const target = Number(record.targetFillPercent ?? 100);
    summary.qualityTotal += Math.max(0, 100 - Math.abs(Number(record.fillPercent) - target) * 10);
    byEvent.set(key, summary);
  }
  const eventSummaries = [...byEvent.values()].map((summary) => ({
    ...summary,
    qualityPoints: summary.pours ? Math.round(summary.qualityTotal / summary.pours) : 0
  })).sort((a, b) => b.volumeMl - a.volumeMl);
  const currentEvent = eventSummaries.find((summary) => summary.eventId === currentEventId)
    || { eventId: currentEventId, pours: 0, volumeMl: 0, qualityPoints: 0 };
  const qualityHighscore = [...eventSummaries].sort((a, b) => b.qualityPoints - a.qualityPoints)[0];
  return {
    pours: personal.length,
    totalVolumeMl: personal.reduce((sum, record) => sum + Number(record.volumeMl), 0),
    currentEventPours: currentEvent.pours,
    currentEventVolumeMl: currentEvent.volumeMl,
    currentEventQualityPoints: currentEvent.qualityPoints,
    highscoreMl: eventSummaries[0]?.volumeMl || 0,
    highscoreEventId: eventSummaries[0]?.eventId || null,
    highscorePoints: qualityHighscore?.qualityPoints || 0,
    registeredGlassCount: new Set(personal.map((record) => record.glassToken).filter(Boolean)).size,
    eventSummaries
  };
}

export function calculateGamification(records = [], userId, assignments = [], currentEventId = null) {
  const personal = records.filter((record) => record?.personalized && record.userId === userId);
  const userAssignments = assignments.filter((assignment) => assignment?.userId === userId);
  const precisePours = personal.filter((record) => {
    const target = Number(record.targetFillPercent ?? 100);
    return Math.abs(Number(record.fillPercent) - target) <= 2;
  }).length;
  const slots = new Set(personal.map((record) => Number(record.slot)).filter(Number.isFinite));
  const eventIds = new Set(personal.map((record) => record.eventId).filter(Boolean));
  const eventsByToken = new Map();
  for (const assignment of userAssignments) {
    if (!assignment.tokenId || !assignment.eventId) continue;
    const events = eventsByToken.get(assignment.tokenId) || new Set();
    events.add(assignment.eventId);
    eventsByToken.set(assignment.tokenId, events);
  }
  const reusedAcrossEvents = [...eventsByToken.values()].some((events) => events.size >= 2);
  const badges = [
    { id: "qr-pioneer", title: "QR-Pionier", description: "Ein persönliches Glas registriert", unlocked: userAssignments.length >= 1, icon: "⌁" },
    { id: "precision", title: "Präzisionszapfer", description: "Drei Füllungen innerhalb ±2 %", unlocked: precisePours >= 3, icon: "◎" },
    { id: "carousel", title: "Rondell-Entdecker", description: "Drei verschiedene Positionen genutzt", unlocked: slots.size >= 3, icon: "◌" },
    { id: "reuse", title: "Mehrweg-Fan", description: "Dasselbe Glas bei zwei Events genutzt", unlocked: reusedAcrossEvents, icon: "↺" }
  ];
  const unlockedCount = badges.filter((badge) => badge.unlocked).length;
  const uniqueTokens = new Set(userAssignments.map((assignment) => assignment.tokenId).filter(Boolean)).size;
  const xp = uniqueTokens * 20 + eventIds.size * 15 + Math.min(precisePours, 5) * 10 + unlockedCount * 20;
  const level = Math.floor(xp / 100) + 1;
  const currentLevelXp = (level - 1) * 100;
  return {
    xp,
    level,
    levelProgressPercent: Math.min(100, xp - currentLevelXp),
    xpToNextLevel: Math.max(0, level * 100 - xp),
    badges,
    unlockedCount,
    precisePours,
    currentEventQualityPoints: aggregatePersonalHistory(records, userId, currentEventId).currentEventQualityPoints
  };
}

export function isSameLocalDay(isoDate, reference = new Date()) {
  const date = new Date(isoDate);
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate();
}

export function aggregateHistory(records = [], settings = DEFAULT_SETTINGS, reference = new Date()) {
  const normalizedSettings = normalizeSettings(settings);
  const validRecords = records.filter((record) => record && Number.isFinite(Number(record.volumeMl)));
  const today = validRecords.filter((record) => isSameLocalDay(record.timestamp, reference));
  const totalVolumeMl = validRecords.reduce((sum, record) => sum + Number(record.volumeMl), 0);
  const todayVolumeMl = today.reduce((sum, record) => sum + Number(record.volumeMl), 0);
  const averageFillPercent = validRecords.length
    ? validRecords.reduce((sum, record) => sum + Number(record.fillPercent), 0) / validRecords.length
    : null;
  const slotStats = Array.from({ length: SLOT_COUNT }, (_, index) => {
    const slot = index + 1;
    const slotRecords = validRecords.filter((record) => Number(record.slot) === slot);
    return {
      slot,
      count: slotRecords.length,
      volumeMl: slotRecords.reduce((sum, record) => sum + Number(record.volumeMl), 0),
      averageFillPercent: slotRecords.length
        ? slotRecords.reduce((sum, record) => sum + Number(record.fillPercent), 0) / slotRecords.length
        : null
    };
  });
  const lower = 100 - normalizedSettings.fillTolerancePercent;
  const upper = 100 + normalizedSettings.fillTolerancePercent;
  const quality = validRecords.reduce((result, record) => {
    const fill = Number(record.fillPercent);
    if (fill < lower) result.low += 1;
    else if (fill > upper) result.high += 1;
    else result.ok += 1;
    return result;
  }, { low: 0, ok: 0, high: 0 });
  const qualityPercent = validRecords.length ? Math.round(quality.ok / validRecords.length * 100) : null;
  return {
    count: validRecords.length,
    todayCount: today.length,
    totalVolumeMl,
    todayVolumeMl,
    averageFillPercent,
    remainingKegMl: Math.max(0, normalizedSettings.kegSizeLiters * 1000 - totalVolumeMl),
    slotStats,
    quality: { ...quality, percent: qualityPercent }
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function historyToCsv(records = []) {
  const header = ["Zeitpunkt", "Position", "Glas_ml", "Fuellstand_Prozent", "Ziel_Prozent", "Menge_ml", "Temperatur_C", "Quelle", "Personalisiert", "Benutzer", "Glas_ID", "Event_ID"];
  const rows = records.map((record) => [
    record.timestamp,
    record.slot,
    record.glassMl,
    record.fillPercent,
    record.targetFillPercent,
    record.volumeMl,
    record.temperatureC,
    record.source,
    record.personalized ? "ja" : "nein",
    record.userName,
    record.glassToken,
    record.eventId
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
}

export function parseSerialLine(line) {
  let message;
  try {
    message = JSON.parse(String(line).trim());
  } catch {
    throw new Error("Ungültiges JSON-Telegramm");
  }
  if (!message || typeof message.type !== "string") throw new Error("Telegrammtyp fehlt");
  if (message.type === "pour.completed") {
    for (const field of ["slot", "glassMl", "fillPercent"]) {
      if (!Number.isFinite(Number(message[field]))) throw new Error(`Feld ${field} fehlt`);
    }
  }
  if (message.type === "glass.detected") normalizeGlassToken(message.tokenId);
  return message;
}

export async function hashPin(pin) {
  const normalized = String(pin).trim();
  if (!normalized) throw new Error("PIN darf nicht leer sein");
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(normalized);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  // Deterministischer Fallback für Testumgebungen ohne Web Crypto; kein Sicherheitsmechanismus.
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}
