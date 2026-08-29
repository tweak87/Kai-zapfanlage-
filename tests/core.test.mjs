import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  aggregateHistory,
  createPourRecord,
  getScenario,
  historyToCsv,
  normalizeSettings,
  parseSerialLine
} from "../assets/core.js";

test("all mock scenarios always model six carousel slots", () => {
  for (const name of ["full", "mixed", "missing", "underfill", "empty-keg"]) {
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
});

test("CSV export uses German-compatible semicolon separators", () => {
  const csv = historyToCsv([createPourRecord({ slot: 1, glassMl: 500, fillPercent: 99, timestamp: "2026-08-29T12:00:00Z" })]);
  assert.match(csv, /^Zeitpunkt;Position;Glas_ml/);
  assert.match(csv, /;1;500;99;495;/);
});
