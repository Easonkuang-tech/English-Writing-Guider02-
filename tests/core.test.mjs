import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  averageBand,
  calculateStreak,
  corpusUsageProgress,
  formatMaterialMarkdown,
  materialUsage,
  mergeBackupData,
  nextReviewIso,
  normalizeBackup,
  parseMaterialInput,
  parsePromptMarkdown,
  patternCoverage,
  patternMatches,
  recommendPrompt,
  roundHalfBand,
  toPromptMarkdown,
  weightedChoice,
  wordCount,
} from "../public/core.mjs";

test("parses daily vocabulary and patterns with Chinese and ASCII colons", () => {
  const vocabulary = parseMaterialInput(
    "- tangible benefits: 实际好处\ncurb emissions：减少排放",
    "vocabulary",
  );
  const patterns = parseMaterialInput(
    "- while concession: While X..., Y...\nnot only inversion：Not only does X..., but...",
    "pattern",
  );

  assert.equal(vocabulary.length, 2);
  assert.equal(vocabulary[0].label, "tangible benefits");
  assert.equal(vocabulary[1].label, "curb emissions");
  assert.equal(patterns.length, 2);
  assert.equal(patterns[0].type, "pattern");
});

test("formats daily material as reusable Markdown", () => {
  const markdown = formatMaterialMarkdown(
    "- tangible benefits: 实际好处",
    "- while concession: While X..., Y...",
  );

  assert.match(markdown, /## 今日词伙/);
  assert.match(markdown, /## 今日句式/);
  assert.match(markdown, /tangible benefits/);
});

test("parses and exports the project prompt bank", async () => {
  const markdown = await readFile(new URL("../data/prompts.md", import.meta.url), "utf8");
  const prompts = parsePromptMarkdown(markdown);
  const task1 = prompts.filter((prompt) => prompt.taskType === "task1");
  const task2 = prompts.filter((prompt) => prompt.taskType === "task2");
  const exported = toPromptMarkdown(prompts);
  const reparsed = parsePromptMarkdown(exported);

  assert.equal(task1.length, 20);
  assert.equal(task2.length, 20);
  assert.equal(reparsed.length, 40);
  assert.equal(reparsed[0].promptText, prompts[0].promptText);
});

test("recommends a prompt using material and prompt vocabulary", () => {
  const materials = parseMaterialInput(
    "- plastic waste: packaging creates plastic waste",
    "vocabulary",
  );
  const prompts = [
    {
      id: "education",
      taskType: "task2",
      title: "University Funding",
      topic: "Education",
      taskKind: "Discuss both views",
      tags: ["university", "students"],
      promptText: "Should university education be free?",
    },
    {
      id: "environment",
      taskType: "task2",
      title: "Plastic Packaging",
      topic: "Environment",
      taskKind: "Discuss both views",
      tags: ["plastic", "packaging", "waste"],
      promptText: "Should plastic packaging be banned?",
    },
  ];

  const result = recommendPrompt(materials, prompts, []);
  assert.equal(result.prompt.id, "environment");
  assert.ok(result.confidence > 0.35);
});

test("checks exact target phrase use in a response", () => {
  const materials = parseMaterialInput(
    "- tangible benefits: practical advantages\n- curb emissions: reduce pollution",
    "vocabulary",
  );
  const usage = materialUsage(
    materials,
    "Public transport creates tangible benefits and can curb emissions in cities.",
  );

  assert.equal(usage[0].used, true);
  assert.equal(usage[1].used, true);
  assert.match(usage[0].excerpt, /tangible benefits/);
});

test("rounds IELTS averages to the nearest half band", () => {
  assert.equal(roundHalfBand(6.24), 6.0);
  assert.equal(roundHalfBand(6.25), 6.5);
  assert.equal(roundHalfBand(6.74), 6.5);
  assert.equal(
    averageBand({
      task: { estimatedBand: 6.0 },
      coherence: { estimatedBand: 6.5 },
      lexical: { estimatedBand: 7.0 },
      grammar: { estimatedBand: 6.5 },
    }),
    6.5,
  );
});

test("counts English words without counting separators", () => {
  assert.equal(wordCount("This is a well-known example."), 5);
  assert.equal(wordCount(""), 0);
});

test("calculates a current-day streak", () => {
  const today = new Date(2026, 8, 17, 12);
  const attempts = [
    { createdAt: new Date(2026, 8, 17, 9).toISOString() },
    { createdAt: new Date(2026, 8, 16, 9).toISOString() },
    { createdAt: new Date(2026, 8, 15, 9).toISOString() },
    { createdAt: new Date(2026, 8, 13, 9).toISOString() },
  ];

  assert.equal(calculateStreak(attempts, today), 3);
});

test("validates backup shape without accepting secrets", () => {
  const valid = normalizeBackup({
    version: 1,
    exportedAt: "2026-09-17T00:00:00.000Z",
    prompts: [],
    dailySessions: [],
    attempts: [],
    settings: { learnerName: "Local" },
    DEEPSEEK_API_KEY: "must-not-be-in-backup",
  });

  assert.equal(valid.version, 1);
  assert.equal("DEEPSEEK_API_KEY" in valid, false);
  assert.throws(() => normalizeBackup({ prompts: [] }), /attempts/);
});

test("merges backup data without replacing existing record IDs", () => {
  const current = {
    prompts: [{ id: "p1", title: "Current" }],
    dailySessions: [],
    attempts: [{ id: "a1", score: 7 }],
    settings: { learnerName: "Local", builtInPromptsLoaded: true },
  };
  const merged = mergeBackupData(current, {
    prompts: [
      { id: "p1", title: "Incoming duplicate" },
      { id: "p2", title: "Incoming new" },
    ],
    dailySessions: [{ id: "d1" }],
    attempts: [{ id: "a1", score: 5 }],
    settings: { learnerName: "Backup" },
  });

  assert.equal(merged.prompts.length, 2);
  assert.equal(merged.prompts.find((prompt) => prompt.id === "p1").title, "Current");
  assert.equal(merged.prompts.find((prompt) => prompt.id === "p2").title, "Incoming new");
  assert.equal(merged.attempts.length, 1);
  assert.equal(merged.attempts[0].score, 7);
  assert.equal(merged.settings.learnerName, "Backup");
  assert.equal(merged.settings.builtInPromptsLoaded, true);
});

test("checks extracted and transferred pattern coverage", () => {
  assert.equal(
    patternMatches(
      "Some people argue that X, while others believe that Y.",
      "Some people argue that X, while others believe that Y",
    ),
    true,
  );
  assert.equal(
    patternMatches("A completely different sentence", "cause + object + to + verb"),
    false,
  );
  assert.ok(
    patternCoverage(
      "Some people argue that plastic causes pollution, while others believe packaging is useful",
      "Some people argue that X, while others believe that Y",
    ) >= 0.6,
  );
});

test("preserves learning extensions during backup normalization and merge", () => {
  const normalized = normalizeBackup({
    prompts: [],
    attempts: [],
    learningExtensions: [{ id: "learning_1", attemptId: "a1" }],
  });
  const merged = mergeBackupData(
    { learningExtensions: [{ id: "learning_1", attemptId: "old" }] },
    normalized,
  );

  assert.equal(merged.learningExtensions.length, 1);
  assert.equal(merged.learningExtensions[0].attemptId, "old");
});

test("weighted random selection respects weights and remains deterministic for tests", () => {
  const entries = [
    { id: "weak", weight: 4 },
    { id: "strong", weight: 1 },
  ];
  assert.equal(weightedChoice(entries, () => 0), "weak");
  assert.equal(weightedChoice(entries, () => 0.79), "weak");
  assert.equal(weightedChoice(entries, () => 0.81), "strong");
});

test("preserves revision sessions during backup normalization and merge", () => {
  const normalized = normalizeBackup({
    prompts: [],
    attempts: [],
    revisionSessions: [{ id: "revision_1", attemptId: "a1", currentText: "New" }],
  });
  const merged = mergeBackupData(
    { revisionSessions: [{ id: "revision_1", attemptId: "a1", currentText: "Old" }] },
    normalized,
  );

  assert.equal(merged.revisionSessions.length, 1);
  assert.equal(merged.revisionSessions[0].currentText, "Old");
});

test("calculates corpus review dates by mastery stage", () => {
  const start = new Date("2026-09-20T00:00:00.000Z");
  assert.equal(nextReviewIso("new", start), "2026-09-21T00:00:00.000Z");
  assert.equal(nextReviewIso("controlled", start), "2026-09-23T00:00:00.000Z");
  assert.equal(nextReviewIso("reused", start), "2026-09-27T00:00:00.000Z");
  assert.equal(nextReviewIso("spontaneous", start), "2026-10-20T00:00:00.000Z");
});

test("preserves corpus data during backup normalization and merge", () => {
  const normalized = normalizeBackup({
    prompts: [],
    attempts: [],
    corpusItems: [{ id: "corpus_1", chineseIntent: "备份" }],
    corpusAttempts: [{ id: "ca_1", corpusItemId: "corpus_1" }],
    corpusUsageRecords: [{ id: "cu_1", corpusItemId: "corpus_1" }],
  });
  const merged = mergeBackupData(
    {
      corpusItems: [{ id: "corpus_1", chineseIntent: "现有" }],
      corpusAttempts: [],
      corpusUsageRecords: [],
    },
    normalized,
  );

  assert.equal(merged.corpusItems.length, 1);
  assert.equal(merged.corpusItems[0].chineseIntent, "现有");
  assert.equal(merged.corpusAttempts.length, 1);
  assert.equal(merged.corpusUsageRecords.length, 1);
});

test("requires three real uses, two contexts, and one no-notes use for spontaneous", () => {
  assert.equal(corpusUsageProgress([
    { qualifiesAsRealUse: true, context: "email", notesUsed: false },
    { qualifiesAsRealUse: true, context: "chat", notesUsed: true },
  ]).canUpgrade, false);

  assert.equal(corpusUsageProgress([
    { qualifiesAsRealUse: true, context: "email", notesUsed: false },
    { qualifiesAsRealUse: true, context: "chat", notesUsed: true },
    { qualifiesAsRealUse: true, context: "writing", notesUsed: true },
  ]).canUpgrade, true);
});
