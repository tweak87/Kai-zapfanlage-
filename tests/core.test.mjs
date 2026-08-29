import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  aggregatePersonalHistory,
  aggregateHistory,
  createGlassAssignment,
  createPourRecord,
  getScenario,
  historyToCsv,
  isAssignmentActive,
  normalizeGlassToken,
  normalizeSettings,
  parseSerialLine,
  resolveGlassAssignment
} from "../assets/core.js";

test("all mock scenarios always model six carousel slots", () => {
  for (const name of ["full", "mixed", "missing", "underfill", "empty-keg", "personal"]) {
    const scenario = getScenario(name, 500);
    assert.equal(scenario.length, 6);
    assert.deepEqual(scenario.map((slot) => slot.slot), [1, 2, 3, 4, 5, 6]);
  }
});

test("missing-glass scenario skips positions 3 and 5", () => {
  const scenario = getScenario("missing", 500);
  assert.equal(scenario[2].present, false);
  assert.equal(scenario[4].present, false);
  assert.equal(scenario.filter((slot) => slot.present).length, 4);
});

test("pour records derive volume from glass size and fill percent", () => {
  const record = createPourRecord({ slot: 2, glassMl: 500, fillPercent: 97, timestamp: "2026-08-29T12:00:00Z" });
  assert.equal(record.slot, 2);
  assert.equal(record.volumeMl, 485);
  assert.equal(record.fillPercent, 97);
  assert.equal(record.source, "mock");
});

test("history aggregation remains position-specific", () => {
  const records = [
    createPourRecord({ slot: 1, glassMl: 500, fillPercent: 100, timestamp: "2026-08-29T12:00:00Z" }),
    createPourRecord({ slot: 1, glassMl: 500, fillPercent: 90, timestamp: "2026-08-29T12:01:00Z" }),
    createPourRecord({ slot: 4, glassMl: 300, fillPercent: 100, timestamp: "2026-08-29T12:02:00Z" })
  ];
  const stats = aggregateHistory(records, DEFAULT_SETTINGS, new Date("2026-08-29T20:00:00Z"));
  assert.equal(stats.count, 3);
  assert.equal(stats.todayCount, 3);
  assert.equal(stats.totalVolumeMl, 1250);
  assert.equal(stats.slotStats[0].count, 2);
  assert.equal(stats.slotStats[3].count, 1);
  assert.equal(stats.quality.low, 1);
  assert.equal(stats.quality.ok, 2);
});

test("settings from storage are constrained to safe UI ranges", () => {
  const settings = normalizeSettings({ flowRate: 99, liftSpeed: -2, targetVolumeMl: "330", temperatureMaxC: "8.5" });
  assert.equal(settings.flowRate, 10);
  assert.equal(settings.liftSpeed, 1);
  assert.equal(settings.targetVolumeMl, 330);
  assert.equal(settings.temperatureMaxC, 8.5);
});

test("serial parser validates pour telegrams", () => {
  const message = parseSerialLine('{"type":"pour.completed","slot":3,"glassMl":500,"fillPercent":98}');
  assert.equal(message.slot, 3);
  assert.throws(() => parseSerialLine('{"type":"pour.completed","slot":3}'), /glassMl/);
  assert.throws(() => parseSerialLine("not-json"), /JSON/);
  assert.equal(parseSerialLine('{"type":"glass.detected","tokenId":"KAI-G01","slot":1}').tokenId, "KAI-G01");
  assert.throws(() => parseSerialLine('{"type":"glass.detected","tokenId":"!"}'), /Glas-ID/);
});

test("CSV export uses German-compatible semicolon separators", () => {
  const csv = historyToCsv([createPourRecord({ slot: 1, glassMl: 500, fillPercent: 99, timestamp: "2026-08-29T12:00:00Z" })]);
  assert.match(csv, /^Zeitpunkt;Position;Glas_ml/);
  assert.match(csv, /;1;500;99;495;/);
});

test("QR and NFC links resolve to the same neutral glass token", () => {
  assert.equal(normalizeGlassToken("kai-g04"), "KAI-G04");
  assert.equal(normalizeGlassToken("https://example.test/register?glass=KAI-G04#personal"), "KAI-G04");
  assert.throws(() => normalizeGlassToken("Kai/Glas!"), /3–32/);
});

test("glass assignments are event-scoped and expire automatically", () => {
  const assignment = createGlassAssignment({
    tokenId: "KAI-G04",
    userId: "user-alex",
    userName: "Alex",
    eventId: "event-a",
    createdAt: "2026-08-29T10:00:00Z",
    ttlHours: 8,
    eventExpiresAt: "2026-08-29T14:00:00Z",
    preferences: { glassMl: 500, fillPercent: 90, foamLevel: 5, flowRate: 6 }
  });
  assert.equal(assignment.expiresAt, "2026-08-29T14:00:00.000Z");
  assert.equal(isAssignmentActive(assignment, { eventId: "event-a", now: "2026-08-29T13:59:00Z" }), true);
  assert.equal(isAssignmentActive(assignment, { eventId: "event-a", now: "2026-08-29T14:00:00Z" }), false);
  assert.equal(isAssignmentActive(assignment, { eventId: "event-b", now: "2026-08-29T12:00:00Z" }), false);
  assert.equal(resolveGlassAssignment([assignment], "KAI-G04", "event-a", "2026-08-29T12:00:00Z")?.userName, "Alex");
});

test("personal history keeps totals and event highscore separate", () => {
  const records = [
    createPourRecord({ slot: 1, glassMl: 500, fillPercent: 90, userId: "u1", userName: "Alex", glassToken: "KAI-G04", assignmentId: "a1", eventId: "e1", timestamp: "2026-08-29T12:00:00Z" }),
    createPourRecord({ slot: 2, glassMl: 500, fillPercent: 90, userId: "u1", userName: "Alex", glassToken: "KAI-G04", assignmentId: "a1", eventId: "e1", timestamp: "2026-08-29T12:05:00Z" }),
    createPourRecord({ slot: 1, glassMl: 300, fillPercent: 100, userId: "u1", userName: "Alex", glassToken: "KAI-G05", assignmentId: "a2", eventId: "e2", timestamp: "2026-08-30T12:00:00Z" }),
    createPourRecord({ slot: 3, glassMl: 500, fillPercent: 100, timestamp: "2026-08-30T12:10:00Z" })
  ];
  const stats = aggregatePersonalHistory(records, "u1", "e2");
  assert.equal(stats.pours, 3);
  assert.equal(stats.totalVolumeMl, 1200);
  assert.equal(stats.currentEventVolumeMl, 300);
  assert.equal(stats.highscoreMl, 900);
  assert.equal(stats.registeredGlassCount, 2);
});
