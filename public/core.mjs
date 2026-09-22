export const STORAGE_VERSION = 1;

export const TASK_LABELS = {
  task1: "Task 1",
  task2: "Task 2",
};

export const MODE_LABELS = {
  simple: "简易练习",
  formal: "正式作文",
};

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with",
  "is", "are", "be", "been", "being", "that", "this", "these", "those",
  "it", "its", "as", "by", "from", "at", "into", "than", "more", "most",
  "some", "people", "believe", "think", "should", "would", "could", "can",
  "may", "might", "will", "their", "they", "them", "we", "our", "you",
  "your", "i", "my", "not", "but", "also", "have", "has", "had", "do",
  "does", "did", "other", "others", "many", "much", "all", "both", "own",
]);

export function uid(prefix = "id") {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatLocalDate(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

export function wordCount(text = "") {
  const words = String(text).trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
  return words ? words.length : 0;
}

export function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePattern(text = "") {
  return normalizeText(text)
    .replace(/[.,!?;:()[\]{}"“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function patternMatches(extracted = "", expected = "") {
  const actual = normalizePattern(extracted);
  const target = normalizePattern(expected);
  if (!actual || !target) return false;
  if (actual === target) return true;

  return patternCoverage(actual, target) >= 0.8;
}

export function patternCoverage(text = "", expected = "") {
  const actual = normalizePattern(text);
  const target = normalizePattern(expected);
  if (!actual || !target) return 0;
  if (actual === target) return 1;
  const actualTokens = new Set(tokens(actual));
  const targetTokens = tokens(target);
  if (!targetTokens.length) return 0;
  const overlap = targetTokens.filter((token) => actualTokens.has(token)).length;
  return overlap / targetTokens.length;
}

export function tokens(text = "") {
  return normalizeText(text)
    .match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)
    ?.filter((token) => token.length > 2 && !STOP_WORDS.has(token)) ?? [];
}

export function parseMaterialInput(raw, type = "vocabulary") {
  const lines = String(raw ?? "").split(/\r?\n/);
  const items = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const bullet = trimmed.replace(/^[-*+]\s*/, "");
    const separator = bullet.search(/[:：]/);
    if (separator < 1) return;

    const label = bullet.slice(0, separator).trim();
    const detail = bullet.slice(separator + 1).trim();
    if (!label) return;

    items.push({
      id: `${type}_${index}_${normalizeText(label).replace(/[^a-z0-9]+/g, "_")}`,
      type,
      label,
      detail,
      raw: trimmed,
    });
  });

  return items;
}

export function formatMaterialMarkdown(vocabularyRaw = "", patternsRaw = "") {
  return [
    "## 今日词伙",
    "",
    vocabularyRaw.trim() || "- 暂无",
    "",
    "## 今日句式",
    "",
    patternsRaw.trim() || "- 暂无",
    "",
  ].join("\n");
}

export function parsePromptMarkdown(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const prompts = [];
  let taskType = null;
  let current = null;
  let body = [];

  const commit = () => {
    if (!current || !taskType) {
      body = [];
      return;
    }

    const promptText = body
      .join("\n")
      .replace(/^[-*+]\s+/gm, "")
      .trim();

    if (promptText || current.promptText) {
      prompts.push({
        ...current,
        taskType,
        promptText: current.promptText || promptText,
      });
    }

    current = null;
    body = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const taskMatch = line.match(/^##\s+(Task\s*[12])(?:\s|$)/i);
    if (taskMatch) {
      commit();
      taskType = taskMatch[1].replace(/\s+/g, "").toLowerCase();
      return;
    }

    const titleMatch = line.match(/^###\s+(.+)/);
    if (titleMatch && taskType) {
      commit();
      current = {
        id: uid("prompt"),
        title: titleMatch[1].trim(),
        topic: "General",
        taskKind: taskType === "task1" ? "Data description" : "Essay",
        tags: [],
        source: "Imported Markdown",
        promptText: "",
      };
      return;
    }

    if (!current) return;

    const metaMatch = line.match(/^[-*+]\s*(Topic|Kind|Tags|Source|Prompt)\s*[:：]\s*(.+)$/i);
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase();
      const value = metaMatch[2].trim();
      if (key === "topic") current.topic = value;
      if (key === "kind") current.taskKind = value;
      if (key === "tags") {
        current.tags = value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
      }
      if (key === "source") current.source = value;
      if (key === "prompt") current.promptText = value;
      return;
    }

    if (line.trim()) body.push(line);
  });

  commit();
  return prompts;
}

export function toPromptMarkdown(prompts = []) {
  const sections = [];

  for (const taskType of ["task1", "task2"]) {
    const taskPrompts = prompts.filter((prompt) => prompt.taskType === taskType);
    sections.push(`## ${TASK_LABELS[taskType]}`);

    taskPrompts.forEach((prompt) => {
      sections.push(
        "",
        `### ${prompt.title}`,
        "",
        `- Topic: ${prompt.topic || "General"}`,
        `- Kind: ${prompt.taskKind || "Practice"}`,
        `- Tags: ${(prompt.tags || []).join(", ")}`,
        `- Source: ${prompt.source || "Local"}`,
        "",
        prompt.promptText || "",
      );
    });
  }

  return `${sections.join("\n").trim()}\n`;
}

function promptVocabulary(prompt) {
  return new Set(tokens([
    prompt.title,
    prompt.topic,
    prompt.taskKind,
    ...(prompt.tags || []),
    prompt.promptText,
  ].join(" ")));
}

export function recommendPrompt(materials = [], prompts = [], recentPromptIds = []) {
  if (!prompts.length) return { prompt: null, reason: "题库为空，请先导入题目。", confidence: 0 };

  const materialTokens = new Set(materials.flatMap((item) => tokens(`${item.label} ${item.detail}`)));
  const recent = new Set(recentPromptIds.slice(0, 3));
  let best = null;

  prompts.forEach((prompt) => {
    const vocab = promptVocabulary(prompt);
    let overlap = 0;
    materialTokens.forEach((token) => {
      if (vocab.has(token)) overlap += 2;
    });

    if (recent.has(prompt.id)) overlap -= 1.5;
    if (prompt.taskKind?.toLowerCase().includes("discuss")) overlap += 0.2;

    if (!best || overlap > best.score) {
      best = { prompt, score: overlap };
    }
  });

  const matchedTags = [...materialTokens].filter((token) => promptVocabulary(best.prompt).has(token)).slice(0, 4);
  const reason = matchedTags.length
    ? `与 ${matchedTags.join("、")} 等表达的主题和写作功能最接近。`
    : "在没有明显主题重合时，选择一道功能较完整、便于自然复用的练习题。";

  return {
    prompt: best.prompt,
    reason,
    confidence: Math.min(0.85, 0.35 + matchedTags.length * 0.1),
  };
}

export function materialUsage(materials = [], responseText = "") {
  const normalizedResponse = normalizeText(responseText);

  return materials.map((item) => {
    const label = normalizeText(item.label);
    const used = label.length > 2 && normalizedResponse.includes(label);
    return {
      ...item,
      used,
      excerpt: used ? findExcerpt(responseText, item.label) : "",
    };
  });
}

function findExcerpt(text, phrase) {
  const normalized = normalizeText(text);
  const index = normalized.indexOf(normalizeText(phrase));
  if (index < 0) return "";

  const source = String(text);
  const roughStart = Math.max(0, index - 45);
  const roughEnd = Math.min(source.length, index + phrase.length + 65);
  return source.slice(roughStart, roughEnd).trim();
}

export function roundHalfBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 2) / 2;
}

