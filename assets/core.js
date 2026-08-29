export const SLOT_COUNT = 6;

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
    "empty-keg": Array.from({ length: SLOT_COUNT }, (_, index) => ({ ...full, fillPercent: Math.max(15, 100 - index * 17) }))
  };
  return (scenarios[name] || scenarios.full).map((slot, index) => ({ slot: index + 1, ...slot }));
}

export function createPourRecord({ slot, glassMl, fillPercent, temperatureC = 5.4, source = "mock", timestamp = new Date() }) {
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
    source: source === "serial" ? "serial" : "mock"
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
  const header = ["Zeitpunkt", "Position", "Glas_ml", "Fuellstand_Prozent", "Menge_ml", "Temperatur_C", "Quelle"];
  const rows = records.map((record) => [
    record.timestamp,
    record.slot,
    record.glassMl,
    record.fillPercent,
    record.volumeMl,
    record.temperatureC,
    record.source
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