export function averageBand(criteria = {}) {
  const values = ["task", "coherence", "lexical", "grammar"]
    .map((key) => Number(criteria[key]?.estimatedBand ?? criteria[key]?.band))
    .filter(Number.isFinite);
  if (!values.length) return 0;
  return roundHalfBand(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function scoreForAttempt(attempt) {
  const evaluation = attempt?.evaluation;
  if (!evaluation) return null;
  if (evaluation.type === "simple") return Number(evaluation.dailyPracticeScore) || 0;
  return Number(evaluation.estimatedBand) || averageBand(evaluation.criteria);
}

export function calculateStreak(attempts = [], today = new Date()) {
  const dates = new Set(attempts.map((attempt) => localDateKey(new Date(attempt.createdAt))));
  let cursor = new Date(today);
  let streak = 0;

  if (!dates.has(localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (dates.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

export function summarizeUsage(attempt) {
  const items = attempt?.evaluation?.targetUsage
    ? [
        ...(attempt.evaluation.targetUsage.vocabulary || []),
        ...(attempt.evaluation.targetUsage.patterns || []),
      ]
    : attempt?.materialUsage || [];

  const used = items.filter((item) => item.status === "accurate" || item.status === "used" || item.used).length;
  return { used, total: items.length };
}

export function normalizeBackup(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("备份格式无效。");
  }
  if (!Array.isArray(payload.prompts) || !Array.isArray(payload.attempts)) {
    throw new Error("备份缺少 prompts 或 attempts。");
  }

  return {
    version: Number(payload.version) || STORAGE_VERSION,
    exportedAt: payload.exportedAt || new Date().toISOString(),
    prompts: payload.prompts,
    dailySessions: Array.isArray(payload.dailySessions) ? payload.dailySessions : [],
    attempts: payload.attempts,
    learningExtensions: Array.isArray(payload.learningExtensions) ? payload.learningExtensions : [],
    revisionSessions: Array.isArray(payload.revisionSessions) ? payload.revisionSessions : [],
    corpusItems: Array.isArray(payload.corpusItems) ? payload.corpusItems : [],
    corpusAttempts: Array.isArray(payload.corpusAttempts) ? payload.corpusAttempts : [],
    corpusUsageRecords: Array.isArray(payload.corpusUsageRecords) ? payload.corpusUsageRecords : [],
    settings: payload.settings && typeof payload.settings === "object" ? payload.settings : {},
  };
}

export function mergeByStableId(records = [], additions = []) {
  const merged = new Map();
  records.forEach((record) => {
    if (record?.id) merged.set(record.id, record);
  });
  additions.forEach((record) => {
    if (record?.id && !merged.has(record.id)) merged.set(record.id, record);
  });
  return [...merged.values()];
}

export function mergeBackupData(current = {}, backup = {}) {
  return {
    ...current,
    prompts: mergeByStableId(current.prompts, backup.prompts),
    dailySessions: mergeByStableId(current.dailySessions, backup.dailySessions),
    attempts: mergeByStableId(current.attempts, backup.attempts),
    learningExtensions: mergeByStableId(current.learningExtensions, backup.learningExtensions),
    revisionSessions: mergeByStableId(current.revisionSessions, backup.revisionSessions),
    corpusItems: mergeByStableId(current.corpusItems, backup.corpusItems),
    corpusAttempts: mergeByStableId(current.corpusAttempts, backup.corpusAttempts),
    corpusUsageRecords: mergeByStableId(current.corpusUsageRecords, backup.corpusUsageRecords),
    settings: {
      ...(current.settings || {}),
      ...(backup.settings || {}),
    },
  };
}

export function nextReviewIso(stage = "new", from = new Date()) {
  const days = {
    new: 1,
    controlled: 3,
    reused: 7,
    spontaneous: 30,
  }[stage] ?? 1;
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function corpusUsageProgress(records = []) {
  const qualifying = records.filter((record) => record?.qualifiesAsRealUse);
  const contexts = new Set(qualifying.map((record) => String(record.context || "")).filter(Boolean));
  const noNotes = qualifying.filter((record) => !record.notesUsed).length;
  return {
    qualifyingCount: qualifying.length,
    contextCount: contexts.size,
    noNotesCount: noNotes,
    canUpgrade: qualifying.length >= 3 && contexts.size >= 2 && noNotes >= 1,
  };
}

export function weightedChoice(entries = [], random = Math.random) {
  const valid = entries.filter((entry) => entry?.id && Number(entry.weight) > 0);
  if (!valid.length) return "";
  const total = valid.reduce((sum, entry) => sum + Number(entry.weight), 0);
  let cursor = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * total;
  for (const entry of valid) {
    cursor -= Number(entry.weight);
    if (cursor < 0) return entry.id;
  }
  return valid[valid.length - 1].id;
}

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
