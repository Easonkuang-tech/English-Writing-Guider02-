import {
  TASK_LABELS,
  MODE_LABELS,
  averageBand,
  calculateStreak,
  corpusUsageProgress,
  escapeHtml,
  formatLocalDate,
  formatMaterialMarkdown,
  localDateKey,
  materialUsage,
  mergeBackupData,
  nextReviewIso,
  normalizeBackup,
  parseMaterialInput,
  parsePromptMarkdown,
  patternCoverage,
  patternMatches,
  recommendPrompt,
  scoreForAttempt,
  summarizeUsage,
  toPromptMarkdown,
  uid,
  weightedChoice,
  wordCount,
} from "./core.mjs";
import {
  applyConfigFromUrl,
  buildActivationUrl,
  getStoredConfig,
  maskApiKey,
  saveStoredConfig,
  isConfigured as isDeepSeekConfigured,
  runMatch,
  runEvaluate,
  runLearningExtension,
  runRevisionCheck,
  runCorpusEvaluate,
  runCorpusCheck,
  runCorpusUsageCheck,
  runCorpusRandomPrompt,
  runCorpusRetrieval,
} from "./deepseek.mjs";
import { PROMPTS_MARKDOWN } from "./prompts-data.mjs";
import {
  apiFetch,
  getAuthConfig,
  getSession,
  initializeAuth,
  sendMagicLink,
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from "./auth.mjs";
import {
  loadAdminDashboard,
  loadUserDetail,
  resendLoginEmail,
  setUserStatus,
} from "./admin.mjs";
import {
  ensureSyncMeta,
  pullCloudState,
  pushCloudState,
  reconcileCloudState,
} from "./cloud-sync.mjs";

const STORAGE_KEY = "bandcraft:data:v1";
const DRAFT_PREFIX = "bandcraft:draft:";
const CORPUS_DRAFT_KEY = "bandcraft:corpus-draft:v1";
const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");

// One-click activation runs before routing: the key arrives in the URL
// fragment, lands in localStorage, and the address bar is scrubbed.
const activation = applyConfigFromUrl();

const state = {
  data: loadData(),
  route: parseRoute(),
  auth: {
    initialized: false,
    configured: false,
    required: false,
    session: null,
    user: null,
    profile: null,
    error: "",
  },
  admin: {
    loading: false,
    data: null,
    selectedUser: null,
    error: "",
  },
  bank: { query: "", taskType: "all" },
  history: { query: "", filter: "all", tab: "writing" },
  ui: {
    mode: "simple",
    selectedPromptId: null,
    matching: false,
    evaluating: false,
    learningLoading: false,
    revisionLoading: false,
    corpusBusy: false,
    corpusFilter: "all",
    corpusQuery: "",
    renamingCorpusId: "",
    corpusDraft: loadCorpusDraft(),
    activeRetrieval: null,
    dialog: null,
    authMode: "login",
    authMethod: "password",
    pendingBackup: null,
    pendingPromptMarkdown: "",
    backupMode: "merge",
  },
  serverStatus: null,
  sync: {
    status: "idle",
    error: "",
    lastSyncedAt: null,
  },
  timer: {
    totalSeconds: 0,
    remainingSeconds: 0,
    handle: null,
  },
};

let cloudSaveTimer = null;

const ICONS = {
  home: '<path d="M3 10.7 12 3l9 7.7"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>',
  library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/><path d="M8 6h8"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  pause: '<path d="M9 4v16"/><path d="M15 4v16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  sparkle: '<path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4z"/><path d="m18 14 .9 2.6 2.6.9-2.6.9L18 21l-.9-2.6-2.6-.9 2.6-.9z"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.sparkle}</svg>`;
}

function defaultData() {
  return {
    version: 1,
    prompts: [],
    dailySessions: [],
    attempts: [],
    learningExtensions: [],
    revisionSessions: [],
    corpusItems: [],
    corpusAttempts: [],
    corpusUsageRecords: [],
    settings: {
      learnerName: "我的写作桌",
      builtInPromptsLoaded: false,
    },
  };
}

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const data = !parsed || typeof parsed !== "object" ? defaultData() : {
      ...defaultData(),
      ...parsed,
      prompts: Array.isArray(parsed.prompts) ? parsed.prompts : [],
      dailySessions: Array.isArray(parsed.dailySessions) ? parsed.dailySessions : [],
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      learningExtensions: Array.isArray(parsed.learningExtensions) ? parsed.learningExtensions : [],
      revisionSessions: Array.isArray(parsed.revisionSessions) ? parsed.revisionSessions : [],
      corpusItems: Array.isArray(parsed.corpusItems) ? parsed.corpusItems : [],
      corpusAttempts: Array.isArray(parsed.corpusAttempts) ? parsed.corpusAttempts : [],
      corpusUsageRecords: Array.isArray(parsed.corpusUsageRecords) ? parsed.corpusUsageRecords : [],
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
    };
    ensureSyncMeta(data);
    return data;
  } catch {
    const data = defaultData();
    ensureSyncMeta(data);
    return data;
  }
}

function saveData(options = {}) {
  const sync = ensureSyncMeta(state.data);
  if (options.markChanged !== false) {
    sync.version = (Number(sync.version) || 0) + 1;
    sync.updatedAt = new Date().toISOString();
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  if (options.cloud !== false && state.auth?.session?.user?.id) {
    scheduleCloudSave();
  }
}

function loadCorpusDraft() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CORPUS_DRAFT_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCorpusDraft() {
  if (!state.ui.corpusDraft) {
    localStorage.removeItem(CORPUS_DRAFT_KEY);
    return;
  }
  localStorage.setItem(CORPUS_DRAFT_KEY, JSON.stringify(state.ui.corpusDraft));
}

function clearCorpusDraft() {
  state.ui.corpusDraft = null;
  localStorage.removeItem(CORPUS_DRAFT_KEY);
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [page = "home", id = ""] = raw.split("/");
  return { page: page || "home", id };
}

function navigate(path) {
  const next = `#/${path}`;
  if (location.hash === next) {
    state.route = parseRoute();
    render();
  } else {
    location.hash = next;
  }
}

function todaySession() {
  const date = localDateKey();
  return state.data.dailySessions.find((session) => session.localDate === date) || null;
}

function ensureTodaySession() {
  let session = todaySession();
  if (session) return session;
  session = {
    id: uid("day"),
    localDate: localDateKey(),
    vocabularyRaw: "",
    patternsRaw: "",
    parsedVocabulary: [],
    parsedPatterns: [],
    recommendedPromptId: null,
    selectedPromptId: null,
    matchReason: "",
    matchConfidence: 0,
    matchMethod: "",
    unmatchedMaterialIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.data.dailySessions.push(session);
  saveData();
  return session;
}

function parsedTodayMaterials() {
  const session = todaySession();
  if (!session) return [];
  return [
    ...parseMaterialInput(session.vocabularyRaw, "vocabulary"),
    ...parseMaterialInput(session.patternsRaw, "pattern"),
  ];
}

function promptById(id) {
  return state.data.prompts.find((prompt) => prompt.id === id) || null;
}

function attemptById(id) {
  return state.data.attempts.find((attempt) => attempt.id === id) || null;
}

function learningExtensionByAttemptId(attemptId) {
  return state.data.learningExtensions.find((extension) => extension.attemptId === attemptId) || null;
}

function activePrompt() {
  const session = todaySession();
  const id = state.ui.selectedPromptId || session?.selectedPromptId || session?.recommendedPromptId;
  return promptById(id);
}

function draftKey(promptId, mode) {
  return `${DRAFT_PREFIX}${localDateKey()}:${promptId || "none"}:${mode}`;
}

function readDraft(promptId, mode) {
  return localStorage.getItem(draftKey(promptId, mode)) || "";
}

function saveDraft(promptId, mode, text) {
  if (text) localStorage.setItem(draftKey(promptId, mode), text);
  else localStorage.removeItem(draftKey(promptId, mode));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

function scoreLabel(attempt) {
  if (!attempt?.evaluation) return "未评分";
  if (attempt.evaluation.type === "simple") {
    return `${Number(attempt.evaluation.dailyPracticeScore || 0).toFixed(0)}/10`;
  }
  return `Band ${Number(attempt.evaluation.estimatedBand || 0).toFixed(1)}`;
}

function scoreRatio(attempt) {
  if (!attempt?.evaluation) return 0;
  if (attempt.evaluation.type === "simple") {
    return Math.max(0, Math.min(1, Number(attempt.evaluation.dailyPracticeScore || 0) / 10));
  }
  return Math.max(0, Math.min(1, Number(attempt.evaluation.estimatedBand || 0) / 9));
}

function taskBadge(taskType) {
  return `<span class="badge badge-${taskType}">${TASK_LABELS[taskType] || taskType}</span>`;
}

function truncate(value, length = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function statValue(value, unit = "") {
  return `<strong>${escapeHtml(value)}</strong>${unit ? `<small>${escapeHtml(unit)}</small>` : ""}`;
}

function render() {
  if (state.route.page !== "practice") stopTimer();
  app.innerHTML = renderShell(renderPage());
  if (
    state.route.page === "admin"
    && state.auth.profile?.role === "admin"
    && !state.admin.data
    && !state.admin.loading
  ) {
    queueMicrotask(loadAdminData);
  }
}

function renderPage() {
  if (!state.auth.initialized) {
    return `<section class="page auth-loading"><div class="evaluation-orbit">${icon("clock", 28)}</div><h1>正在加载账号</h1></section>`;
  }
  if (state.auth.required && !state.auth.session) return renderLoginPage();
  if (state.route.page === "admin") {
    if (state.auth.profile?.role !== "admin") return renderUnauthorizedPage();
    return renderAdminPage();
  }
  if (state.route.page === "bank") return renderBank();
  if (state.route.page === "practice") return renderPractice();
  if (state.route.page === "corpus") return renderCorpusPage();
  if (state.route.page === "history") return renderHistory();
  if (state.route.page === "report") return renderReport();
  if (state.route.page === "learn") return renderLearningExtension();
  if (state.route.page === "settings") return renderSettings();
  return renderHome();
}

function renderShell(content) {
  const nav = [
    ["home", "首页", "home"],
    ["bank", "题库", "library"],
    ["practice", "练习", "pen"],
    ["history", "历史", "history"],
    ["settings", "设置", "settings"],
    ...(state.auth.profile?.role === "admin" ? [["admin", "管理", "settings"]] : []),
  ];
  const activePage = state.route.page === "corpus"
    ? "practice"
    : ["report", "learn", "admin"].includes(state.route.page)
      ? "history"
      : state.route.page;
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#/home" aria-label="Bandcraft 首页">
          <span class="brand-mark">B</span>
          <span>
            <strong>Bandcraft</strong>
            <small>每日语言进入真实写作</small>
          </span>
        </a>
        <nav class="side-nav" aria-label="主导航">
          ${nav.map(([page, label, iconName]) => `
            <a href="#/${page}" class="nav-item ${activePage === page ? "is-active" : ""}">
              ${icon(iconName)}
              <span>${label}</span>
            </a>
          `).join("")}
        </nav>
        <div class="sidebar-foot">
          <span class="local-dot"></span>
          <div>
            <strong>${state.auth.profile ? escapeHtml(state.auth.profile.display_name || "已登录") : "本地私人空间"}</strong>
            <small>${state.auth.session ? "云端同步已启用" : "数据保存在当前浏览器"}</small>
          </div>
          ${state.auth.session ? `<button class="icon-button" data-action="sign-out" aria-label="退出登录">${icon("close", 15)}</button>` : ""}
        </div>
      </aside>

      <header class="mobile-topbar">
        <a class="mobile-brand" href="#/home">
          <span class="brand-mark">B</span>
          <strong>Bandcraft</strong>
        </a>
        <span class="status-pill">${state.serverStatus?.configured ? "DeepSeek 已连接" : "本地模式"}</span>
      </header>

      <main class="main-content">
        ${content}
      </main>

      <nav class="bottom-nav" aria-label="移动端导航">
        ${nav.slice(0, 5).map(([page, label, iconName]) => `
          <a href="#/${page}" class="bottom-nav-item ${activePage === page ? "is-active" : ""}">
            ${icon(iconName, 20)}
            <span>${label}</span>
          </a>
        `).join("")}
      </nav>
      ${renderDialog()}
    </div>
  `;
}

function pageHeader(eyebrow, title, description = "", actions = "") {
  return `
    <header class="page-header">
      <div>
        <span class="eyebrow">${escapeHtml(eyebrow)}</span>
        <h1>${escapeHtml(title)}</h1>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      </div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ""}
    </header>
  `;
}

function renderLoginPage() {
  const isSignup = state.ui.authMode === "signup";
  const isMagic = state.ui.authMethod === "magic";
  return `
    <main class="auth-page">
      <section class="auth-card">
        <a class="brand auth-brand" href="#/home">
          <span class="brand-mark">B</span>
          <span><strong>Bandcraft</strong><small>多用户 IELTS 写作训练</small></span>
        </a>
        <span class="eyebrow">${isSignup ? "Create Account" : "Welcome Back"}</span>
        <h1>${isSignup ? "创建你的学习账号" : "登录后继续练习"}</h1>
        <p>登录后，题库、写作记录、语料库和复习计划会在设备之间同步。</p>
        <div class="segmented auth-method-tabs">
          <button class="${!isMagic ? "is-active" : ""}" data-action="set-auth-method" data-value="password">邮箱 + 密码</button>
          <button class="${isMagic ? "is-active" : ""}" data-action="set-auth-method" data-value="magic">Magic Link</button>
        </div>
        <form id="auth-form" class="auth-form">
          ${isSignup ? `
            <label class="field"><span>显示名称</span><input name="displayName" autocomplete="name" placeholder="你的名字" /></label>
          ` : ""}
          <label class="field"><span>邮箱</span><input name="email" type="email" autocomplete="email" required placeholder="name@example.com" /></label>
          ${!isMagic ? `
            <label class="field"><span>密码</span><input name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" minlength="8" required placeholder="至少 8 位" /></label>
          ` : ""}
          ${state.auth.error ? `<div class="notice error-notice">${escapeHtml(state.auth.error)}</div>` : ""}
          <button class="button button-primary button-large" data-action="${isMagic ? "send-magic-link" : isSignup ? "signup-password" : "signin-password"}" type="button">
            ${icon(isMagic ? "send" : "check")}${isMagic ? "发送登录链接" : isSignup ? "创建账号" : "登录"}
          </button>
        </form>
        ${!isMagic ? `
          <button class="text-button auth-switch" data-action="toggle-auth-mode">
            ${isSignup ? "已有账号？返回登录" : "没有账号？创建账号"}
          </button>
        ` : ""}
        <p class="auth-legal">登录即表示你同意只在自己的设备上使用该学习工具。</p>
      </section>
    </main>
  `;
}

function renderUnauthorizedPage() {
  return `
    <section class="page">
      ${pageHeader("权限不足", "此页面仅管理员可访问", "当前账号没有管理员角色。")}
      <div class="empty-state panel"><a class="button button-primary" href="#/home">${icon("home")}返回首页</a></div>
    </section>
  `;
}

function renderAdminPage() {
  if (state.admin.loading && !state.admin.data) {
    return `<section class="page admin-page"><div class="admin-loading">${icon("clock", 28)}<h1>正在读取后台数据</h1></div></section>`;
  }
  if (state.admin.error) {
    return `<section class="page admin-page">${pageHeader("管理员后台", "读取失败", state.admin.error, `<button class="button button-primary" data-action="reload-admin">${icon("refresh")}重试</button>`)}</section>`;
  }
  const metrics = state.admin.data?.metrics || {};
  const users = state.admin.data?.users || [];
  const selected = state.admin.selectedUser;
  return `
    <section class="page admin-page">
      ${pageHeader("Administration", "管理员后台", "多用户数据概览、账号状态和复习进度。", `<button class="button button-ghost" data-action="reload-admin">${icon("refresh")}刷新</button>`)}
      <div class="admin-metrics">
        ${[
          ["用户总数", metrics.users],
          ["活跃用户", metrics.activeUsers],
          ["写作记录", metrics.writingAttempts],
          ["语料条目", metrics.corpusItems],
          ["待复习", metrics.dueReviews],
          ["超时复习", metrics.timedOutReviews],
          ["AI 失败", metrics.aiFailures],
        ].map(([label, value]) => `<div><span>${label}</span><strong>${value ?? 0}</strong></div>`).join("")}
      </div>
      <section class="panel admin-users-panel">
        <div class="panel-heading"><div><span class="eyebrow">Users</span><h2>用户列表</h2></div><span class="quiet-label">${users.length} 人</span></div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>注册时间</th><th>最近登录</th><th>写作</th><th>语料</th><th>操作</th></tr></thead>
            <tbody>
              ${users.map((user) => `
                <tr>
                  <td><strong>${escapeHtml(user.display_name || "未命名用户")}</strong><small>${escapeHtml(user.id)}</small></td>
                  <td>${escapeHtml(user.role || "user")}</td>
                  <td><span class="status-pill ${user.status === "active" ? "is-ready" : ""}">${user.status === "active" ? "正常" : "已停用"}</span></td>
                  <td>${formatDate(user.created_at)}</td>
                  <td>${user.last_seen_at ? formatDate(user.last_seen_at) : "—"}</td>
                  <td>${user.writingCount || 0}</td>
                  <td>${user.corpusCount || 0}</td>
                  <td class="admin-row-actions">
                    <button class="text-button" data-action="view-admin-user" data-id="${user.id}">详情</button>
                    <button class="text-button" data-action="toggle-user-status" data-id="${user.id}" data-status="${user.status === "active" ? "disabled" : "active"}">${user.status === "active" ? "停用" : "启用"}</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
      ${selected ? renderAdminUserDetail(selected) : ""}
    </section>
  `;
}

function renderAdminUserDetail(detail) {
  return `
    <section class="panel admin-user-detail">
      <div class="panel-heading">
        <div><span class="eyebrow">User Detail</span><h2>${escapeHtml(detail.profile?.display_name || "用户详情")}</h2></div>
        <button class="text-button" data-action="close-admin-user">关闭</button>
      </div>
      <div class="admin-detail-grid">
        <div><span>作文记录</span><strong>${detail.attempts.length}</strong></div>
        <div><span>语料条目</span><strong>${detail.corpus.length}</strong></div>
        <div><span>复习任务</span><strong>${detail.reviews.length}</strong></div>
      </div>
      <div class="admin-content-list">
        ${detail.attempts.slice(0, 8).map((attempt) => `<article><span>${formatDate(attempt.created_at)}</span><strong>${escapeHtml(attempt.prompt_snapshot?.title || "写作记录")}</strong><p>${escapeHtml(truncate(attempt.response_text, 140))}</p></article>`).join("")}
        ${detail.corpus.slice(0, 8).map((item) => `<article><span>${escapeHtml(item.stage)}</span><strong>${escapeHtml(item.custom_name || item.target_expression || "语料")}</strong><p>${escapeHtml(truncate(item.chinese_intent, 140))}</p></article>`).join("")}
      </div>
    </section>
  `;
}

async function submitPasswordAuth(mode) {
  const form = document.querySelector("#auth-form");
  if (!form) return;
  const formData = new FormData(form);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("displayName") || "").trim();
  state.auth.error = "";
  try {
    if (mode === "signup") {
      const result = await signUpWithPassword(email, password, displayName);
      if (!result.access_token) {
        state.ui.authMode = "login";
        render();
        toast("注册申请已提交，请检查邮箱完成确认。", "success");
        return;
      }
    }
    const result = mode === "signup"
      ? await signInWithPassword(email, password)
      : await signInWithPassword(email, password);
    await applyAuthResult(result);
    toast("登录成功。", "success");
  } catch (error) {
    state.auth.error = error.message || "登录失败。";
    render();
  }
}

async function submitMagicLink() {
  const form = document.querySelector("#auth-form");
  const email = String(new FormData(form).get("email") || "").trim();
  state.auth.error = "";
  try {
    await sendMagicLink(email);
    toast("登录链接已发送，请检查邮箱。", "success");
  } catch (error) {
    state.auth.error = error.message || "发送失败。";
    render();
  }
}

async function applyAuthResult(result) {
  state.auth.session = result.session || getSession();
  state.auth.user = result.user || null;
  state.auth.profile = result.profile || null;
  await syncNow({ renderAfter: false });
  navigate("home");
  render();
}

async function loadAdminData() {
  state.admin.loading = true;
  state.admin.error = "";
  render();
  try {
    state.admin.data = await loadAdminDashboard();
  } catch (error) {
    state.admin.error = error.message || "后台加载失败。";
  } finally {
    state.admin.loading = false;
    render();
  }
}

async function viewAdminUser(userId) {
  state.admin.error = "";
  try {
    state.admin.selectedUser = await loadUserDetail(userId);
    render();
  } catch (error) {
    toast(error.message || "用户详情加载失败。", "error");
  }
}

async function toggleAdminUserStatus(userId, status) {
  try {
    await setUserStatus(userId, status);
    state.admin.selectedUser = null;
    await loadAdminData();
  } catch (error) {
    toast(error.message || "账号状态更新失败。", "error");
  }
}

function renderHome() {
  const session = todaySession();
  const materials = parsedTodayMaterials();
  const vocabulary = materials.filter((item) => item.type === "vocabulary");
  const patterns = materials.filter((item) => item.type === "pattern");
  const recommended = promptById(session?.selectedPromptId || session?.recommendedPromptId);
  const streak = calculateStreak(state.data.attempts);
  const recent = state.data.attempts.slice(0, 7);
  const lastAttempt = recent[0];
  const draftCount = state.data.prompts.length
    ? localStorage.length
    : 0;

  return `
    <section class="page">
      ${pageHeader(
        formatLocalDate(),
        "今天，把新学的语言写成自己的句子",
        "先录入素材，再让系统挑一道最适合今天的题。",
        `<button class="button button-primary" data-action="focus-material">${icon("plus")}录入今日素材</button>`
      )}

      <div class="metric-rail" aria-label="今日学习概况">
        <div class="metric-cell">
          <span>今日词伙</span>
          ${statValue(vocabulary.length, "项")}
        </div>
        <div class="metric-cell">
          <span>今日句式</span>
          ${statValue(patterns.length, "项")}
        </div>
        <div class="metric-cell">
          <span>连续练习</span>
          ${statValue(streak, "天")}
        </div>
        <div class="metric-cell">
          <span>最近成绩</span>
          ${statValue(lastAttempt ? scoreLabel(lastAttempt) : "暂无")}
        </div>
      </div>

      <div class="home-grid">
        <section class="panel material-panel" id="today-materials">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">今日输入</span>
              <h2>把今天学到的放进来</h2>
            </div>
            <span class="quiet-label">${materials.length} 个表达已识别</span>
          </div>
          <div class="material-inputs">
            <label class="field">
              <span>单词与词伙</span>
              <textarea
                id="today-vocabulary"
                data-input="today-vocabulary"
                rows="6"
                placeholder="- tangible benefits: 实际好处&#10;- curb emissions: 减少排放"
              >${escapeHtml(session?.vocabularyRaw || "")}</textarea>
              <small><span data-count="vocabulary">${vocabulary.length}</span> 项可匹配</small>
            </label>
            <label class="field">
              <span>今日句式</span>
              <textarea
                id="today-patterns"
                data-input="today-patterns"
                rows="6"
                placeholder="- while concession: While X..., Y...&#10;- not only inversion: Not only does X..., but it also..."
              >${escapeHtml(session?.patternsRaw || "")}</textarea>
              <small><span data-count="pattern">${patterns.length}</span> 项可匹配</small>
            </label>
          </div>
          <div class="material-actions">
            <span class="parse-note">每行一个 <code>名字：内容</code>，中英文冒号都支持。</span>
            <button class="button button-primary" data-action="match-prompt" ${materials.length ? "" : "disabled"}>
              ${state.ui.matching ? icon("clock") : icon("sparkle")}
              ${state.ui.matching ? "正在匹配" : recommended ? "重新匹配今日题目" : "匹配一道今日题目"}
            </button>
          </div>
        </section>

        <section class="panel prompt-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">今日任务</span>
              <h2>${recommended ? "这道题最适合今天的语言" : "等待匹配"}</h2>
            </div>
            ${recommended ? taskBadge(recommended.taskType) : ""}
          </div>
          ${recommended ? `
            <div class="prompt-title-row">
              <h3>${escapeHtml(recommended.title)}</h3>
              <span>${escapeHtml(recommended.topic || "General")} · ${escapeHtml(recommended.taskKind || "Practice")}</span>
            </div>
            <p class="prompt-text">${escapeHtml(recommended.promptText)}</p>
            <div class="match-reason">
              ${icon("sparkle", 16)}
              <span>${escapeHtml(session.matchReason || "根据主题、写作功能和今日表达进行匹配。")}</span>
            </div>
            <div class="prompt-actions">
              <button class="button button-primary" data-action="start-practice">
                ${icon("play")}开始练习
              </button>
              <button class="button button-ghost" data-action="choose-prompt">更换题目</button>
            </div>
          ` : `
            <div class="empty-state compact">
              <span class="empty-icon">${icon("sparkle", 28)}</span>
              <strong>先录入今天的词伙和句式</strong>
              <p>系统会优先寻找能自然容纳这些语言的题目。</p>
            </div>
          `}
        </section>
      </div>

      <div class="lower-grid">
        <section class="panel trend-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">近期走势</span>
              <h2>写作表现</h2>
            </div>
            <a href="#/history" class="text-link">查看全部 ${icon("arrow", 15)}</a>
          </div>
          ${renderSparkline(recent)}
          <div class="trend-caption">
            <span>简易练习按 10 分制</span>
            <span>正式作文按 9 分 Band</span>
          </div>
        </section>

        <section class="panel recent-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">最近记录</span>
              <h2>继续回看</h2>
            </div>
          </div>
          ${recent.length ? `
            <div class="recent-list">
              ${recent.slice(0, 4).map((attempt) => `
                <a class="recent-row" href="#/report/${attempt.id}">
                  <div>
                    <strong>${escapeHtml(attempt.promptSnapshot?.title || "未命名题目")}</strong>
                    <span>${formatDate(attempt.createdAt)} · ${MODE_LABELS[attempt.mode] || attempt.mode}</span>
                  </div>
                  <span class="score-chip">${scoreLabel(attempt)}</span>
                </a>
              `).join("")}
            </div>
          ` : `
            <div class="empty-state compact">
              <span class="empty-icon">${icon("book", 28)}</span>
              <strong>还没有练习记录</strong>
              <p>完成第一篇后，这里会出现评分和可回溯的报告。</p>
            </div>
          `}
        </section>
      </div>
    </section>
  `;
}

function renderSparkline(attempts) {
  if (!attempts.length) {
    return `<div class="chart-empty">完成一次练习后生成趋势线。</div>`;
  }
  const ordered = attempts.slice().reverse();
  const points = ordered.map((attempt, index) => {
    const x = ordered.length === 1 ? 150 : 24 + (index * 252) / (ordered.length - 1);
    const y = 76 - scoreRatio(attempt) * 52;
    return { x, y, label: scoreLabel(attempt) };
  });
  const path = points.map((point) => `${point.x},${point.y}`).join(" ");
  return `
    <div class="sparkline-wrap">
      <svg class="sparkline" viewBox="0 0 300 92" role="img" aria-label="最近练习成绩趋势">
        <path d="M24 76H276" class="chart-axis"/>
        <polyline points="${path}" class="chart-line"/>
        ${points.map((point) => `
          <circle cx="${point.x}" cy="${point.y}" r="4" class="chart-dot">
            <title>${escapeHtml(point.label)}</title>
          </circle>
        `).join("")}
      </svg>
    </div>
  `;
}

function renderBank() {
  const query = state.bank.query.trim().toLowerCase();
  const filtered = state.data.prompts.filter((prompt) => {
    const taskMatch = state.bank.taskType === "all" || prompt.taskType === state.bank.taskType;
    const haystack = [prompt.title, prompt.promptText, prompt.topic, prompt.taskKind, ...(prompt.tags || [])]
      .join(" ")
      .toLowerCase();
    return taskMatch && (!query || haystack.includes(query));
  });

  return `
    <section class="page">
      ${pageHeader(
        "写作题库",
        "题目要清楚，匹配才有依据",
        `${state.data.prompts.length} 道写作题，Task 1 与 Task 2 分开管理。`,
        `
          <button class="button button-ghost" data-action="import-prompts">${icon("upload")}导入</button>
          <button class="button button-ghost" data-action="export-prompts">${icon("download")}导出</button>
          <button class="button button-primary" data-action="new-prompt">${icon("plus")}新建题目</button>
        `
      )}

      <div class="filter-bar">
        <label class="search-field">
          ${icon("search")}
          <input type="search" data-input="bank-search" value="${escapeHtml(state.bank.query)}" placeholder="搜索题目、主题或标签" />
        </label>
        <div class="segmented" role="group" aria-label="筛选题型">
          ${[
            ["all", "全部"],
            ["task1", "Task 1"],
            ["task2", "Task 2"],
          ].map(([value, label]) => `
            <button class="${state.bank.taskType === value ? "is-active" : ""}" data-action="filter-bank" data-value="${value}">
              ${label}
            </button>
          `).join("")}
        </div>
      </div>

      <div id="bank-list" class="prompt-list">
        ${renderBankList(filtered)}
      </div>
    </section>
  `;
}

function renderBankList(prompts) {
  if (!prompts.length) {
    return `
      <div class="empty-state panel">
        <span class="empty-icon">${icon("library", 30)}</span>
        <strong>没有找到题目</strong>
        <p>调整筛选条件，或导入一份 Markdown 题库。</p>
      </div>
    `;
  }
  return prompts.map((prompt) => `
    <article class="prompt-list-item">
      <div class="prompt-list-main">
        <div class="prompt-list-meta">
          ${taskBadge(prompt.taskType)}
          <span>${escapeHtml(prompt.topic || "General")}</span>
          <span>${escapeHtml(prompt.taskKind || "Practice")}</span>
        </div>
        <h2>${escapeHtml(prompt.title)}</h2>
        <p>${escapeHtml(prompt.promptText)}</p>
        <div class="tag-row">
          ${(prompt.tags || []).slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
        </div>
      </div>
      <div class="prompt-list-actions">
        <button class="button button-small button-primary" data-action="use-prompt" data-id="${prompt.id}">
          ${icon("play", 15)}用于今天
        </button>
        <button class="icon-button" data-action="edit-prompt" data-id="${prompt.id}" aria-label="编辑题目" title="编辑题目">
          ${icon("edit")}
        </button>
        <button class="icon-button danger" data-action="delete-prompt" data-id="${prompt.id}" aria-label="删除题目" title="删除题目">
          ${icon("trash")}
        </button>
      </div>
    </article>
  `).join("");
}

function renderPractice() {
  const session = todaySession();
  const materials = parsedTodayMaterials();
  const prompt = activePrompt();
  const mode = state.ui.mode;
  const draft = prompt ? readDraft(prompt.id, mode) : "";
  const tabs = renderPracticeModeTabs("writing");

  if (!prompt) {
    return `
      <section class="page">
        ${tabs}
        ${pageHeader("写作练习", "还没有今天的题目", "先录入素材并匹配，或者从题库手动选择。")}
        <div class="empty-state panel">
          <span class="empty-icon">${icon("pen", 30)}</span>
          <strong>选择一道题开始</strong>
          <p>匹配会自动保留今天的素材，正式提交后进入完整报告。</p>
          <a class="button button-primary" href="#/home">${icon("sparkle")}去匹配今日题目</a>
        </div>
      </section>
    `;
  }

  const words = wordCount(draft);
  const minimum = mode === "simple" ? 80 : prompt.taskType === "task1" ? 150 : 250;
  const defaultMinutes = mode === "simple" ? 15 : 40;
  const initialTimerSeconds = state.timer.remainingSeconds || defaultMinutes * 60;

  return `
    <section class="page practice-page">
      ${tabs}
      <header class="practice-head">
        <button class="back-link" data-action="go-home">${icon("close", 17)}退出练习</button>
        <div>
          <span class="eyebrow">${MODE_LABELS[mode]} · ${prompt.taskType === "task1" ? "Task 1" : "Task 2"}</span>
          <h1>${escapeHtml(prompt.title)}</h1>
        </div>
        <div class="timer-control">
          <span id="timer-value">${formatTimer(initialTimerSeconds)}</span>
          <input id="timer-minutes" type="number" min="1" max="120" value="${defaultMinutes}" aria-label="计时分钟" />
          <button class="icon-button" data-action="start-timer" aria-label="开始计时" title="开始计时">${icon("play", 16)}</button>
          <button class="icon-button" data-action="reset-timer" aria-label="重置计时" title="重置计时">${icon("clock", 16)}</button>
        </div>
      </header>

      ${state.evaluating ? renderEvaluatingState() : `
        <div class="practice-toolbar">
          <div class="segmented" role="group" aria-label="写作模式">
            ${[
              ["simple", "简易练习"],
              ["formal", "正式作文"],
            ].map(([value, label]) => `
              <button class="${mode === value ? "is-active" : ""}" data-action="set-mode" data-value="${value}">${label}</button>
            `).join("")}
          </div>
          <div class="word-progress ${words >= minimum ? "is-ready" : ""}">
            <span><strong id="word-count">${words}</strong> 词</span>
            <small>${mode === "simple" ? `建议 ${minimum}–150 词` : `建议至少 ${minimum} 词`}</small>
          </div>
        </div>

        <div class="practice-layout">
          <section class="writing-sheet">
            <div class="writing-sheet-head">
              <span>Prompt</span>
              <button class="text-button" data-action="copy-prompt">${icon("download", 15)}复制题目</button>
            </div>
            <p class="prompt-text large">${escapeHtml(prompt.promptText)}</p>
            <div class="editor-wrap">
              <textarea
                id="response-text"
                data-input="response"
                spellcheck="true"
                aria-label="作文正文"
                placeholder="${mode === "simple" ? "写 80–150 词，重点是把今天的词伙和句式写进完整句子里。" : "写完整作文。提交后会按 IELTS 四项标准给出估算。"}"
              >${escapeHtml(draft)}</textarea>
            </div>
            <div class="writing-footer">
              <span>草稿自动保存在当前浏览器</span>
              <button class="button button-primary button-large" data-action="submit-response">
                ${icon("sparkle")}提交评分
              </button>
            </div>
          </section>

          <aside class="practice-side">
            <section class="side-section">
              <div class="side-heading">
                <span>今日目标语言</span>
                <strong>${materials.length}</strong>
              </div>
              ${materials.length ? `
                <div class="target-list">
                  ${materials.map((item) => `
                    <button class="target-chip" data-action="copy-target" data-text="${escapeHtml(item.label)}" title="点击复制">
                      <span>${escapeHtml(item.label)}</span>
                      <small>${item.type === "vocabulary" ? "词伙" : "句式"}</small>
                    </button>
                  `).join("")}
                </div>
              ` : `
                <p class="quiet-copy">今天还没有素材。直接写作不会触发素材使用检查。</p>
              `}
            </section>
            <section class="side-section mode-note">
              <span class="eyebrow">${mode === "simple" ? "练习边界" : "正式评分"}</span>
              <p>${mode === "simple"
                ? "按 10 分制检查任务回应、观点、目标词句和句子控制，不出 IELTS Band。"
                : "四项等权：任务回应、连贯衔接、词汇资源和语法范围与准确度。"}</p>
            </section>
          </aside>
        </div>
      `}
    </section>
  `;
}

function renderPracticeModeTabs(active) {
  return `
    <div class="practice-mode-switch" role="tablist" aria-label="练习类型">
      <button class="${active === "writing" ? "is-active" : ""}" data-action="set-practice-mode" data-value="writing">
        ${icon("pen", 16)}IELTS 写作练习
      </button>
      <button class="${active === "corpus" ? "is-active" : ""}" data-action="set-practice-mode" data-value="corpus">
        ${icon("sparkle", 16)}语料库表达训练
      </button>
    </div>
  `;
}

function corpusItemById(id) {
  return state.data.corpusItems.find((item) => item.id === id) || null;
}

function corpusDisplayName(item) {
  return String(item?.customName || item?.targetExpression || "未命名表达").trim();
}

const CORPUS_REVIEW_INTERVALS = [2, 3, 7, 15, 30, 60];
const CORPUS_TEST_TYPES = [
  ["translation", "中文翻译成英文"],
  ["framework_fill", "补全框架"],
  ["framework_sentence", "根据框架写句子"],
  ["meaning_recall", "主动回忆中文含义"],
];

function createCorpusLearningPlan() {
  return {
    firstAttempt: {
      limitSeconds: 420,
      status: "pending",
      startedAt: null,
      deadlineAt: null,
      completedAt: null,
      timedOut: false,
    },
    card: {
      limitSeconds: 300,
      status: "pending",
      startedAt: null,
      deadlineAt: null,
      completedAt: null,
      timedOut: false,
    },
    sameDayTests: [
      { id: uid("same_day"), slot: "first", status: "locked", availableAt: null, limitSeconds: 180 },
      { id: uid("same_day"), slot: "second", status: "locked", availableAt: null, limitSeconds: 180 },
    ],
    scheduledReviews: [],
  };
}

function ensureCorpusLearningPlan(item) {
  if (!item.learningPlan) item.learningPlan = createCorpusLearningPlan();
  return item.learningPlan;
}

function scheduleNextCorpusReview(item, from = new Date()) {
  const plan = ensureCorpusLearningPlan(item);
  const completed = plan.scheduledReviews.filter((review) => review.status === "completed").length;
  const intervalDays = CORPUS_REVIEW_INTERVALS[completed];
  if (!intervalDays) return null;
  const dueAt = new Date(from);
  dueAt.setDate(dueAt.getDate() + intervalDays);
  const review = {
    id: uid("review"),
    intervalDays,
    targetSeconds: intervalDays <= 3 ? 180 : 300,
    status: "pending",
    dueAt: dueAt.toISOString(),
    startedAt: null,
    deadlineAt: null,
    completedAt: null,
    timedOut: false,
  };
  plan.scheduledReviews.push(review);
  return review;
}

function corpusRetrievalSession(item, id) {
  const plan = ensureCorpusLearningPlan(item);
  return [...plan.sameDayTests, ...plan.scheduledReviews].find((entry) => entry.id === id) || null;
}

function buildCorpusRetrievalQuestion(item, session) {
  const preferences = item.testProfile?.preferences?.length
    ? item.testProfile.preferences
    : CORPUS_TEST_TYPES.map(([id]) => id);
  const type = preferences[Math.floor(Math.random() * preferences.length)];
  if (type === "framework_fill") {
    return {
      type,
      prompt: item.abstractFramework,
      instruction: "补全并写出完整框架。",
      localAnswer: item.abstractFramework,
    };
  }
  if (type === "framework_sentence") {
    return {
      type,
      prompt: item.chineseIntent,
      instruction: `使用框架：${item.abstractFramework}`,
      localAnswer: "",
    };
  }
  if (type === "meaning_recall") {
    return {
      type,
      prompt: item.standardExpression,
      instruction: "主动回忆这句话的中文含义。",
      localAnswer: item.firstEvaluation?.standardExpressionBackTranslation || item.chineseIntent,
    };
  }
  return {
    type: "translation",
    prompt: item.reusedChinesePrompt || item.chineseIntent,
    instruction: "主动回忆并翻译成英文，不要查看标准答案。",
    localAnswer: "",
  };
}

function corpusStageMeta(stage) {
  const stages = {
    new: { label: "New", description: "第一次认识，看到中文能理解", className: "new" },
    controlled: { label: "Controlled", description: "有框架时能正确写出来", className: "controlled" },
    reused: { label: "Reused", description: "能在新语境中自己表达", className: "reused" },
    spontaneous: { label: "Spontaneous", description: "已在真实表达中自然使用", className: "spontaneous" },
  };
  return stages[stage] || stages.new;
}

function renderCorpusPage() {
  if (state.route.id === "new") return renderCorpusNew();
  if (state.route.id) return renderCorpusItem(state.route.id);
  return renderCorpusDashboard();
}

function renderCorpusDashboard() {
  const items = state.data.corpusItems;
  const counts = {
    new: items.filter((item) => item.stage === "new").length,
    controlled: items.filter((item) => item.stage === "controlled").length,
    reused: items.filter((item) => item.stage === "reused").length,
    spontaneous: items.filter((item) => item.stage === "spontaneous").length,
  };
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const due = items.filter((item) => item.nextReviewAt && new Date(item.nextReviewAt) <= todayEnd);
  const filtered = filterCorpusItems(items);

  return `
    <section class="page corpus-page">
      ${renderPracticeModeTabs("corpus")}
      ${pageHeader(
        "Personal Corpus",
        "把一个表达从认识练到自然使用",
        "先看中文自己表达，再确认 IELTS 标准和抽象框架，最后逐级验证是否真正掌握。",
        `<button class="button button-primary" data-action="new-corpus">${icon("plus")}新建语料</button>`
      )}
      <div class="corpus-stage-rail">
        ${Object.entries(counts).map(([stage, count]) => {
          const meta = corpusStageMeta(stage);
          return `<button class="corpus-stage-stat stage-${stage}" data-action="filter-corpus" data-value="${stage}"><span>${meta.label}</span>${statValue(count, "项")}</button>`;
        }).join("")}
      </div>
      <div class="corpus-dashboard-grid">
        <section class="panel corpus-review-panel">
          <div class="panel-heading">
            <div><span class="eyebrow">Today's Review</span><h2>今日复习</h2></div>
            <strong>${due.length} 项到期</strong>
          </div>
          ${due.length ? `
            <div class="corpus-compact-list">
              ${due.slice(0, 5).map((item) => `
                <a href="#/corpus/${item.id}">
                  <div><strong>${escapeHtml(item.targetExpression || item.chineseIntent)}</strong><span>${escapeHtml(truncate(item.chineseIntent, 55))}</span></div>
                  <span class="corpus-stage-badge stage-${item.stage}">${corpusStageMeta(item.stage).label}</span>
                </a>
              `).join("")}
            </div>
          ` : `
            <div class="empty-state compact">
              <span class="empty-icon">${icon("check", 28)}</span>
              <strong>今天没有到期内容</strong>
              <p>新建语料或继续升级已有内容。</p>
            </div>
          `}
        </section>
        <section class="panel corpus-method-panel">
          <span class="eyebrow">Mastery Path</span>
          <h2>四级掌握路径</h2>
          <ol class="stage-method-list">
            ${["new", "controlled", "reused", "spontaneous"].map((stage, index) => `
              <li>
                <span>${index + 1}</span>
                <div><strong>${corpusStageMeta(stage).label}</strong><p>${corpusStageMeta(stage).description}</p></div>
              </li>
            `).join("")}
          </ol>
        </section>
      </div>
      <div class="filter-bar corpus-filter-bar">
        <label class="search-field">
          ${icon("search")}
          <input type="search" data-input="corpus-search" value="${escapeHtml(state.ui.corpusQuery)}" placeholder="搜索中文、目标表达或标签" />
        </label>
        <div class="segmented" role="group" aria-label="筛选掌握阶段">
          ${[
            ["all", "全部"],
            ["new", "New"],
            ["controlled", "Controlled"],
            ["reused", "Reused"],
            ["spontaneous", "Spontaneous"],
          ].map(([value, label]) => `
            <button class="${state.ui.corpusFilter === value ? "is-active" : ""}" data-action="filter-corpus" data-value="${value}">${label}</button>
          `).join("")}
        </div>
      </div>
      <div id="corpus-list">
        ${renderCorpusList(filtered)}
      </div>
    </section>
  `;
}

function filterCorpusItems(items = state.data.corpusItems) {
  const query = state.ui.corpusQuery.trim().toLowerCase();
  return items.filter((item) => {
    const stageMatch = state.ui.corpusFilter === "all" || item.stage === state.ui.corpusFilter;
    const haystack = [item.customName, item.chineseIntent, item.targetExpression, ...(item.topicTags || [])].join(" ").toLowerCase();
    return stageMatch && (!query || haystack.includes(query));
  });
}

function renderCorpusList(items) {
  if (!items.length) {
    return `
      <div class="empty-state panel">
        <span class="empty-icon">${icon("sparkle", 30)}</span>
        <strong>还没有符合条件的语料</strong>
        <p>新建一条语料，从中文含义开始第一次表达。</p>
        <button class="button button-primary" data-action="new-corpus">${icon("plus")}新建语料</button>
      </div>
    `;
  }
  return `
    <div class="corpus-list">
      ${items.map((item) => `
        <a class="corpus-card" href="#/corpus/${item.id}">
          <div class="corpus-card-head">
            <span class="corpus-stage-badge stage-${item.stage}">${corpusStageMeta(item.stage).label}</span>
            <small>${item.nextReviewAt ? `复习 ${formatShortDate(item.nextReviewAt)}` : ""}</small>
          </div>
          <h2>${escapeHtml(corpusDisplayName(item))}</h2>
          <p>${escapeHtml(truncate(item.chineseIntent, 110))}</p>
          <div class="corpus-card-foot">
            <span>${escapeHtml((item.topicTags || []).join(" · ") || "未分类")}</span>
            <span>真实使用 ${(item.usageRecords || []).filter((record) => record.qualifiesAsRealUse).length}/3</span>
          </div>
        </a>
      `).join("")}
    </div>
  `;
}

function renderCorpusNew() {
  const draft = state.ui.corpusDraft || {};
  const preferences = draft.preferences?.length
    ? draft.preferences
    : CORPUS_TEST_TYPES.map(([id]) => id);
  return `
    <section class="page corpus-page">
      ${renderPracticeModeTabs("corpus")}
      ${pageHeader(
        "New Corpus Item",
        "先写下你想表达的中文",
        "目标词句可选。第一次只显示中文，避免直接套答案。",
        `<button class="back-link" data-action="corpus-dashboard">${icon("arrow", 16)}返回语料库</button>`
      )}
      <section class="corpus-create panel">
        <label class="field">
          <span>中文想表达的内容</span>
          <textarea id="corpus-chinese" rows="5" placeholder="例如：企业应该为其环境影响对公众负责。">${escapeHtml(draft.chineseIntent || "")}</textarea>
        </label>
        <div class="form-grid corpus-create-meta">
          <label class="field">
            <span>目标词伙或句式</span>
            <input id="corpus-target" value="${escapeHtml(draft.targetExpression || "")}" placeholder="take responsibility for + noun" />
          </label>
          <label class="field">
            <span>主题标签</span>
            <input id="corpus-tags" value="${escapeHtml(draft.topicTags || "")}" placeholder="environment, business" />
          </label>
        </div>
        <div class="form-grid corpus-profile-grid">
          <label class="field">
            <span>当前能力水平</span>
            <select id="corpus-level">
              <option value="beginner" ${draft.level === "beginner" ? "selected" : ""}>新手</option>
              <option value="intermediate" ${!draft.level || draft.level === "intermediate" ? "selected" : ""}>中级</option>
              <option value="advanced" ${draft.level === "advanced" ? "selected" : ""}>高级</option>
            </select>
          </label>
          <fieldset class="field corpus-preference-field">
            <legend>测试题型偏好（可多选）</legend>
            <div class="preference-options">
              ${CORPUS_TEST_TYPES.map(([id, label]) => `
                <label><input type="checkbox" name="corpus-preference" value="${id}" ${preferences.includes(id) ? "checked" : ""} />${label}</label>
              `).join("")}
            </div>
          </fieldset>
        </div>
        <label class="field">
          <span>你的第一次英文尝试</span>
          <textarea id="corpus-first-attempt" rows="6" placeholder="先按自己的理解写一次，不需要提前查看标准答案。" ${draft.firstAttemptStartedAt && !draft.firstAttemptTimedOut ? "" : "disabled"}>${escapeHtml(draft.firstAttempt || "")}</textarea>
        </label>
        <div class="corpus-submit-row">
          <span>
            ${draft.firstAttemptTimedOut ? "7 分钟已结束，正在提交这次表达。" : draft.firstAttemptStartedAt ? "第一次表达限时 7 分钟。" : "准备好后手动开始 7 分钟倒计时。"}
            <strong data-corpus-countdown data-deadline="${escapeHtml(draft.firstAttemptDeadlineAt || "")}" data-kind="first-draft">07:00</strong>
          </span>
          ${draft.firstAttemptStartedAt ? `
            <button class="button button-primary button-large" data-action="submit-corpus-first" ${state.ui.corpusBusy ? "disabled" : ""}>
              ${state.ui.corpusBusy ? icon("clock") : icon("sparkle")}
              ${state.ui.corpusBusy ? "正在评价" : "提前提交"}
            </button>
          ` : `
            <button class="button button-primary button-large" data-action="start-corpus-first-timer">
              ${icon("play")}开始 7 分钟打卡
            </button>
          `}
        </div>
      </section>
    </section>
  `;
}

function renderCorpusItem(id) {
  const item = corpusItemById(id);
  if (!item) {
    return `
      <section class="page corpus-page">
        ${renderPracticeModeTabs("corpus")}
        ${pageHeader("Corpus", "找不到这条语料")}
        <div class="empty-state panel"><button class="button button-primary" data-action="corpus-dashboard">${icon("arrow")}返回语料库</button></div>
      </section>
    `;
  }
  const stage = corpusStageMeta(item.stage);
  return `
    <section class="page corpus-page corpus-item-page">
      ${renderPracticeModeTabs("corpus")}
      <header class="corpus-item-head">
        <button class="back-link" data-action="corpus-dashboard">${icon("arrow", 16)}返回语料库</button>
        <div class="corpus-item-title">
          <div><span class="corpus-stage-badge stage-${item.stage}">${stage.label}</span><span class="quiet-label">${escapeHtml(stage.description)}</span></div>
          ${state.ui.renamingCorpusId === item.id ? `
            <div class="corpus-name-editor">
              <input id="corpus-custom-name" value="${escapeHtml(item.customName || "")}" placeholder="给这个表达起一个容易记住的名字" autofocus />
              <button class="button button-primary button-small" data-action="save-corpus-name" data-id="${item.id}">${icon("check", 15)}保存名称</button>
              <button class="button button-ghost button-small" data-action="cancel-corpus-name">取消</button>
            </div>
          ` : `
            <div class="corpus-name-row">
              <h1>${escapeHtml(corpusDisplayName(item))}</h1>
              <button class="text-button" data-action="rename-corpus" data-id="${item.id}">${icon("edit", 15)}${item.customName ? "修改名字" : "命名"}</button>
            </div>
          `}
          <p>${escapeHtml(item.chineseIntent)}</p>
        </div>
      </header>
      ${renderCorpusProgress(item)}
      ${renderCorpusLearningPlan(item)}
      ${renderCorpusCurrentStep(item)}
      ${renderCorpusRecordTimeline(item)}
      <div class="corpus-reset">
        <div><strong>手动调整阶段</strong><span>不会自动降级。你可以重置后重新练习。</span></div>
        <select id="corpus-reset-stage">
          ${["new", "controlled", "reused", "spontaneous"].map((value) => `<option value="${value}">${corpusStageMeta(value).label}</option>`).join("")}
        </select>
        <button class="button button-ghost button-small" data-action="reset-corpus-stage" data-id="${item.id}">重置阶段</button>
      </div>
    </section>
  `;
}

function renderCorpusProgress(item) {
  const order = ["new", "controlled", "reused", "spontaneous"];
  const currentIndex = order.indexOf(item.stage);
  return `
    <div class="corpus-progress">
      ${order.map((stage, index) => `
        <div class="${index <= currentIndex ? "is-reached" : ""} ${index === currentIndex ? "is-current" : ""}">
          <span>${index + 1}</span>
          <strong>${corpusStageMeta(stage).label}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderCorpusLearningPlan(item) {
  const plan = ensureCorpusLearningPlan(item);
  const active = state.ui.activeRetrieval?.itemId === item.id
    ? corpusRetrievalSession(item, state.ui.activeRetrieval.sessionId)
    : null;
  const now = Date.now();
  return `
    <section class="corpus-learning-plan panel">
      <div class="step-head">
        <span class="eyebrow">Retrieval Plan</span>
        <h2>学习与复习打卡</h2>
      </div>
      <div class="retrieval-timeline">
        <div class="${plan.firstAttempt.status === "completed" ? "is-complete" : "is-current"}">
          <span>第一次表达</span>
          <strong>7 分钟倒计时</strong>
          <small>${plan.firstAttempt.timedOut ? "已超时自动提交" : plan.firstAttempt.status === "completed" ? "已完成" : "输入英文时自动开始"}</small>
        </div>
        <div class="${plan.card.status === "completed" ? "is-complete" : plan.firstAttempt.status === "completed" ? "is-current" : ""}">
          <span>做卡</span>
          <strong>5 分钟倒计时</strong>
          <small>${plan.card.timedOut ? "超时后继续完成" : plan.card.status === "completed" ? "已完成" : "确认框架与基础词伙"}</small>
        </div>
        ${plan.sameDayTests.map((test, index) => {
          const available = test.status === "available" || test.status === "active";
          return `
            <div class="${test.status === "completed" ? "is-complete" : available ? "is-current" : ""}">
              <span>当天自测 ${index + 1}</span>
              <strong>3 分钟倒计时</strong>
              <small>${test.status === "completed" ? `完成 · ${test.result?.naturalness?.score ?? "-"}/10` : test.availableAt && new Date(test.availableAt) > new Date(now) ? `${formatDate(test.availableAt)} 开放` : test.status === "locked" ? "完成做卡后开放" : "待打卡"}</small>
              ${test.status === "available" ? `<button class="button button-ghost button-small" data-action="start-corpus-retrieval" data-id="${item.id}" data-session="${test.id}">开始打卡</button>` : ""}
            </div>
          `;
        }).join("")}
        ${plan.scheduledReviews.map((review) => `
          <div class="${review.status === "completed" ? "is-complete" : review.status === "pending" && new Date(review.dueAt) <= new Date(now) ? "is-current" : ""}">
            <span>第 ${review.intervalDays} 天复习</span>
            <strong>${Math.round(review.targetSeconds / 60)} 分钟倒计时</strong>
            <small>${review.status === "completed" ? "已完成" : `${formatDate(review.dueAt)} ${new Date(review.dueAt) <= new Date(now) ? "· 已到期" : ""}`}</small>
            ${review.status === "pending" && new Date(review.dueAt) <= new Date(now) ? `<button class="button button-ghost button-small" data-action="start-corpus-retrieval" data-id="${item.id}" data-session="${review.id}">开始复习</button>` : ""}
          </div>
        `).join("")}
      </div>
      ${active ? renderCorpusRetrievalWorkspace(item, active) : ""}
    </section>
  `;
}

function renderCorpusRetrievalWorkspace(item, session) {
  return `
    <div class="retrieval-workspace">
      <div class="retrieval-workspace-head">
        <div>
          <span class="eyebrow">${session.slot ? `Same-day Test ${session.slot === "first" ? "1" : "2"}` : `Day ${session.intervalDays} Review`}</span>
          <h3>${escapeHtml(session.question?.instruction || "主动回忆")}</h3>
        </div>
        <strong data-corpus-countdown data-deadline="${session.deadlineAt}" data-session="${session.id}">--:--</strong>
      </div>
      <div class="retrieval-question">${escapeHtml(session.question?.prompt || "")}</div>
      <label class="field">
        <span>你的回答</span>
        <textarea data-corpus-retrieval-answer rows="4" placeholder="先主动回忆，再提交。">${escapeHtml(session.answer || "")}</textarea>
      </label>
      ${session.timedOut ? `<p class="practice-warning">倒计时已结束。本次允许继续，但会记录为超时。</p>` : ""}
      <div class="corpus-step-actions">
        <span>完成主动回忆并回答全部问题即可打卡。</span>
        <button class="button button-primary" data-action="check-corpus-retrieval" data-id="${item.id}" data-session="${session.id}">${icon("check")}提交本次复习</button>
      </div>
      ${session.result ? renderCorpusCheckFeedback(session.result) : ""}
    </div>
  `;
}

function renderCorpusCurrentStep(item) {
  if (state.ui.corpusBusy) {
    return `
      <section class="corpus-step panel corpus-loading">
        <div class="evaluation-orbit" aria-hidden="true"><span></span><span></span>${icon("sparkle", 30)}</div>
        <h2>正在检查语料练习</h2>
        <p>当前内容已经保存，不会丢失。</p>
      </section>
    `;
  }
  if (!item.firstEvaluation) return renderCorpusFirstFailure(item);
  if (!item.frameworkConfirmedAt) return renderCorpusFrameworkConfirmation(item);
  if (item.stage === "new") return renderCorpusControlled(item);
  if (item.stage === "controlled") return renderCorpusReused(item);
  return renderCorpusUsageTracker(item);
}

function renderCorpusFirstFailure(item) {
  return `
    <section class="corpus-step panel">
      <div class="step-head"><span class="eyebrow">First Attempt</span><h2>第一次评价尚未完成</h2></div>
      <blockquote>${escapeHtml(item.firstAttempt)}</blockquote>
      <p class="step-instruction">你的输入已经保存。可以重新提交，不会创建重复语料。</p>
      <button class="button button-primary" data-action="retry-corpus-evaluate" data-id="${item.id}">${icon("sparkle")}重新评价</button>
    </section>
  `;
}

function renderCorpusFrameworkConfirmation(item) {
  const evaluation = item.firstEvaluation || {};
  return `
    <section class="corpus-step panel">
      <div class="step-head">
        <div><span class="eyebrow">5-Minute Card</span><h2>确认框架与基础词伙</h2></div>
        <strong class="card-countdown" data-corpus-countdown data-deadline="${escapeHtml(item.learningPlan?.card?.deadlineAt || "")}">05:00</strong>
      </div>
      <div class="corpus-first-summary">
        <blockquote>${escapeHtml(item.firstAttempt)}</blockquote>
        <div class="coverage-grid corpus-assessment-grid">
          ${[
            ["意思表达", evaluation.meaningMatch],
            ["自然程度", evaluation.naturalness],
            ["目标表达", evaluation.targetUsage],
          ].map(([label, result]) => {
            const isNaturalness = label === "自然程度";
            const badge = isNaturalness
              ? `${Number(result?.score ?? (result?.status === "complete" ? 8 : result?.status === "partial" ? 5 : 2))}/10${result?.level ? ` · ${escapeHtml(result.level)}` : ""}`
              : escapeHtml(result?.status || "missing");
            return `
            <div class="coverage-item status-${escapeHtml(result?.status || "missing")}">
              <div><strong>${label}</strong><small ${isNaturalness ? 'data-naturalness-score' : ""}>${badge}</small></div>
              <p>${escapeHtml(result?.comment || "")}</p>
            </div>
          `;
          }).join("")}
        </div>
      </div>
      ${renderCorrectionPairs(evaluation.errors, "")}
      <h3 class="natural-version-heading">自然版本：</h3>
      <div class="standard-expression">${escapeHtml(evaluation.standardExpression)}</div>
      <p class="back-translation">中文回译：${escapeHtml(evaluation.standardExpressionBackTranslation)}</p>
      <div class="framework-confirm">
        <div><span class="eyebrow">Abstract Framework</span><h3>确认抽象框架</h3><p>${escapeHtml(evaluation.frameworkExplanation)}</p></div>
        <label class="field">
          <span>框架（可修改）</span>
          <textarea id="corpus-framework" rows="3">${escapeHtml(item.abstractFramework || evaluation.abstractFramework)}</textarea>
        </label>
        <label class="field">
          <span>基础词伙与搭配（每行一个）</span>
          <textarea id="corpus-base-chunks" rows="3">${escapeHtml((item.baseChunks || evaluation.baseChunks || []).join("\n"))}</textarea>
        </label>
        ${evaluation.frameworkUsageCondition ? `<div class="usage-condition"><span>使用条件</span><p>${escapeHtml(evaluation.frameworkUsageCondition)}</p></div>` : ""}
        <button class="button button-primary" data-action="confirm-corpus-framework" data-id="${item.id}">${icon("check")}确认框架，进入 Controlled</button>
      </div>
    </section>
  `;
}

function renderCorpusControlled(item) {
  const feedback = item.controlledEvaluation;
  return `
    <section class="corpus-step panel">
      <div class="step-head"><span class="eyebrow">Controlled</span><h2>根据框架写一个正确版本</h2></div>
      <p class="step-instruction">${escapeHtml(item.firstEvaluation?.controlledPrompt || item.chineseIntent)}</p>
      <div class="framework-display"><span>已确认框架</span><code>${escapeHtml(item.abstractFramework)}</code></div>
      <label class="field">
        <span>你的 Controlled 版本</span>
        <textarea data-corpus-answer="controlled" rows="5" placeholder="使用框架，但内容要符合中文含义。">${escapeHtml(item.controlledAttempt || "")}</textarea>
      </label>
      <div class="corpus-step-actions">
        <span>通过后进入 Reused 测试。</span>
        <button class="button button-primary" data-action="check-corpus-controlled" data-id="${item.id}" ${state.ui.corpusBusy ? "disabled" : ""}>${icon("check")}检查并提交</button>
      </div>
      ${feedback ? renderCorpusCheckFeedback(feedback) : ""}
    </section>
  `;
}

function renderCorpusReused(item) {
  const feedback = item.reusedEvaluation;
  const chinesePrompt = isChineseCorpusPrompt(item.reusedChinesePrompt) ? item.reusedChinesePrompt : "";
  return `
    <section class="corpus-step panel">
      <div class="step-head"><span class="eyebrow">Reused Test</span><h2>新语境，自己表达</h2></div>
      ${chinesePrompt
        ? `<p class="step-instruction reused-chinese-prompt">${escapeHtml(chinesePrompt)}</p>`
        : `<div class="empty-state compact"><strong>正在准备随机中文语境</strong><p>点击下方按钮生成一条可以套用当前框架的中文句子。</p></div>`}
      <div class="reused-toolbar">
        <span>标准表达、原句和框架默认隐藏。</span>
        <button class="button button-ghost button-small" data-action="generate-corpus-prompt" data-id="${item.id}">
          ${icon("sparkle", 15)}${chinesePrompt ? "换一个中文句子" : "生成随机中文句子"}
        </button>
        ${item.reusedFrameworkRevealed
          ? `<div class="framework-display"><span>已查看框架</span><code>${escapeHtml(item.abstractFramework)}</code></div>`
          : `<button class="button button-ghost button-small" data-action="reveal-corpus-framework" data-id="${item.id}">${icon("book", 15)}需要框架</button>`}
      </div>
      ${item.reusedFrameworkRevealed ? `<p class="practice-warning">你已经查看了框架。本次即使正确，也只会作为受提示练习，不会升级。</p>` : ""}
      <label class="field">
        <span>你的新语境表达</span>
        <textarea data-corpus-answer="reused" rows="5" placeholder="${chinesePrompt ? "把上面的中文句子翻译成英文。" : "生成中文语境后开始翻译。"}" ${chinesePrompt ? "" : "disabled"}>${escapeHtml(item.reusedAttempt || "")}</textarea>
      </label>
      <div class="corpus-step-actions">
        <span>${item.reusedFrameworkRevealed ? "受提示练习：不升级" : "未查看框架：正确后可升级到 Reused"}</span>
        <button class="button button-primary" data-action="check-corpus-reused" data-id="${item.id}" ${state.ui.corpusBusy || !chinesePrompt ? "disabled" : ""}>${icon("check")}检查翻译是否正确</button>
      </div>
      ${feedback ? renderCorpusCheckFeedback(feedback) : ""}
    </section>
  `;
}

function renderCorpusUsageTracker(item) {
  const records = item.usageRecords || [];
  const usageProgress = corpusUsageProgress(records);
  return `
    <section class="corpus-step panel">
      <div class="step-head"><span class="eyebrow">Real Output</span><h2>记录真实使用</h2></div>
      <p class="step-instruction">至少记录 3 次真实使用，覆盖 2 个语境，并至少有 1 次没有查笔记。</p>
      <div class="usage-progress-row">
        <span>有效使用 ${usageProgress.qualifyingCount}/3</span>
        <span>不同语境 ${usageProgress.contextCount}/2</span>
        <span>无笔记 ${usageProgress.noNotesCount}/1</span>
      </div>
      <div class="form-grid">
        <label class="field">
          <span>真实使用场景</span>
          <select id="corpus-usage-context">
            <option value="email">邮件</option>
            <option value="chat">聊天</option>
            <option value="speaking">口头表达</option>
            <option value="writing">写作</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label class="field corpus-no-notes">
          <span>是否查了笔记</span>
          <select id="corpus-usage-notes"><option value="false">没有查笔记</option><option value="true">查了笔记</option></select>
        </label>
        <label class="field wide">
          <span>真实输出内容</span>
          <textarea id="corpus-usage-text" rows="5" placeholder="粘贴邮件、聊天、写作内容，或手动输入口头表达。"></textarea>
        </label>
      </div>
      <div class="corpus-step-actions">
        <span>AI 只检查是否自然使用，不要求 IELTS 正式风格。</span>
        <button class="button button-primary" data-action="check-corpus-usage" data-id="${item.id}" ${state.ui.corpusBusy ? "disabled" : ""}>${icon("check")}检查并记录</button>
      </div>
      ${item.stage === "spontaneous" ? `
        <div class="mastery-ready">
          <div><strong>已经达到 Spontaneous</strong><span>这个表达已经在真实输出中自然使用。</span></div>
          <div class="mastery-actions">
            <button class="button button-ghost" data-action="add-long-term-review" data-id="${item.id}">${icon("clock")}加入长期复习</button>
            <button class="button button-primary" data-action="rename-corpus" data-id="${item.id}">${icon("edit")}${item.customName ? "修改名字" : "给这个表达命名"}</button>
          </div>
        </div>
      ` : usageProgress.canUpgrade ? `
        <div class="mastery-ready">
          <div><strong>真实使用条件已满足</strong><span>可以升级到 Spontaneous。</span></div>
          <button class="button button-primary" data-action="upgrade-corpus-stage" data-id="${item.id}" data-stage="spontaneous">升级到 Spontaneous</button>
        </div>
      ` : ""}
    </section>
  `;
}

function renderCorpusCheckFeedback(feedback = {}) {
  return `
    <div class="revision-feedback ${feedback.passed ? "is-correct" : "needs-review"}">
      <div class="revision-result-head"><strong>${feedback.passed ? "通过" : "还需要修改"}</strong><span>${feedback.canUpgrade ? "可以升级" : "保持当前阶段"}</span></div>
      <p>${escapeHtml(feedback.feedback || "")}</p>
      ${feedback.grammarNaturalness ? `<div class="revision-checks"><div class="status-${feedback.grammarNaturalness.status}"><span>自然度 ${Number(feedback.grammarNaturalness.score || 0)}/10 · ${escapeHtml(feedback.grammarNaturalness.level || "")}</span><p>${escapeHtml(feedback.grammarNaturalness.comment || "")}</p></div></div>` : ""}
      ${renderCorrectionPairs(feedback.corrections, feedback.naturalVersion)}
      ${feedback.suggestedRevision ? `<div class="next-minimal"><span>建议修改</span><p>${escapeHtml(feedback.suggestedRevision)}</p></div>` : ""}
    </div>
  `;
}

function renderCorrectionPairs(corrections = [], naturalVersion = "") {
  const items = Array.isArray(corrections) ? corrections : [];
  if (!items.length && !naturalVersion) return "";
  return `
    <div class="needs-correction">
      <h3>需要修正</h3>
      ${items.map((item) => `
        <div class="correction-pair">
          <code>${escapeHtml(item.original)}</code>
          <span>→</span>
          <code>${escapeHtml(item.corrected)}</code>
          ${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ""}
        </div>
      `).join("")}
      ${naturalVersion ? `
        <div class="natural-version-block">
          <span>自然版本</span>
          <p>${escapeHtml(naturalVersion)}</p>
        </div>
      ` : ""}
    </div>
  `;
}

function renderCorpusRecordTimeline(item) {
  const attempts = state.data.corpusAttempts.filter((attempt) => attempt.corpusItemId === item.id);
  const usage = (item.usageRecords || []).slice().reverse();
  if (!attempts.length && !usage.length) return "";
  return `
    <section class="corpus-history panel">
      <div class="step-head"><span class="eyebrow">History</span><h2>训练记录</h2></div>
      <div class="corpus-timeline">
        ${attempts.slice().reverse().map((attempt) => `
          <article><span>${escapeHtml(attempt.phase)}</span><p>${escapeHtml(attempt.answer)}</p><small>${formatDate(attempt.createdAt)}</small></article>
        `).join("")}
        ${usage.map((record) => `
          <article class="usage-record"><span>真实使用 · ${escapeHtml(record.context)}</span><p>${escapeHtml(record.realText)}</p><small>${formatDate(record.createdAt)}</small></article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderEvaluatingState() {
  return `
    <div class="evaluation-stage">
      <div class="evaluation-orbit" aria-hidden="true">
        <span></span>
        <span></span>
        ${icon("sparkle", 30)}
      </div>
      <span class="eyebrow">正在评估</span>
      <h2>先检查原文，再给分和修改方向</h2>
      <p>DeepSeek 正在读取题目、今日素材和你的回答。草稿已经保存。</p>
      <div class="evaluation-lines" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
}

function renderHistory() {
  const historyTabs = `
    <div class="history-tabs segmented" role="tablist" aria-label="历史类型">
      <button class="${state.history.tab === "writing" ? "is-active" : ""}" data-action="set-history-tab" data-value="writing">写作练习</button>
      <button class="${state.history.tab === "corpus" ? "is-active" : ""}" data-action="set-history-tab" data-value="corpus">语料库记录</button>
    </div>
  `;
  if (state.history.tab === "corpus") {
    const query = state.history.query.trim().toLowerCase();
    const items = state.data.corpusItems.filter((item) => {
      const haystack = [item.customName, item.chineseIntent, item.targetExpression, item.standardExpression, ...(item.topicTags || [])]
        .join(" ")
        .toLowerCase();
      return !query || haystack.includes(query);
    });
    return `
      <section class="page">
        ${pageHeader("语料库历史", "每个表达的训练轨迹", `${items.length} 条语料记录。`)}
        ${historyTabs}
        <div class="filter-bar">
          <label class="search-field">
            ${icon("search")}
            <input type="search" data-input="history-search" value="${escapeHtml(state.history.query)}" placeholder="搜索中文、目标表达或标准表达" />
          </label>
        </div>
        <div id="corpus-history-list">${renderCorpusHistoryList(items)}</div>
      </section>
    `;
  }

  const attempts = filterAttempts();
  return `
    <section class="page">
      ${pageHeader(
        "练习历史",
        "每一次写作都保留当时的学习语境",
        `${state.data.attempts.length} 次练习记录。题目和素材使用当时的快照。`,
        `<button class="button button-ghost" data-action="export-history">${icon("download")}导出 Markdown</button>`
      )}
      ${historyTabs}
      <div class="filter-bar">
        <label class="search-field">
          ${icon("search")}
          <input type="search" data-input="history-search" value="${escapeHtml(state.history.query)}" placeholder="搜索题目、素材、原文或反馈" />
        </label>
        <div class="segmented" role="group" aria-label="筛选历史">
          ${[
            ["all", "全部"],
            ["simple", "简易"],
            ["formal", "正式"],
          ].map(([value, label]) => `
            <button class="${state.history.filter === value ? "is-active" : ""}" data-action="filter-history" data-value="${value}">${label}</button>
          `).join("")}
        </div>
      </div>
      <div id="history-list">
        ${renderHistoryList(attempts)}
      </div>
    </section>
  `;
}

function renderCorpusHistoryList(items) {
  if (!items.length) {
    return `
      <div class="empty-state panel">
        <span class="empty-icon">${icon("sparkle", 30)}</span>
        <strong>还没有语料库记录</strong>
        <p>完成一次语料表达训练后，这里会显示阶段和历史。</p>
      </div>
    `;
  }
  return `
    <div class="history-list">
      ${items.map((item) => `
        <a class="history-card corpus-history-card" href="#/corpus/${item.id}">
          <div class="history-date"><span>${formatDate(item.updatedAt)}</span><span class="corpus-stage-badge stage-${item.stage}">${corpusStageMeta(item.stage).label}</span></div>
          <div class="history-main">
            <h2>${escapeHtml(corpusDisplayName(item))}</h2>
            <p>${escapeHtml(truncate(item.chineseIntent, 145))}</p>
            <div class="history-meta"><span>真实使用 ${(item.usageRecords || []).filter((record) => record.qualifiesAsRealUse).length}/3</span><span>下次复习 ${formatShortDate(item.nextReviewAt)}</span></div>
          </div>
          <div class="history-score">${icon("chevron", 18)}</div>
        </a>
      `).join("")}
    </div>
  `;
}

function filterAttempts() {
  const query = state.history.query.trim().toLowerCase();
  return state.data.attempts.filter((attempt) => {
    const modeMatch = state.history.filter === "all" || attempt.mode === state.history.filter;
    const haystack = [
      attempt.promptSnapshot?.title,
      attempt.promptSnapshot?.promptText,
      attempt.responseText,
      JSON.stringify(attempt.materialsSnapshot || []),
      JSON.stringify(attempt.evaluation || {}),
    ].join(" ").toLowerCase();
    return modeMatch && (!query || haystack.includes(query));
  });
}

function renderHistoryList(attempts) {
  if (!attempts.length) {
    return `
      <div class="empty-state panel">
        <span class="empty-icon">${icon("history", 30)}</span>
        <strong>没有匹配的练习记录</strong>
        <p>完成练习后，题目、素材、评分和反馈都会出现在这里。</p>
      </div>
    `;
  }
  return `
    <div class="history-list">
      ${attempts.map((attempt) => {
        const usage = summarizeUsage(attempt);
        return `
          <a class="history-card" href="#/report/${attempt.id}">
            <div class="history-date">
              <span>${formatDate(attempt.createdAt)}</span>
              ${taskBadge(attempt.promptSnapshot?.taskType || "task2")}
            </div>
            <div class="history-main">
              <h2>${escapeHtml(attempt.promptSnapshot?.title || "未命名题目")}</h2>
              <p>${escapeHtml(truncate(attempt.responseText, 145))}</p>
              <div class="history-meta">
                <span>${MODE_LABELS[attempt.mode] || attempt.mode}</span>
                <span>${attempt.wordCount || wordCount(attempt.responseText)} 词</span>
                <span>目标词句 ${usage.used}/${usage.total || 0}</span>
              </div>
            </div>
            <div class="history-score">
              <strong>${scoreLabel(attempt)}</strong>
              ${icon("chevron", 18)}
            </div>
          </a>
        `;
      }).join("")}
    </div>
  `;
}

function renderReport() {
  const attempt = attemptById(state.route.id);
  if (!attempt) {
    return `
      <section class="page">
        ${pageHeader("报告", "找不到这次练习")}
        <div class="empty-state panel">
          <strong>记录可能已被清空或地址不正确。</strong>
          <a class="button button-primary" href="#/history">${icon("history")}返回历史</a>
        </div>
      </section>
    `;
  }

  return attempt.evaluation?.type === "formal"
    ? renderFormalReport(attempt)
    : renderSimpleReport(attempt);
}

function renderSimpleReport(attempt) {
  const evaluation = attempt.evaluation || {};
  const rubric = evaluation.rubric || {};
  const isV2 = evaluation.rubricVersion === "daily-v0.2" || Boolean(evaluation.taskCoverage);
  const rubricEntries = isV2
    ? [
      ["taskCoverage", "Task Coverage"],
      ["ideaClarity", "Idea Clarity"],
      ["organization", "Organization"],
      ["wordChoice", "Word Choice"],
      ["sentenceControl", "Sentence Control"],
    ]
    : [
      ["taskRelevance", "Task Relevance"],
      ["ideaClarity", "Idea Clarity"],
      ["targetVocabulary", "Target Vocabulary"],
      ["targetPattern", "Target Pattern"],
      ["sentenceControl", "Sentence Control"],
    ];
  const diagnostic = evaluation.oneSentenceDiagnosis || evaluation.priorityFix || "先看最需要修正的一处，再决定下一步。";
  const minimalRewrite = evaluation.minimalRewrite || evaluation.rewritePrompt || "";
  const ratio = scoreRatio(attempt);
  return `
    <section class="page report-page">
      <header class="report-hero simple-hero">
        <div class="report-hero-copy">
          <span class="eyebrow">Daily IELTS Mini Practice</span>
          <h1>先看任务是否完成，再改最关键的语言</h1>
          <p class="diagnosis-text">${escapeHtml(diagnostic)}</p>
          <p>${escapeHtml(attempt.promptSnapshot?.title || "")} · ${attempt.wordCount} 词 · ${Math.round((attempt.durationSeconds || 0) / 60)} 分钟 · ${isV2 ? "daily-v0.2" : "历史 daily-v0.1"}</p>
          <div class="hero-actions">
            <button class="button button-light" data-action="repeat-attempt" data-id="${attempt.id}">${icon("pen")}再写一次</button>
            <button class="button button-glass" data-action="copy-report" data-id="${attempt.id}">${icon("download")}复制报告</button>
            <button class="button button-glass" data-action="export-report" data-id="${attempt.id}">${icon("download")}导出报告</button>
          </div>
        </div>
        <div class="score-dial" style="--score:${ratio};">
          <strong>${Number(evaluation.dailyPracticeScore || 0).toFixed(0)}</strong>
          <span>/ 10</span>
        </div>
      </header>

      ${isV2 ? renderTaskCoverage(evaluation.taskCoverage, evaluation.coreIdeas) : ""}

      <div class="report-grid">
        <section class="report-section">
          <div class="section-title">
            <div><span class="eyebrow">Daily Practice Rubric</span><h2>${isV2 ? "能力检查" : "历史评分标准"}</h2></div>
            ${isV2 ? `<strong>每日短练习，不换算 IELTS Band</strong>` : ""}
          </div>
          <div class="rubric-list">
            ${rubricEntries.map(([key, label]) => {
              const value = Number(rubric[key] || 0);
              return `
                <div class="rubric-row">
                  <div><strong>${label}</strong><span>${value === 2 ? "完成且自然" : value === 1 ? "部分完成" : "需要补足"}</span></div>
                  <div class="rubric-score"><span style="--value:${value / 2}"></span><strong>${value}/2</strong></div>
                </div>
              `;
            }).join("")}
          </div>
        </section>

        <section class="report-section">
          <div class="section-title">
            <div><span class="eyebrow">Usage Tracker</span><h2>目标语言使用</h2></div>
            <strong>${(evaluation.targetUsage?.usageRate || 0) * 100 | 0}% 使用率</strong>
          </div>
          ${renderUsageItems(evaluation.targetUsage)}
        </section>
      </div>

      ${isV2 ? renderDailyTeachingSections(attempt, evaluation, minimalRewrite) : `
        ${minimalRewrite ? `
          <section class="report-section">
            <div class="section-title"><div><span class="eyebrow">Minimal Rewrite</span><h2>保留原意的最小改写</h2></div></div>
            <div class="rewrite-copy">${escapeHtml(minimalRewrite).replace(/\n/g, "<br />")}</div>
          </section>
        ` : ""}
      `}

      ${renderReportLearningCta(attempt)}
      ${renderAttemptSource(attempt)}
    </section>
  `;
}

function renderTaskCoverage(coverage = {}, coreIdeas = []) {
  const labels = {
    bothViews: "讨论双方观点",
    position: "表达个人立场",
    concreteReasons: "给出具体理由",
    explanationOrExample: "解释原因或结果",
  };
  const statusLabels = {
    complete: "完成",
    partial: "部分完成",
    missing: "未完成",
  };
  return `
    <section class="task-coverage-board">
      <div class="coverage-head">
        <div><span class="eyebrow">Task Coverage</span><h2>任务完成检查</h2></div>
        ${coreIdeas?.length ? `<div class="core-ideas"><span>核心观点</span>${coreIdeas.map((idea) => `<strong>${escapeHtml(idea)}</strong>`).join("")}</div>` : ""}
      </div>
      <div class="coverage-grid">
        ${Object.entries(labels).map(([key, label]) => {
          const item = coverage?.[key] || { status: "missing", comment: "" };
          return `
            <div class="coverage-item status-${escapeHtml(item.status)}">
              <div><span>${icon(item.status === "complete" ? "check" : "clock", 15)}</span><strong>${label}</strong></div>
              <small>${statusLabels[item.status] || statusLabels.missing}</small>
              <p>${escapeHtml(item.comment || "模型未提供额外说明。")}</p>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderDailyTeachingSections(attempt, evaluation, minimalRewrite) {
  const fixes = evaluation.teachingFixes?.length ? evaluation.teachingFixes : evaluation.topErrors || [];
  const session = revisionSessionByAttemptId(attempt.id);
  return `
    ${fixes.length ? `
      <section class="report-section">
        <div class="section-title">
          <div><span class="eyebrow">Teacher Corrections</span><h2>用你的原句学会自然表达</h2></div>
          <span class="quiet-label">基础自然版 + IELTS 进阶版</span>
        </div>
        <div class="teaching-fix-list">
          ${fixes.map((item, index) => {
            const fixId = `fix_${index + 1}`;
            const answer = session?.sentenceAnswers?.[fixId] || "";
            return `
            <article class="teaching-fix-card">
              <span class="error-index">${String(index + 1).padStart(2, "0")}</span>
              <div class="teaching-fix-body">
                <span class="fix-stage-label">你的原句</span>
                <blockquote>${escapeHtml(item.original)}</blockquote>
                <p>${escapeHtml(item.problem || "")}</p>
                <div class="rewrite-levels">
                  <div>
                    <span>基础自然版</span>
                    <p>${escapeHtml(item.basicRewrite || item.minimalFix || "")}</p>
                    <code>${escapeHtml(item.basicPattern || item.requiredPattern || "")}</code>
                  </div>
                  <div>
                    <span>IELTS 进阶版</span>
                    <p>${escapeHtml(item.advancedRewrite || item.basicRewrite || item.minimalFix || "")}</p>
                    <code>${escapeHtml(item.advancedPattern || item.requiredPattern || "")}</code>
                  </div>
                </div>
                ${item.usageCondition ? `<div class="usage-condition"><span>使用条件</span><p>${escapeHtml(item.usageCondition)}</p></div>` : ""}
                <label class="field">
                  <span>看着自己的原稿，用这个结构重新修正一次</span>
                  <textarea data-input="sentence-revision" data-id="${fixId}" rows="3" placeholder="保留你的原意，只把句子改正确、改自然。">${escapeHtml(answer)}</textarea>
                </label>
              </div>
            </article>
          `;
          }).join("")}
        </div>
      </section>
    ` : ""}

    ${(evaluation.sentenceIssues || []).length ? `
      <section class="report-section">
        <div class="section-title"><div><span class="eyebrow">Sentence Notes</span><h2>原文逐句标注</h2></div></div>
        <div class="sentence-issue-list">
          ${evaluation.sentenceIssues.map((item) => `
            <article class="sentence-issue">
              <div class="sentence-number">Sentence ${item.sentenceNumber}</div>
              <blockquote>${escapeHtml(item.original)}</blockquote>
              <span class="issue-type">${issueTypeLabel(item.issueType)}</span>
              <p>${escapeHtml(item.explanation)}</p>
              ${item.minimalFix ? `<div class="minimal-fix"><span>最小修改</span><p>${escapeHtml(item.minimalFix)}</p></div>` : ""}
            </article>
          `).join("")}
        </div>
      </section>
    ` : ""}

    ${minimalRewrite ? `
      <section class="report-section">
        <div class="section-title">
          <div><span class="eyebrow">Revision Reference</span><h2>修改与润色后的版本</h2></div>
          <span class="quiet-label">保留原意的最小改写</span>
        </div>
        <div class="rewrite-copy">${escapeHtml(minimalRewrite).replace(/\n/g, "<br />")}</div>
      </section>
    ` : ""}

    ${renderRevisionCoach(attempt, minimalRewrite, fixes)}

    ${renderRetryTask(evaluation.retryTask)}
  `;
}

function revisionSessionByAttemptId(attemptId) {
  return state.data.revisionSessions.find((session) => session.attemptId === attemptId) || null;
}

function ensureRevisionSession(attempt) {
  let session = revisionSessionByAttemptId(attempt.id);
  if (session) return session;
  session = {
    id: uid("revision"),
    attemptId: attempt.id,
    currentText: attempt.responseText,
    sentenceAnswers: {},
    rounds: [],
    status: "editing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.data.revisionSessions.unshift(session);
  saveData();
  return session;
}

function renderRevisionCoach(attempt, minimalRewrite, fixes) {
  const session = revisionSessionByAttemptId(attempt.id);
  const latest = session?.rounds?.[session.rounds.length - 1] || null;
  const currentText = session?.currentText || attempt.responseText;
  return `
    <section class="revision-coach">
      <div class="section-title">
        <div><span class="eyebrow">Revise Until Correct</span><h2>现在修改自己的原稿</h2></div>
        <span class="quiet-label">基础：写对、自然、看得懂</span>
      </div>
      <p class="revision-guidance">保留你的原意，参考上面的原句修正。提交后老师会继续指出未解决的问题，直到基础表达正确。</p>
      <div class="revision-original">
        <span>你的原稿</span>
        <p>${escapeHtml(attempt.responseText).replace(/\n/g, "<br />")}</p>
      </div>
      <label class="field">
        <span>修改稿</span>
        <textarea data-input="revision-draft" rows="12" placeholder="在原文基础上修改，不需要扩写成完整 Task 2。">${escapeHtml(currentText)}</textarea>
      </label>
      <div class="revision-actions">
        <span>${wordCount(currentText)} 词 · 第 ${(session?.rounds?.length || 0) + 1} 次提交</span>
        <button class="button button-primary button-large" data-action="submit-revision" ${state.ui.revisionLoading ? "disabled" : ""}>
          ${state.ui.revisionLoading ? icon("clock") : icon("check")}
          ${state.ui.revisionLoading ? "老师正在检查" : latest?.feedback?.isCorrect ? "再次提交修改稿" : "提交修改稿，继续批改"}
        </button>
      </div>
      ${latest ? renderRevisionFeedback(latest.feedback) : ""}
      ${minimalRewrite ? `<div class="revision-reference"><span>参考最小改写</span><p>${escapeHtml(minimalRewrite).replace(/\n/g, "<br />")}</p></div>` : ""}
    </section>
  `;
}

function renderRevisionFeedback(feedback = {}) {
  const statusLabels = {
    complete: "完成",
    partial: "还差一点",
    missing: "未完成",
  };
  return `
    <div class="revision-feedback ${feedback.isCorrect ? "is-correct" : "needs-review"}">
      <div class="revision-result-head">
        <strong>${feedback.isCorrect ? "基础表达已经写对" : "继续修改这一稿"}</strong>
        <span>${feedback.isCorrect ? "可以继续做进阶拆解" : "老师反馈"}</span>
      </div>
      <p>${escapeHtml(feedback.coachSummary || "请继续根据下面的反馈修改。")}</p>
      ${(feedback.checks || []).length ? `
        <div class="revision-checks">
          ${feedback.checks.map((check) => `
            <div class="status-${escapeHtml(check.status)}">
              <span>${statusLabels[check.status] || statusLabels.missing}</span>
              <strong>${escapeHtml(check.label)}</strong>
              <p>${escapeHtml(check.comment)}</p>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${(feedback.remainingIssues || []).length ? `
        <div class="remaining-fixes">
          ${feedback.remainingIssues.map((item) => `
            <article>
              <blockquote>${escapeHtml(item.original)}</blockquote>
              <p>${escapeHtml(item.problem)}</p>
              ${item.basicRewrite ? `<div><span>基础自然版</span><p>${escapeHtml(item.basicRewrite)}</p></div>` : ""}
              ${item.advancedRewrite ? `<div><span>IELTS 进阶版</span><p>${escapeHtml(item.advancedRewrite)}</p></div>` : ""}
            </article>
          `).join("")}
        </div>
      ` : ""}
      ${feedback.nextMinimalRewrite && !feedback.isCorrect ? `
        <div class="next-minimal">
          <span>下一步最小修改</span>
          <p>${escapeHtml(feedback.nextMinimalRewrite)}</p>
        </div>
      ` : ""}
      ${feedback.optionalAdvancedUpgrade ? `
        <div class="optional-advanced">
          <span>可选进阶升级</span>
          <p>${escapeHtml(feedback.optionalAdvancedUpgrade)}</p>
        </div>
      ` : ""}
    </div>
  `;
}

async function submitRevision() {
  const attempt = attemptById(state.route.id);
  if (!attempt) return;
  const textarea = document.querySelector('[data-input="revision-draft"]');
  const currentText = textarea?.value.trim() || "";
  if (!currentText) return toast("修改稿不能为空。", "error");

  const session = ensureRevisionSession(attempt);
  session.currentText = currentText;
  session.updatedAt = new Date().toISOString();
  state.ui.revisionLoading = true;
  saveData();
  render();

  try {
    const payload = await runRevisionCheck({
      mode: attempt.mode,
      taskType: attempt.taskType,
      prompt: attempt.promptSnapshot?.promptText || "",
      originalText: attempt.responseText,
      currentText,
      targetFixes: attempt.evaluation?.teachingFixes || attempt.evaluation?.topErrors || [],
      minimalRewrite: attempt.evaluation?.minimalRewrite || attempt.evaluation?.rewritePrompt || "",
    });
    session.rounds.push({
      round: session.rounds.length + 1,
      text: currentText,
      feedback: payload,
      createdAt: new Date().toISOString(),
    });
    session.status = payload.isCorrect ? "correct" : "editing";
    session.updatedAt = new Date().toISOString();
    state.ui.revisionLoading = false;
    saveData();
    render();
    toast(payload.isCorrect ? "基础表达已通过，可以进入进阶学习。" : "反馈已更新，继续修改这一稿。", payload.isCorrect ? "success" : "info");
  } catch (error) {
    state.ui.revisionLoading = false;
    render();
    toast(error.message || "修改稿检查失败，草稿仍已保存。", "error");
  }
}

async function createCorpusAndEvaluate() {
  const draft = state.ui.corpusDraft || {};
  const chineseIntent = document.querySelector("#corpus-chinese")?.value.trim() || draft.chineseIntent || "";
  const targetExpression = document.querySelector("#corpus-target")?.value.trim() || draft.targetExpression || "";
  const tags = String(document.querySelector("#corpus-tags")?.value || draft.topicTags || "")
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const firstAttempt = document.querySelector("#corpus-first-attempt")?.value.trim() || draft.firstAttempt || "";
  if (!chineseIntent || !firstAttempt) {
    return toast("请填写中文含义和第一次英文表达。", "error");
  }

  const item = {
    id: uid("corpus"),
    customName: "",
    chineseIntent,
    targetExpression,
    targetType: targetExpression ? "expression" : "meaning",
    topicTags: tags,
    sourceMaterialId: "",
    sourceDate: localDateKey(),
    firstAttempt,
    firstAttemptStartedAt: draft.firstAttemptStartedAt || null,
    firstAttemptSubmittedAt: new Date().toISOString(),
    firstAttemptDurationSeconds: draft.firstAttemptStartedAt
      ? Math.max(0, Math.round((Date.now() - new Date(draft.firstAttemptStartedAt).getTime()) / 1000))
      : 0,
    firstAttemptTimedOut: Boolean(draft.firstAttemptTimedOut),
    learningPlan: createCorpusLearningPlan(),
    testProfile: {
      level: document.querySelector("#corpus-level")?.value || draft.level || "intermediate",
      preferences: [...document.querySelectorAll('input[name="corpus-preference"]:checked')]
        .map((input) => input.value),
    },
    firstEvaluation: null,
    standardExpression: "",
    abstractFramework: "",
    frameworkEditedByUser: false,
    frameworkConfirmedAt: null,
    controlledAttempt: "",
    controlledEvaluation: null,
    reusedChinesePrompt: "",
    reusedFrameworkRevealed: false,
    reusedAttempt: "",
    reusedEvaluation: null,
    stage: "new",
    stageHistory: [{ stage: "new", createdAt: new Date().toISOString() }],
    usageRecords: [],
    lastPracticedAt: new Date().toISOString(),
    lastUsedAt: null,
    nextReviewAt: nextReviewIso("new"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  item.learningPlan.firstAttempt.status = "completed";
  item.learningPlan.firstAttempt.startedAt = item.firstAttemptStartedAt;
  item.learningPlan.firstAttempt.completedAt = item.firstAttemptSubmittedAt;
  item.learningPlan.firstAttempt.timedOut = item.firstAttemptTimedOut;
  if (!item.testProfile.preferences.length) {
    item.testProfile.preferences = CORPUS_TEST_TYPES.map(([id]) => id);
  }
  state.data.corpusItems.unshift(item);
  clearCorpusDraft();
  state.ui.corpusBusy = true;
  saveData();
  navigate(`corpus/${item.id}`);
  render();
  await evaluateCorpusFirstAttempt(item);
}

async function evaluateCorpusFirstAttempt(item) {
  state.ui.corpusBusy = true;
  render();
  try {
    const payload = await runCorpusEvaluate({
      chineseIntent: item.chineseIntent,
      targetExpression: item.targetExpression,
      topicTags: item.topicTags,
      firstAttempt: item.firstAttempt,
    });
    item.firstEvaluation = payload;
    item.standardExpression = payload.standardExpression;
    item.baseChunks = payload.baseChunks || [];
    item.abstractFramework = payload.abstractFramework;
    item.learningPlan.card.status = "active";
    item.learningPlan.card.startedAt = new Date().toISOString();
    item.learningPlan.card.deadlineAt = new Date(Date.now() + item.learningPlan.card.limitSeconds * 1000).toISOString();
    item.updatedAt = new Date().toISOString();
    state.data.corpusAttempts.unshift({
      id: uid("corpus_attempt"),
      corpusItemId: item.id,
      phase: "first",
      answer: item.firstAttempt,
      evaluation: payload,
      createdAt: new Date().toISOString(),
    });
    state.ui.corpusBusy = false;
    saveData();
    render();
  } catch (error) {
    state.ui.corpusBusy = false;
    saveData();
    render();
    toast(error.message || "第一次评价失败，可以稍后重试。", "error");
  }
}

function beginCorpusFirstAttemptTimer() {
  const draft = syncCorpusDraftFromForm();
  if (!draft || draft.firstAttemptStartedAt || draft.firstAttemptTimedOut) return;
  draft.firstAttemptStartedAt = new Date().toISOString();
  draft.firstAttemptDeadlineAt = new Date(Date.now() + 7 * 60 * 1000).toISOString();
  saveCorpusDraft();
  updateCorpusCountdowns();
}

function syncCorpusDraftFromForm() {
  if (!document.querySelector("#corpus-chinese")) return state.ui.corpusDraft;
  const draft = state.ui.corpusDraft || {};
  draft.chineseIntent = document.querySelector("#corpus-chinese")?.value || "";
  draft.targetExpression = document.querySelector("#corpus-target")?.value || "";
  draft.topicTags = document.querySelector("#corpus-tags")?.value || "";
  draft.level = document.querySelector("#corpus-level")?.value || draft.level || "intermediate";
  draft.preferences = [...document.querySelectorAll('input[name="corpus-preference"]:checked')].map((input) => input.value);
  draft.firstAttempt = document.querySelector("#corpus-first-attempt")?.value || draft.firstAttempt || "";
  state.ui.corpusDraft = draft;
  saveCorpusDraft();
  return draft;
}

function startCorpusFirstCheckIn() {
  const draft = syncCorpusDraftFromForm();
  if (!draft?.chineseIntent?.trim()) {
    toast("请先填写中文想表达的内容。", "error");
    return;
  }
  beginCorpusFirstAttemptTimer();
  render();
}

async function updateCorpusCountdowns() {
  const now = Date.now();
  let shouldRender = false;
  document.querySelectorAll("[data-corpus-countdown]").forEach((element) => {
    const deadline = element.dataset.deadline;
    if (!deadline) {
      element.textContent = element.dataset.kind === "first-draft" ? "07:00" : "--:--";
      return;
    }
    const remaining = Math.max(0, new Date(deadline).getTime() - now);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    element.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  });

  const draft = state.ui.corpusDraft;
  if (
    draft?.firstAttemptDeadlineAt
    && !draft.firstAttemptTimedOut
    && new Date(draft.firstAttemptDeadlineAt).getTime() <= now
  ) {
    draft.firstAttemptTimedOut = true;
    draft.autoSubmittedAt = new Date().toISOString();
    draft.firstAttempt = document.querySelector("#corpus-first-attempt")?.value || draft.firstAttempt || "";
    saveCorpusDraft();
    await createCorpusAndEvaluate();
    return;
  }

  state.data.corpusItems.forEach((item) => {
    const plan = ensureCorpusLearningPlan(item);
    plan.sameDayTests.forEach((test) => {
      if (test.status === "locked" && test.availableAt && new Date(test.availableAt) <= new Date(now)) {
        test.status = "available";
        item.updatedAt = new Date().toISOString();
        shouldRender = state.route.id === item.id || shouldRender;
      }
    });
    [...plan.sameDayTests, ...plan.scheduledReviews].forEach((session) => {
      if (session.status === "active" && session.deadlineAt && new Date(session.deadlineAt) <= new Date(now) && !session.timedOut) {
        session.timedOut = true;
        shouldRender = state.route.id === item.id || shouldRender;
      }
    });
  });
  if (shouldRender) {
    saveData();
    render();
  }
}

function startCorpusRetrieval(itemId, sessionId) {
  const item = corpusItemById(itemId);
  if (!item) return;
  const session = corpusRetrievalSession(item, sessionId);
  if (!session) return;
  const now = new Date();
  session.status = "active";
  session.startedAt = now.toISOString();
  session.deadlineAt = new Date(now.getTime() + session.limitSeconds * 1000).toISOString();
  session.question = buildCorpusRetrievalQuestion(item, session);
  session.answer = "";
  session.result = null;
  state.ui.activeRetrieval = { itemId, sessionId };
  saveData();
  render();
}

async function checkCorpusRetrieval(itemId, sessionId) {
  const item = corpusItemById(itemId);
  const session = item ? corpusRetrievalSession(item, sessionId) : null;
  if (!item || !session) return;
  const answer = document.querySelector("[data-corpus-retrieval-answer]")?.value.trim() || "";
  if (!answer) return toast("请先完成本次主动回忆。", "error");
  session.answer = answer;

  let result;
  if (session.question?.type === "framework_fill" && session.question.localAnswer) {
    const passed = patternMatches(answer, session.question.localAnswer);
    result = {
      passed,
      feedback: passed ? "框架补全正确。" : "框架结构还不完全正确，请对照抽象框架再检查一次。",
      suggestedRevision: passed ? "" : session.question.localAnswer,
      naturalness: { score: passed ? 10 : 5, level: passed ? "Native-like" : "Understandable but uneven", comment: "" },
    };
  } else {
    state.ui.corpusBusy = true;
    saveData();
    render();
    try {
      result = await runCorpusRetrieval({
        item,
        questionType: session.question?.type || "translation",
        question: session.question?.prompt || "",
        answer,
      });
    } catch (error) {
      state.ui.corpusBusy = false;
      saveData();
      render();
      toast(error.message || "复习检查失败。", "error");
      return;
    }
  }

  state.ui.corpusBusy = false;
  session.result = result;
  session.status = "completed";
  session.completedAt = new Date().toISOString();
  session.durationSeconds = session.startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000))
    : 0;
  if (session.intervalDays && !session.nextScheduled) {
    session.nextScheduled = true;
    scheduleNextCorpusReview(item, new Date(session.completedAt));
  }
  item.lastPracticedAt = session.completedAt;
  item.updatedAt = new Date().toISOString();
  state.ui.activeRetrieval = null;
  saveData();
  render();
  toast(result.passed ? "打卡完成。" : "已记录本次复习，继续巩固即可。", result.passed ? "success" : "info");
}

function confirmCorpusFramework(id) {
  const item = corpusItemById(id);
  if (!item) return;
  const framework = document.querySelector("#corpus-framework")?.value.trim() || "";
  if (!framework) return toast("抽象框架不能为空。", "error");
  const baseChunks = String(document.querySelector("#corpus-base-chunks")?.value || "")
    .split(/\n|[,，]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  item.frameworkEditedByUser = framework !== item.abstractFramework;
  item.abstractFramework = framework;
  item.baseChunks = baseChunks;
  item.frameworkConfirmedAt = new Date().toISOString();
  const plan = ensureCorpusLearningPlan(item);
  plan.card.status = "completed";
  plan.card.completedAt = item.frameworkConfirmedAt;
  plan.card.timedOut = Boolean(plan.card.deadlineAt && new Date(plan.card.deadlineAt) <= new Date());
  plan.sameDayTests[0].status = "available";
  plan.sameDayTests[0].availableAt = item.frameworkConfirmedAt;
  plan.sameDayTests[1].status = "locked";
  plan.sameDayTests[1].availableAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  if (!plan.scheduledReviews.length) scheduleNextCorpusReview(item, new Date(item.frameworkConfirmedAt));
  item.updatedAt = new Date().toISOString();
  saveData();
  render();
  toast("框架已确认，进入 Controlled 练习。", "success");
}

async function checkCorpusAttempt(phase) {
  const item = corpusItemById(state.route.id);
  if (!item) return;
  const answer = document.querySelector(`[data-corpus-answer="${phase}"]`)?.value.trim() || "";
  if (!answer) return toast("请先写出你的练习答案。", "error");
  item[`${phase}Attempt`] = answer;
  item.lastPracticedAt = new Date().toISOString();
  state.ui.corpusBusy = true;
  saveData();
  render();

  try {
    const payload = await runCorpusCheck({
      phase,
      item,
      answer,
      frameworkRevealed: phase === "reused" ? item.reusedFrameworkRevealed : false,
    });
    item[`${phase}Evaluation`] = payload;
    state.data.corpusAttempts.unshift({
      id: uid("corpus_attempt"),
      corpusItemId: item.id,
      phase,
      answer,
      frameworkRevealed: Boolean(item.reusedFrameworkRevealed),
      evaluation: payload,
      createdAt: new Date().toISOString(),
    });
    if (phase === "controlled" && payload.passed && payload.canUpgrade) {
      item.stage = "controlled";
      item.nextReviewAt = nextReviewIso("controlled");
      item.reusedChinesePrompt = payload.nextChinesePrompt || item.reusedChinesePrompt || "";
      if (!isChineseCorpusPrompt(item.reusedChinesePrompt)) {
        item.reusedChinesePrompt = await requestCorpusChinesePrompt(item);
      }
      item.stageHistory.push({ stage: "controlled", createdAt: new Date().toISOString() });
    }
    if (phase === "reused" && payload.passed && payload.canUpgrade) {
      item.stage = "reused";
      item.nextReviewAt = nextReviewIso("reused");
      item.stageHistory.push({ stage: "reused", createdAt: new Date().toISOString() });
    }
    item.updatedAt = new Date().toISOString();
    state.ui.corpusBusy = false;
    saveData();
    render();
    toast(payload.passed ? (payload.canUpgrade ? "练习通过，阶段已升级。" : "表达正确，但本次使用了提示，保持当前阶段。") : "还有问题，继续修改这一级。", payload.passed ? "success" : "info");
  } catch (error) {
    state.ui.corpusBusy = false;
    saveData();
    render();
    toast(error.message || "检查失败，答案已保留。", "error");
  }
}

async function requestCorpusChinesePrompt(item) {
  const payload = await runCorpusRandomPrompt({
    item,
    previousPrompt: item.reusedChinesePrompt || item.chineseIntent,
  });
  if (!isChineseCorpusPrompt(payload.chinesePrompt)) {
    throw new Error("系统没有生成有效的纯中文语境。");
  }
  return payload.chinesePrompt;
}

async function generateCorpusChinesePrompt(id) {
  const item = corpusItemById(id);
  if (!item) return;
  state.ui.corpusBusy = true;
  saveData();
  render();
  try {
    item.reusedChinesePrompt = await requestCorpusChinesePrompt(item);
    item.reusedFrameworkRevealed = false;
    item.reusedAttempt = "";
    item.reusedEvaluation = null;
    item.updatedAt = new Date().toISOString();
    state.ui.corpusBusy = false;
    saveData();
    render();
    toast("已生成一个新的中文语境。", "success");
  } catch (error) {
    state.ui.corpusBusy = false;
    render();
    toast(error.message || "中文语境生成失败。", "error");
  }
}

function isChineseCorpusPrompt(value = "") {
  const text = String(value || "").trim();
  return Boolean(text) && /[\u3400-\u9fff]/.test(text) && !/[A-Za-z]/.test(text);
}

function revealCorpusFramework(id) {
  const item = corpusItemById(id);
  if (!item) return;
  item.reusedFrameworkRevealed = true;
  item.frameworkRevealCount = (item.frameworkRevealCount || 0) + 1;
  item.updatedAt = new Date().toISOString();
  saveData();
  render();
}

async function checkCorpusUsage(id) {
  const item = corpusItemById(id);
  if (!item) return;
  const realText = document.querySelector("#corpus-usage-text")?.value.trim() || "";
  const context = document.querySelector("#corpus-usage-context")?.value || "other";
  const notesUsed = document.querySelector("#corpus-usage-notes")?.value === "true";
  if (!realText) return toast("请粘贴或输入真实使用内容。", "error");
  item.usageDraft = { realText, context, notesUsed };
  state.ui.corpusBusy = true;
  saveData();
  render();

  try {
    const payload = await runCorpusUsageCheck({ item, realText, context, notesUsed });
    const record = {
      id: uid("corpus_usage"),
      corpusItemId: item.id,
      realText,
      context,
      notesUsed,
      naturalUse: payload.naturalUse,
      qualifiesAsRealUse: payload.qualifiesAsRealUse,
      feedback: payload.feedback,
      suggestedRevision: payload.suggestedRevision,
      createdAt: new Date().toISOString(),
    };
    item.usageRecords.push(record);
    state.data.corpusUsageRecords.unshift(record);
    if (record.qualifiesAsRealUse) item.lastUsedAt = record.createdAt;
    item.usageDraft = null;
    item.updatedAt = new Date().toISOString();
    state.ui.corpusBusy = false;
    saveData();
    render();
    toast(payload.qualifiesAsRealUse ? "已记录一次有效真实使用。" : "已保存记录，但这次还未达到自然使用标准。", payload.qualifiesAsRealUse ? "success" : "info");
  } catch (error) {
    state.ui.corpusBusy = false;
    saveData();
    render();
    toast(error.message || "检查失败，输入仍已保留。", "error");
  }
}

function upgradeCorpusStage(id, stage) {
  const item = corpusItemById(id);
  if (!item) return;
  item.stage = stage;
  item.nextReviewAt = nextReviewIso(stage);
  item.stageHistory.push({ stage, createdAt: new Date().toISOString() });
  item.updatedAt = new Date().toISOString();
  if (stage === "spontaneous") {
    state.ui.renamingCorpusId = item.id;
  }
  saveData();
  render();
  toast(
    stage === "spontaneous"
      ? "已升级到 Spontaneous。现在可以给这个表达起一个自己的名字。"
      : `已升级到 ${corpusStageMeta(stage).label}。`,
    "success",
  );
}

function resetCorpusStage(id) {
  const item = corpusItemById(id);
  if (!item) return;
  const stage = document.querySelector("#corpus-reset-stage")?.value || "new";
  item.stage = stage;
  item.nextReviewAt = nextReviewIso(stage);
  item.stageHistory.push({ stage, manualReset: true, createdAt: new Date().toISOString() });
  item.updatedAt = new Date().toISOString();
  saveData();
  render();
  toast(`已手动调整到 ${corpusStageMeta(stage).label}。`, "success");
}

function addLongTermCorpusReview(id) {
  const item = corpusItemById(id);
  if (!item) return;
  const plan = ensureCorpusLearningPlan(item);
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 30);
  plan.scheduledReviews.push({
    id: uid("review"),
    intervalDays: 30,
    targetSeconds: 300,
    status: "pending",
    dueAt: dueAt.toISOString(),
    startedAt: null,
    deadlineAt: null,
    completedAt: null,
    timedOut: false,
    longTerm: true,
  });
  item.updatedAt = new Date().toISOString();
  saveData();
  render();
  toast("已加入 30 天长期复习。", "success");
}

function issueTypeLabel(type) {
  const labels = {
    spelling: "拼写",
    agreement: "主谓一致",
    word_form: "词性",
    fragment: "句子不完整",
    collocation: "搭配",
    clarity: "意思不清楚",
  };
  return labels[type] || "表达问题";
}

function renderRetryTask(task = {}) {
  if (!task?.prompt && !task?.instructions && !(task?.sentences || []).length) return "";
  return `
    <section class="retry-board">
      <div>
        <span class="eyebrow">Retry Task</span>
        <h2>下一次练习要具体到句子和结构</h2>
        ${task.instructions ? `<p>${escapeHtml(task.instructions)}</p>` : ""}
      </div>
      ${(task.sentences || []).length ? `
        <div class="retry-sentence-list">
          ${task.sentences.map((item, index) => `
            <article>
              <span>${String(index + 1).padStart(2, "0")}</span>
              <blockquote>${escapeHtml(item.original)}</blockquote>
              <code>${escapeHtml(item.requiredPattern)}</code>
            </article>
          `).join("")}
        </div>
      ` : ""}
      <div class="retry-final">
        <strong>${escapeHtml(task.prompt || "完成一次指定结构练习。")}</strong>
        <span>${escapeHtml(task.wordRange || "35-50")} 词</span>
        <div class="tag-row">${(task.requiredPatterns || []).map((pattern) => `<span>${escapeHtml(pattern)}</span>`).join("")}</div>
      </div>
    </section>
  `;
}

function renderReportLearningCta(attempt) {
  const extension = learningExtensionByAttemptId(attempt.id);
  return `
    <section class="learning-cta">
      <div>
        <span class="eyebrow">Optional Learning Extension</span>
        <h2>${extension ? "继续拆解完整 IELTS 改写" : "想进一步学习完整改写吗？"}</h2>
        <p>完整范文不是背诵答案。系统会随机抽取引言、双方观点、理由发展或个人立场中的一个，带你深入拆解。</p>
      </div>
      <button class="button button-light" data-action="start-learning" data-id="${attempt.id}">
        ${icon("sparkle")}${extension ? "继续进阶学习" : "生成进阶学习"}
      </button>
    </section>
  `;
}

function renderLearningExtension() {
  const attempt = attemptById(state.route.id);
  if (!attempt) {
    return `
      <section class="page">
        ${pageHeader("进阶学习", "找不到对应练习")}
        <div class="empty-state panel">
          <strong>这条记录可能已被清空。</strong>
          <a class="button button-primary" href="#/history">${icon("history")}返回历史</a>
        </div>
      </section>
    `;
  }

  const extension = learningExtensionByAttemptId(attempt.id);
  if (state.ui.learningLoading) {
    return `
      <section class="page">
        <div class="learning-loading">
          <div class="evaluation-orbit" aria-hidden="true"><span></span><span></span>${icon("sparkle", 30)}</div>
          <span class="eyebrow">正在生成进阶学习</span>
          <h1>把完整范文拆成可复用的写法</h1>
          <p>生成只会在你主动点击后进行。评分报告不会被改写。</p>
        </div>
      </section>
    `;
  }

  if (!extension) {
    return `
      <section class="page">
        ${pageHeader(
          "Optional Learning Extension",
          "完整改写属于拓展学习",
          "它不是每日练习的必做内容，也不会改变已有评分。",
          `<button class="back-link" data-action="back-report" data-id="${attempt.id}">${icon("arrow", 16)}返回报告</button>`
        )}
        <div class="learning-intro panel">
          <span class="empty-icon">${icon("sparkle", 30)}</span>
          <h2>生成完整 IELTS 改写与随机写作方法</h2>
          <p>系统会先展示完整示范，再随机抽取引言、双方观点、理由发展或个人立场中的一个深入拆解。你需要提取万能表达，并用这个模板完成一次 50–80 词迁移练习。</p>
          <button class="button button-primary button-large" data-action="generate-learning" data-id="${attempt.id}">
            ${icon("sparkle")}生成进阶学习
          </button>
        </div>
      </section>
    `;
  }

  const progress = learningProgress(extension);
  const activeFunction = ensureActiveLearningFunction(extension, attempt);
  const activePattern = activeFunction?.universalPattern || "";
  return `
    <section class="page learning-page">
      <header class="learning-hero">
        <button class="back-link" data-action="back-report" data-id="${attempt.id}">${icon("arrow", 16)}返回报告</button>
        <span class="eyebrow">Optional Learning Extension</span>
        <h1>不要背范文，拆出可以重复使用的方法</h1>
        <p>${escapeHtml(extension.content?.disclaimer || "完整 IELTS 改写示范，仅用于拓展学习。")}</p>
        <div class="learning-meta">
          <span>${extension.content?.wordCount || wordCount(extension.content?.improvedVersion)} 词完整示范</span>
          <span>随机深拆 1 个功能</span>
          <span>50–80 词迁移练习</span>
        </div>
      </header>

      <section class="report-section improved-version">
        <div class="section-title">
          <div><span class="eyebrow">Improved IELTS Version</span><h2>完整改写示范</h2></div>
          <span class="quiet-label">高亮部分为本次随机拆解</span>
        </div>
        <div class="rewrite-copy full">
          ${highlightActiveExcerpt(extension.content?.improvedVersion || "", activeFunction?.excerpt || "")
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
            .join("")}
        </div>
      </section>

      <section class="function-learning">
        <div class="section-title">
          <div><span class="eyebrow">Random Deep Dive</span><h2>这次只深入拆解一个部分</h2></div>
          <button class="button button-ghost button-small" data-action="change-learning-section">${icon("sparkle", 15)}换一个部分</button>
        </div>
        <div class="learning-function-tabs">
          ${(extension.content?.functions || [])
            .filter((item) => item.id !== "conclusion")
            .map((item) => `
              <button class="${item.id === activeFunction?.id ? "is-active" : ""}" data-action="change-learning-section" data-id="${item.id}">
                ${escapeHtml(item.title.replace("怎样", ""))}
              </button>
            `).join("")}
          <span>结论 · 简读</span>
        </div>
        <div class="function-card-list">
          ${activeFunction ? renderLearningFunctionCard(activeFunction, Math.max(0, (extension.content?.functions || []).findIndex((item) => item.id === activeFunction.id)), progress) : ""}
        </div>
      </section>

      <section class="transfer-board">
        <div class="section-title">
          <div><span class="eyebrow">Transfer Practice</span><h2>最后把它迁移到自己的表达</h2></div>
          <span class="quiet-label">50–80 词</span>
        </div>
        <p class="transfer-prompt">使用“${escapeHtml(activeFunction?.title || "本次写法")}”的结构，围绕原题重新表达一次。保留你的观点，不照抄范文。</p>
        <div class="tag-row">
          ${activePattern ? `<span>${escapeHtml(activePattern)}</span>` : ""}
        </div>
        <label class="field">
          <span>你的迁移练习</span>
          <textarea data-input="learning-transfer" rows="7" placeholder="使用刚才提取的结构重新表达，明确立场并给出理由或结果。">${escapeHtml(progress.transferText || "")}</textarea>
        </label>
        <div class="transfer-actions">
          <span><strong data-learning-word-count>${wordCount(progress.transferText || "")}</strong> 词</span>
          <button class="button button-primary" data-action="check-transfer">${icon("check")}检查迁移练习</button>
        </div>
        ${progress.transferResult ? renderTransferResult(progress.transferResult) : ""}
      </section>

      <div class="learning-finish">
        <div>
          <strong>${progress.completed ? "本课已完成" : "完成后会保存在这条练习记录中"}</strong>
          <span>下次打开仍可继续提取和修改。</span>
        </div>
        <button class="button ${progress.completed ? "button-ghost" : "button-primary"}" data-action="complete-learning">
          ${icon("check")}${progress.completed ? "已保存" : "完成本课"}
        </button>
      </div>
    </section>
  `;
}

function renderLearningFunctionCard(item, index, progress) {
  const checked = progress.checked?.[item.id];
  const answer = progress.answers?.[item.id] || "";
  return `
    <article class="learning-function-card">
      <header>
        <span>${String(index + 1).padStart(2, "0")}</span>
        <div><small>${escapeHtml(item.id.replaceAll("_", " "))}</small><h3>${escapeHtml(item.title)}</h3></div>
      </header>
      <blockquote>“${escapeHtml(item.excerpt)}”</blockquote>
      <label class="field">
        <span>提取可以替换内容的万能结构</span>
        <textarea data-input="learning-answer" data-id="${item.id}" rows="3" placeholder="用 X、Y 或名词占位符写出结构。">${escapeHtml(answer)}</textarea>
      </label>
      <button class="button button-ghost button-small" data-action="check-extraction" data-id="${item.id}">
        ${icon("check", 15)}检查提取
      </button>
      ${checked ? `
        <div class="extraction-result ${checked.correct ? "is-correct" : "needs-review"}">
          <strong>${checked.correct ? "方向正确" : "再对照一次"}</strong>
          <div><span>参考结构</span><code>${escapeHtml(item.universalPattern)}</code></div>
          <p>${escapeHtml(item.explanation)}</p>
          <p>${escapeHtml(item.usageNote)}</p>
        </div>
      ` : ""}
    </article>
  `;
}

function renderTransferResult(result) {
  return `
    <div class="transfer-result ${result.passed ? "is-correct" : "needs-review"}">
      <strong>${result.passed ? "迁移任务已达标" : "再补足几个要求"}</strong>
      <div class="transfer-checks">
        ${result.checks.map((check) => `<span class="${check.passed ? "is-correct" : "needs-review"}">${check.passed ? "✓" : "○"} ${escapeHtml(check.label)}</span>`).join("")}
      </div>
    </div>
  `;
}

function learningProgress(extension) {
  if (!extension.progress) {
    extension.progress = {
      answers: {},
      checked: {},
      transferText: "",
      transferResult: null,
      completed: false,
      updatedAt: new Date().toISOString(),
    };
  }
  return extension.progress;
}

function ensureActiveLearningFunction(extension, attempt) {
  const functions = extension.content?.functions || [];
  const randomIds = new Set(["introduction", "both_views", "reason_development", "position"]);
  const current = functions.find((item) => item.id === extension.progress.activeFunctionId);
  if (current && randomIds.has(current.id)) return current;

  const coverage = attempt?.evaluation?.taskCoverage || {};
  const rubric = attempt?.evaluation?.rubric || {};
  const weights = {
    introduction: 1 + (Number(rubric.ideaClarity) <= 1 ? 2 : 0),
    both_views: 1 + (coverage.bothViews?.status !== "complete" ? 4 : 0),
    reason_development: 1
      + (coverage.concreteReasons?.status !== "complete" ? 3 : 0)
      + (coverage.explanationOrExample?.status !== "complete" ? 3 : 0)
      + (Number(rubric.organization) <= 1 ? 2 : 0),
    position: 1 + (coverage.position?.status !== "complete" ? 4 : 0),
  };
  const selectedId = weightedChoice(
    Object.entries(weights).map(([id, weight]) => ({ id, weight })),
  );
  extension.progress.activeFunctionId = selectedId;
  extension.updatedAt = new Date().toISOString();
  saveData();
  return functions.find((item) => item.id === selectedId) || functions[0] || null;
}

function changeLearningSection(preferredId = "") {
  const extension = learningExtensionByAttemptId(state.route.id);
  const attempt = attemptById(state.route.id);
  if (!extension || !attempt) return;
  const functions = extension.content?.functions || [];
  const randomFunctions = functions.filter((item) => ["introduction", "both_views", "reason_development", "position"].includes(item.id));
  if (!randomFunctions.length) return;

  let selected = randomFunctions.find((item) => item.id === preferredId);
  if (!selected || selected.id === extension.progress.activeFunctionId) {
    const candidates = randomFunctions.filter((item) => item.id !== extension.progress.activeFunctionId);
    const coverage = attempt.evaluation?.taskCoverage || {};
    const rubric = attempt.evaluation?.rubric || {};
    const weights = {
      introduction: 1 + (Number(rubric.ideaClarity) <= 1 ? 2 : 0),
      both_views: 1 + (coverage.bothViews?.status !== "complete" ? 4 : 0),
      reason_development: 1
        + (coverage.concreteReasons?.status !== "complete" ? 3 : 0)
        + (coverage.explanationOrExample?.status !== "complete" ? 3 : 0),
      position: 1 + (coverage.position?.status !== "complete" ? 4 : 0),
    };
    const selectedId = weightedChoice(candidates.map((item) => ({ id: item.id, weight: weights[item.id] || 1 })));
    selected = candidates.find((item) => item.id === selectedId);
  }
  extension.progress.activeFunctionId = selected?.id || extension.progress.activeFunctionId;
  extension.progress.transferResult = null;
  extension.updatedAt = new Date().toISOString();
  saveData();
  render();
}

function highlightActiveExcerpt(text, excerpt) {
  const escaped = escapeHtml(text);
  const target = escapeHtml(excerpt);
  if (!target || !escaped.includes(target)) return escaped;
  return escaped.replace(target, `<mark class="rewrite-highlight">${target}</mark>`);
}

async function openLearningExtension(attemptId) {
  const extension = learningExtensionByAttemptId(attemptId);
  if (extension) {
    navigate(`learn/${attemptId}`);
    return;
  }
  state.ui.learningLoading = true;
  navigate(`learn/${attemptId}`);
  await generateLearningExtension(attemptId);
}

async function generateLearningExtension(attemptId) {
  const attempt = attemptById(attemptId);
  if (!attempt) return;
  state.ui.learningLoading = true;
  if (state.route.page !== "learn") navigate(`learn/${attemptId}`);
  render();

  try {
    const payload = await runLearningExtension({
      mode: attempt.mode,
      taskType: attempt.taskType,
      prompt: attempt.promptSnapshot?.promptText || "",
      responseText: attempt.responseText,
      materials: attempt.materialsSnapshot || [],
      evaluation: attempt.evaluation || {},
    });

    const extension = {
      id: uid("learning"),
      attemptId,
      status: "ready",
      content: payload,
      progress: {
        answers: {},
        checked: {},
        transferText: "",
        transferResult: null,
        completed: false,
        updatedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.data.learningExtensions.unshift(extension);
    saveData();
    state.ui.learningLoading = false;
    render();
    toast("进阶学习已生成，并保存在本次练习中。", "success");
  } catch (error) {
    state.ui.learningLoading = false;
    render();
    toast(error.message || "进阶学习生成失败，可以稍后重试。", "error");
  }
}

function checkLearningExtraction(functionId) {
  const extension = learningExtensionByAttemptId(state.route.id);
  const item = extension?.content?.functions?.find((candidate) => candidate.id === functionId);
  if (!extension || !item) return;
  const input = document.querySelector(`[data-input="learning-answer"][data-id="${functionId}"]`);
  const answer = input?.value.trim() || "";
  const progress = learningProgress(extension);
  progress.answers[functionId] = answer;
  progress.checked[functionId] = {
    correct: patternMatches(answer, item.universalPattern),
    checkedAt: new Date().toISOString(),
  };
  progress.updatedAt = new Date().toISOString();
  extension.updatedAt = new Date().toISOString();
  saveData();
  render();
}

function checkTransferPractice() {
  const extension = learningExtensionByAttemptId(state.route.id);
  const attempt = attemptById(state.route.id);
  if (!extension) return;
  const activeFunction = ensureActiveLearningFunction(extension, attempt);
  const input = document.querySelector('[data-input="learning-transfer"]');
  const text = input?.value.trim() || "";
  const progress = learningProgress(extension);
  progress.transferText = text;
  const words = wordCount(text);
  const patterns = activeFunction?.universalPattern ? [activeFunction.universalPattern] : [];
  const coveredPatterns = patterns.filter((pattern) => patternCoverage(text, pattern) >= 0.6);
  const hasPosition = /\b(in my opinion|i believe|i think|my view|i support)\b/i.test(text);
  const hasReason = /\b(because|therefore|as a result|this is because|since)\b/i.test(text);
  const checks = [
    { label: `50–80 词（当前 ${words} 词）`, passed: words >= 50 && words <= 80 },
    { label: `使用本次模板（${activeFunction?.title || "随机结构"}）`, passed: coveredPatterns.length > 0 },
    { label: "明确表达个人立场", passed: hasPosition },
    { label: "给出原因或结果", passed: hasReason },
  ];
  progress.transferResult = {
    passed: checks.every((check) => check.passed),
    checks,
    coveredPatterns,
    checkedAt: new Date().toISOString(),
  };
  progress.updatedAt = new Date().toISOString();
  extension.updatedAt = new Date().toISOString();
  saveData();
  render();
}

function renderFormalReport(attempt) {
  const evaluation = attempt.evaluation || {};
  const criteria = evaluation.criteria || {};
  const order = ["task", "coherence", "lexical", "grammar"];
  return `
    <section class="page report-page">
      <header class="report-hero formal-hero">
        <div class="report-hero-copy">
          <span class="eyebrow">IELTS Estimated Band</span>
          <h1>${escapeHtml(evaluation.estimatedBandRange || `Band ${evaluation.estimatedBand || 0}`)}</h1>
          <p>AI 估算，不是官方成绩。评分以四项原文证据为基础。</p>
          <div class="hero-actions">
            <button class="button button-light" data-action="repeat-attempt" data-id="${attempt.id}">${icon("pen")}再写一次</button>
            <button class="button button-glass" data-action="copy-report" data-id="${attempt.id}">${icon("download")}复制报告</button>
            <button class="button button-glass" data-action="export-report" data-id="${attempt.id}">${icon("download")}导出报告</button>
          </div>
        </div>
        <div class="band-display">
          <strong>${Number(evaluation.estimatedBand || 0).toFixed(1)}</strong>
          <span>Estimated</span>
        </div>
      </header>

      <div class="criterion-grid">
        ${order.map((key) => {
          const criterion = criteria[key] || {};
          return `
            <article class="criterion-card">
              <div class="criterion-head">
                <span>${escapeHtml(criterion.name || key)}</span>
                <strong>${Number(criterion.estimatedBand || 0).toFixed(1)}</strong>
              </div>
              <div class="criterion-bar"><span style="--band:${Math.min(100, Number(criterion.estimatedBand || 0) / 9 * 100)}%"></span></div>
              ${(criterion.evidence || []).length ? `
                <blockquote>“${escapeHtml(truncate(criterion.evidence[0], 180))}”</blockquote>
              ` : ""}
              <p>${escapeHtml(criterion.limitation || "暂无额外说明。")}</p>
            </article>
          `;
        }).join("")}
      </div>

      <div class="report-grid">
        <section class="report-section">
          <div class="section-title"><div><span class="eyebrow">Priority</span><h2>本轮只处理一件事</h2></div></div>
          <div class="fix-grid">
            <div><span>Priority Fix</span><p>${escapeHtml(evaluation.priorityFix || "暂无明确问题。")}</p></div>
            <div><span>Minimal Rewrite Demonstration</span><p>${escapeHtml(evaluation.minimalRewrite || evaluation.rewriteDemonstration || "保留原意，只修改最关键的一处。")}</p></div>
            <div><span>Next Revision Task</span><p>${escapeHtml(evaluation.nextRevisionTask || "重写问题句，并保持全文立场一致。")}</p></div>
          </div>
        </section>
        <section class="report-section">
          <div class="section-title"><div><span class="eyebrow">Target Language</span><h2>今日素材使用</h2></div></div>
          ${renderUsageItems(evaluation.targetUsage)}
        </section>
      </div>
      ${renderReportLearningCta(attempt)}
      ${renderAttemptSource(attempt)}
    </section>
  `;
}

function renderUsageItems(targetUsage = {}) {
  const items = [
    ...(targetUsage.vocabulary || []),
    ...(targetUsage.patterns || []),
  ];
  if (!items.length) {
    return `<p class="quiet-copy">本次没有可检查的目标素材。</p>`;
  }
  const labels = {
    not_used: "未使用",
    accurate: "准确自然",
    grammar_issue: "语法问题",
    semantic_issue: "语义不匹配",
    mechanical: "机械使用",
  };
  return `
    <div class="usage-list">
      ${items.map((item) => `
        <article class="usage-item status-${escapeHtml(item.status || "not_used")}">
          <div class="usage-head">
            <strong>${escapeHtml(item.label || "目标表达")}</strong>
            <span>${labels[item.status] || labels.not_used}</span>
          </div>
          ${item.excerpt ? `<blockquote>“${escapeHtml(item.excerpt)}”</blockquote>` : ""}
          <p>${escapeHtml(item.explanation || "模型未提供额外说明。")}</p>
          ${item.suggestedRevision ? `<div class="suggested-fix"><span>修改示范</span><p>${escapeHtml(item.suggestedRevision)}</p></div>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function renderAttemptSource(attempt) {
  return `
    <section class="report-section source-section">
      <div class="section-title">
        <div><span class="eyebrow">Original</span><h2>本次原文</h2></div>
        <span class="quiet-label">${attempt.wordCount || wordCount(attempt.responseText)} 词</span>
      </div>
      <p class="source-prompt">${escapeHtml(attempt.promptSnapshot?.promptText || "")}</p>
      <div class="source-response">${escapeHtml(attempt.responseText).replace(/\n/g, "<br />")}</div>
    </section>
  `;
}

function renderSettings() {
  const counts = {
    prompts: state.data.prompts.length,
    sessions: state.data.dailySessions.length,
    attempts: state.data.attempts.length,
    corpus: state.data.corpusItems.length,
  };
  const syncLabel = {
    idle: "等待同步",
    pending: "待同步",
    syncing: "正在同步",
    synced: "已同步",
    error: "同步失败",
  }[state.sync.status] || "等待同步";
  return `
    <section class="page">
      ${pageHeader(
        "设置",
        "云端空间与数据",
        "本地保留离线缓存，登录后自动同步到 Supabase。",
        `<span class="status-pill ${state.serverStatus?.configured ? "is-ready" : ""}">${state.serverStatus?.configured ? "DeepSeek 已连接" : "DeepSeek 未配置"}</span>`
      )}

      <div class="settings-grid">
        <section class="panel settings-panel">
          <div class="panel-heading">
            <div><span class="eyebrow">数据概况</span><h2>${escapeHtml(state.data.settings?.learnerName || "我的本地记忆库")}</h2></div>
          </div>
          <div class="settings-stats">
            <div>${statValue(counts.prompts, "题目")}</div>
            <div>${statValue(counts.sessions, "学习日")}</div>
            <div>${statValue(counts.attempts, "练习")}</div>
            <div>${statValue(counts.corpus, "语料")}</div>
          </div>
          <p class="quiet-copy">浏览器 localStorage 作为离线缓存；登录后数据同步到你的 Supabase 账号。</p>
        </section>

        <section class="panel settings-panel">
          <div class="panel-heading">
            <div><span class="eyebrow">AI 服务</span><h2>DeepSeek</h2></div>
            <span class="connection-dot ${state.serverStatus?.configured ? "is-on" : ""}"></span>
          </div>
          <dl class="status-list">
            <div><dt>状态</dt><dd>${state.serverStatus?.configured ? "已配置" : "未配置"}</dd></div>
            <div><dt>密钥</dt><dd>${escapeHtml(maskApiKey(getStoredConfig().apiKey) || "—")}</dd></div>
            <div><dt>模型</dt><dd>${escapeHtml(state.serverStatus?.model || "deepseek-chat")}</dd></div>
            <div><dt>接口地址</dt><dd>${escapeHtml(state.serverStatus?.baseUrl || "https://api.deepseek.com")}</dd></div>
            <div><dt>密钥位置</dt><dd>浏览器 localStorage</dd></div>
          </dl>
          <form id="deepseek-config-form" class="settings-form" autocomplete="off">
            <label class="field">
              <span class="field-label">DeepSeek API Key</span>
              <input
                type="password"
                name="apiKey"
                placeholder="sk-..."
                value="${escapeHtml(getStoredConfig().apiKey ? "********" : "")}"
                autocomplete="off"
                spellcheck="false"
              />
            </label>
            <div class="field-grid">
              <label class="field">
                <span class="field-label">接口地址</span>
                <input
                  type="text"
                  name="baseUrl"
                  placeholder="https://api.deepseek.com"
                  value="${escapeHtml(getStoredConfig().baseUrl)}"
                  autocomplete="off"
                  spellcheck="false"
                />
              </label>
              <label class="field">
                <span class="field-label">模型</span>
                <input
                  type="text"
                  name="model"
                  placeholder="deepseek-chat"
                  value="${escapeHtml(getStoredConfig().model)}"
                  autocomplete="off"
                  spellcheck="false"
                />
              </label>
            </div>
            <div class="backup-actions">
              <button class="button button-primary" data-action="save-deepseek-config" type="button">${icon("check")}保存</button>
              <button class="button button-ghost" data-action="test-deepseek-config" type="button">${icon("sparkle")}测试连接</button>
              <button class="button button-ghost" data-action="copy-activation-link" type="button">${icon("upload")}复制激活链接</button>
              <button class="button button-ghost" data-action="clear-deepseek-config" type="button">${icon("trash")}清除</button>
            </div>
          </form>
          ${!state.serverStatus?.configured ? `
            <div class="notice">
              填写你的 DeepSeek API Key 以启用 AI 评价、推荐、修改批改、进阶学习与语料练习。Key 只保存在当前浏览器的 localStorage 中，不会被上传到云端。
            </div>
          ` : ""}
          <p class="quiet-copy">提示：浏览器未保存 Key 时，会自动通过 Railway 服务端代理调用 DeepSeek。</p>
        </section>

        <section class="panel settings-panel wide">
          <div class="panel-heading">
            <div><span class="eyebrow">Cloud Sync</span><h2>Supabase 云端同步</h2></div>
            <span class="status-pill ${state.sync.status === "synced" ? "is-ready" : ""}">${syncLabel}</span>
          </div>
          <dl class="status-list">
            <div><dt>当前账号</dt><dd>${escapeHtml(state.auth.user?.email || "未登录")}</dd></div>
            <div><dt>云端版本</dt><dd>${state.data._sync?.version || 0}</dd></div>
            <div><dt>最近同步</dt><dd>${state.data._sync?.lastSyncedAt ? formatDate(state.data._sync.lastSyncedAt) : "尚未同步"}</dd></div>
            <div><dt>同步方式</dt><dd>localStorage ↔ Supabase</dd></div>
          </dl>
          ${state.sync.error ? `<div class="notice error-notice">${escapeHtml(state.sync.error)}</div>` : ""}
          <div class="backup-actions">
            <button class="button button-primary" data-action="sync-now" type="button">${icon("refresh")}立即同步</button>
          </div>
        </section>

        <section class="panel settings-panel wide">
          <div class="panel-heading">
            <div><span class="eyebrow">备份与恢复</span><h2>完整保存本地数据</h2></div>
          </div>
          <div class="backup-actions">
            <button class="button button-primary" data-action="export-backup">${icon("download")}导出 JSON 备份</button>
            <button class="button button-ghost" data-action="choose-backup-file">${icon("upload")}选择备份文件</button>
            <select data-input="backup-mode" aria-label="导入方式">
              <option value="merge" ${state.ui.backupMode === "merge" ? "selected" : ""}>合并数据</option>
              <option value="replace" ${state.ui.backupMode === "replace" ? "selected" : ""}>覆盖当前数据</option>
            </select>
            <input id="backup-file" class="visually-hidden" type="file" accept=".json,application/json" data-input="backup-file" />
          </div>
          ${state.ui.pendingBackup ? `
            <div class="backup-preview">
              <strong>已读取备份</strong>
              <span>${state.ui.pendingBackup.prompts.length} 题 · ${state.ui.pendingBackup.dailySessions.length} 学习日 · ${state.ui.pendingBackup.attempts.length} 次练习</span>
              <button class="button button-primary" data-action="restore-backup">恢复此备份</button>
            </div>
          ` : ""}
        </section>

        <section class="panel settings-panel danger-panel wide">
          <div>
            <span class="eyebrow">危险操作</span>
            <h2>清空本地数据</h2>
            <p>删除所有题库、学习素材、作文和报告。此操作无法撤销。</p>
          </div>
          <button class="button button-danger" data-action="clear-data">${icon("trash")}清空本地数据</button>
        </section>
      </div>
    </section>
  `;
}

function renderDialog() {
  const dialog = state.ui.dialog;
  if (!dialog) return "";
  if (dialog.type === "prompt") return renderPromptDialog(dialog.promptId);
  if (dialog.type === "import-prompts") return renderPromptImportDialog();
  if (dialog.type === "choose-prompt") return renderChoosePromptDialog();
  return "";
}

function renderPromptDialog(promptId = "") {
  const prompt = promptById(promptId);
  return `
    <div class="modal-layer" data-action="close-dialog">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="prompt-dialog-title" data-modal>
        <header class="modal-head">
          <div><span class="eyebrow">题库编辑</span><h2 id="prompt-dialog-title">${prompt ? "修改题目" : "新建题目"}</h2></div>
          <button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon("close")}</button>
        </header>
        <form id="prompt-form" class="form-grid">
          <label class="field"><span>题型</span>
            <select name="taskType">
              <option value="task1" ${prompt?.taskType === "task1" ? "selected" : ""}>Task 1</option>
              <option value="task2" ${!prompt || prompt?.taskType === "task2" ? "selected" : ""}>Task 2</option>
            </select>
          </label>
          <label class="field"><span>标题</span><input name="title" required value="${escapeHtml(prompt?.title || "")}" placeholder="Free University Education" /></label>
          <label class="field"><span>主题</span><input name="topic" value="${escapeHtml(prompt?.topic || "")}" placeholder="Education" /></label>
          <label class="field"><span>任务类型</span><input name="taskKind" value="${escapeHtml(prompt?.taskKind || "")}" placeholder="Discuss both views" /></label>
          <label class="field wide"><span>标签</span><input name="tags" value="${escapeHtml((prompt?.tags || []).join(", "))}" placeholder="university, funding, students" /></label>
          <label class="field wide"><span>题目正文</span><textarea name="promptText" rows="5" required placeholder="Some people believe...">${escapeHtml(prompt?.promptText || "")}</textarea></label>
          <label class="field wide"><span>来源</span><input name="source" value="${escapeHtml(prompt?.source || "Internal IELTS-style practice prompt")}" /></label>
        </form>
        <footer class="modal-actions">
          <button class="button button-ghost" data-action="close-dialog">取消</button>
          <button class="button button-primary" data-action="save-prompt" data-id="${prompt?.id || ""}">${icon("check")}保存题目</button>
        </footer>
      </section>
    </div>
  `;
}

function renderPromptImportDialog() {
  const preview = parsePromptMarkdown(state.ui.pendingPromptMarkdown);
  return `
    <div class="modal-layer" data-action="close-dialog">
      <section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" data-modal>
        <header class="modal-head">
          <div><span class="eyebrow">Markdown 导入</span><h2 id="import-dialog-title">导入写作题库</h2></div>
          <button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon("close")}</button>
        </header>
        <div class="form-grid">
          <label class="field wide">
            <span>Markdown 内容</span>
            <textarea id="prompt-import-text" data-input="prompt-import-text" rows="14" placeholder="## Task 2&#10;&#10;### Free University Education&#10;- Topic: Education&#10;- Kind: Discuss both views&#10;&#10;Some people believe...">${escapeHtml(state.ui.pendingPromptMarkdown)}</textarea>
          </label>
          <label class="field">
            <span>导入方式</span>
            <select id="prompt-import-mode">
              <option value="merge">合并并跳过重复标题</option>
              <option value="replace">覆盖当前题库</option>
            </select>
          </label>
          <label class="field">
            <span>或选择文件</span>
            <input id="prompt-file" type="file" accept=".md,.markdown,text/markdown,text/plain" data-input="prompt-file" />
          </label>
        </div>
        <div id="prompt-import-preview" class="import-preview">
          <strong>${preview.length ? `已识别 ${preview.length} 道题目` : "等待 Markdown 内容"}</strong>
          <span>${preview.length
            ? `Task 1 ${preview.filter((prompt) => prompt.taskType === "task1").length} 道 · Task 2 ${preview.filter((prompt) => prompt.taskType === "task2").length} 道`
            : "导入前会检查标题、题型和题目正文。"}</span>
        </div>
        <footer class="modal-actions">
          <button class="button button-ghost" data-action="close-dialog">取消</button>
          <button class="button button-primary" data-action="confirm-import-prompts">${icon("upload")}验证并导入</button>
        </footer>
      </section>
    </div>
  `;
}

function renderChoosePromptDialog() {
  const prompts = state.data.prompts.slice(0, 60);
  return `
    <div class="modal-layer" data-action="close-dialog">
      <section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="choose-dialog-title" data-modal>
        <header class="modal-head">
          <div><span class="eyebrow">手动更换</span><h2 id="choose-dialog-title">选择今天的题目</h2></div>
          <button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon("close")}</button>
        </header>
        <div class="choose-list">
          ${prompts.map((prompt) => `
            <button class="choose-item" data-action="use-prompt" data-id="${prompt.id}">
              <span>${taskBadge(prompt.taskType)} ${escapeHtml(prompt.topic || "General")}</span>
              <strong>${escapeHtml(prompt.title)}</strong>
              <small>${escapeHtml(truncate(prompt.promptText, 110))}</small>
            </button>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}

function formatTimer(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function stopTimer() {
  if (state.timer.handle) {
    clearInterval(state.timer.handle);
    state.timer.handle = null;
  }
}

function startTimer() {
  stopTimer();
  const input = document.querySelector("#timer-minutes");
  const minutes = Math.max(1, Math.min(120, Number(input?.value) || 15));
  state.timer.totalSeconds = minutes * 60;
  state.timer.remainingSeconds = minutes * 60;
  updateTimerDisplay();
  state.timer.handle = setInterval(() => {
    state.timer.remainingSeconds = Math.max(0, state.timer.remainingSeconds - 1);
    updateTimerDisplay();
    if (state.timer.remainingSeconds === 0) {
      stopTimer();
      toast("计时结束，草稿已经保存。", "success");
    }
  }, 1000);
  toast(`已开始 ${minutes} 分钟计时。`);
}

function resetTimer() {
  stopTimer();
  state.timer.totalSeconds = 0;
  state.timer.remainingSeconds = 0;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const element = document.querySelector("#timer-value");
  if (element) element.textContent = formatTimer(state.timer.remainingSeconds);
}

async function hydratePrompts() {
  if (state.data.settings?.builtInPromptsLoaded) return;
  if (state.data.prompts.length) {
    state.data.settings.builtInPromptsLoaded = true;
    saveData();
    return;
  }
  try {
    const markdown = PROMPTS_MARKDOWN;
    if (!markdown) throw new Error("内置题库数据为空。");
    const prompts = parsePromptMarkdown(markdown);
    state.data.prompts = prompts.map((prompt) => ({
      ...prompt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    state.data.settings.builtInPromptsLoaded = true;
    saveData();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function refreshServerStatus() {
  const config = getStoredConfig();
  if (!config.apiKey) {
    try {
      const response = await fetch("/api/status");
      if (response.ok) {
        const payload = await response.json();
        if (payload?.configured) {
          state.serverStatus = {
            configured: true,
            model: payload.model || config.model,
            baseUrl: payload.baseUrl || config.baseUrl,
            source: "server",
          };
          return;
        }
      }
    } catch {
      // The static browser client remains available without the local proxy.
    }
  }
  state.serverStatus = {
    configured: Boolean(config.apiKey),
    model: config.model,
    baseUrl: config.baseUrl,
    source: config.apiKey ? "browser" : "local",
  };
}

function setSyncStatus(status, error = "") {
  state.sync.status = status;
  state.sync.error = error;
  state.sync.lastSyncedAt = state.data._sync?.lastSyncedAt || state.sync.lastSyncedAt;
}

function scheduleCloudSave() {
  if (!state.auth?.session?.user?.id) return;
  setSyncStatus("pending");
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    try {
      setSyncStatus("syncing");
      render();
      await pushCloudState(state.auth.user.id, state.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
      setSyncStatus("synced");
      render();
    } catch (error) {
      setSyncStatus("error", error.message || "云端同步失败。");
      render();
    }
  }, 1200);
}

async function syncNow({ renderAfter = true } = {}) {
  if (!state.auth?.session?.user?.id) return null;
  setSyncStatus("syncing");
  if (renderAfter) render();
  try {
    const result = await reconcileCloudState(state.auth.user.id, state.data);
    if (result.action === "downloaded") {
      state.data = result.data;
      ensureSyncMeta(state.data);
      saveData({ cloud: false, markChanged: false });
    }
    setSyncStatus("synced");
    if (renderAfter) render();
    return result.action;
  } catch (error) {
    setSyncStatus("error", error.message || "云端同步失败。");
    if (renderAfter) render();
    return null;
  }
}

async function testDeepSeekConnection() {
  const { __internals } = await import("./deepseek.mjs");
  const config = getStoredConfig();
  if (!config.apiKey) {
    toast("请先填写 DeepSeek API Key。", "error");
    return;
  }
  toast("正在测试连接…", "info");
  try {
    const text = await __internals.callDeepSeek([
      { role: "system", content: "You verify connectivity. Reply with a single short sentence and nothing else." },
      { role: "user", content: "ping" },
    ], config);
    if (text) toast("连接成功。", "success");
  } catch (error) {
    toast(error.message || "连接失败。", "error");
  }
}

async function handleMatch() {
  const session = ensureTodaySession();
  const materials = parsedTodayMaterials();
  if (!materials.length) return toast("先输入至少一条词伙或句式。", "error");
  if (!state.data.prompts.length) return toast("题库为空，请先导入题目。", "error");

  session.parsedVocabulary = materials.filter((item) => item.type === "vocabulary");
  session.parsedPatterns = materials.filter((item) => item.type === "pattern");
  session.updatedAt = new Date().toISOString();
  saveData();
  state.ui.matching = true;
  render();

  let result = null;
  try {
    if (isDeepSeekConfigured()) {
      result = await runMatch({ materials, prompts: state.data.prompts });
      result.method = "deepseek";
    }
  } catch (error) {
    state.ui.matching = false;
    saveData();
    render();
    toast(error.message || "DeepSeek 匹配失败，已改用本地规则。", "error");
    return;
  }

  if (!result) {
    result = recommendPrompt(materials, state.data.prompts, state.data.attempts.map((attempt) => attempt.promptSnapshot?.id));
    result.method = "local";
  }

  session.recommendedPromptId = result.prompt.id;
  session.selectedPromptId = result.prompt.id;
  session.matchReason = result.reason;
  session.matchConfidence = result.confidence;
  session.matchMethod = result.method;
  session.unmatchedMaterialIds = result.unmatchedMaterialIds || [];
  session.parsedVocabulary = materials.filter((item) => item.type === "vocabulary");
  session.parsedPatterns = materials.filter((item) => item.type === "pattern");
  session.updatedAt = new Date().toISOString();
  state.ui.selectedPromptId = result.prompt.id;
  state.ui.matching = false;
  saveData();
  render();
  toast(result.method === "deepseek" ? "DeepSeek 已选出今日题目。" : "已使用本地规则选出今日题目。", "success");
}

async function handleSubmitResponse() {
  const prompt = activePrompt();
  const session = todaySession();
  if (!prompt || !session) return;
  const textarea = document.querySelector("#response-text");
  const text = textarea?.value.trim() || "";
  if (!text) return toast("作文内容为空。", "error");

  const words = wordCount(text);
  const minimum = state.ui.mode === "simple" ? 20 : prompt.taskType === "task1" ? 80 : 120;
  if (words < minimum) {
    const confirmed = window.confirm(`当前只有 ${words} 词。样本越短，评分可靠性越低。仍然提交吗？`);
    if (!confirmed) return;
  }

  saveDraft(prompt.id, state.ui.mode, text);
  state.ui.evaluating = true;
  render();

  try {
    const payload = await runEvaluate({
      mode: state.ui.mode,
      taskType: prompt.taskType,
      prompt: prompt.promptText,
      responseText: text,
      materials: parsedTodayMaterials(),
      wordCount: words,
      durationSeconds: Math.max(0, state.timer.totalSeconds - state.timer.remainingSeconds),
    });

    const attempt = {
      id: uid("attempt"),
      dailySessionId: session.id,
      mode: state.ui.mode,
      taskType: prompt.taskType,
      status: "completed",
      promptSnapshot: { ...prompt },
      materialsSnapshot: parsedTodayMaterials(),
      responseText: text,
      wordCount: words,
      durationSeconds: Math.max(0, state.timer.totalSeconds - state.timer.remainingSeconds),
      evaluation: payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.data.attempts.unshift(attempt);
    session.selectedPromptId = prompt.id;
    session.updatedAt = new Date().toISOString();
    localStorage.removeItem(draftKey(prompt.id, state.ui.mode));
    saveData();
    state.ui.evaluating = false;
    stopTimer();
    navigate(`report/${attempt.id}`);
  } catch (error) {
    state.ui.evaluating = false;
    render();
    toast(error.message || "评估失败，草稿仍已保留。", "error");
  }
}

function usePrompt(id) {
  const prompt = promptById(id);
  if (!prompt) return;
  const session = ensureTodaySession();
  session.selectedPromptId = prompt.id;
  session.recommendedPromptId = session.recommendedPromptId || prompt.id;
  session.matchReason = "手动从题库选择。";
  session.matchMethod = "manual";
  session.updatedAt = new Date().toISOString();
  state.ui.selectedPromptId = prompt.id;
  state.ui.dialog = null;
  saveData();
  navigate("practice");
  toast(`已选择 ${prompt.title}。`, "success");
}

function savePromptFromDialog(id = "") {
  const form = document.querySelector("#prompt-form");
  if (!form) return;
  const formData = new FormData(form);
  const payload = {
    taskType: String(formData.get("taskType") || "task2"),
    title: String(formData.get("title") || "").trim(),
    topic: String(formData.get("topic") || "").trim() || "General",
    taskKind: String(formData.get("taskKind") || "").trim() || "Practice",
    tags: String(formData.get("tags") || "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
    promptText: String(formData.get("promptText") || "").trim(),
    source: String(formData.get("source") || "").trim(),
  };
  if (!payload.title || !payload.promptText) return toast("标题和题目正文不能为空。", "error");

  if (id) {
    const index = state.data.prompts.findIndex((prompt) => prompt.id === id);
    if (index >= 0) {
      state.data.prompts[index] = {
        ...state.data.prompts[index],
        ...payload,
        updatedAt: new Date().toISOString(),
      };
    }
  } else {
    state.data.prompts.unshift({
      id: uid("prompt"),
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  state.ui.dialog = null;
  saveData();
  render();
  toast(id ? "题目已更新。" : "题目已创建。", "success");
}

function importPrompts() {
  const textarea = document.querySelector("#prompt-import-text");
  const mode = document.querySelector("#prompt-import-mode")?.value || "merge";
  const markdown = textarea?.value || "";
  const prompts = parsePromptMarkdown(markdown).map((prompt) => ({
    ...prompt,
    source: prompt.source || "Imported Markdown",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  if (!prompts.length) return toast("没有识别到有效题目。", "error");

  if (mode === "replace") {
    state.data.prompts = prompts;
  } else {
    const existing = new Set(state.data.prompts.map((prompt) => `${prompt.taskType}:${prompt.title.toLowerCase()}`));
    const additions = prompts.filter((prompt) => !existing.has(`${prompt.taskType}:${prompt.title.toLowerCase()}`));
    state.data.prompts = [...state.data.prompts, ...additions];
  }
  state.ui.dialog = null;
  state.ui.pendingPromptMarkdown = "";
  saveData();
  render();
  toast(`已导入 ${prompts.length} 道题目。`, "success");
}

function exportPromptBank() {
  downloadText("bandcraft-prompts.md", toPromptMarkdown(state.data.prompts), "text/markdown");
}

function buildReportMarkdown(attempt) {
  const evaluation = attempt.evaluation || {};
  const header = [
    `# ${attempt.promptSnapshot?.title || "写作报告"}`,
    "",
    `- 日期：${new Date(attempt.createdAt).toLocaleString("zh-CN")}`,
    `- 模式：${MODE_LABELS[attempt.mode] || attempt.mode}`,
    `- 题型：${TASK_LABELS[attempt.taskType] || attempt.taskType}`,
    `- 词数：${attempt.wordCount}`,
  ];
  const prompt = ["", "## 题目", "", attempt.promptSnapshot?.promptText || ""];
  const materials = [
    "",
    "## 今日素材",
    "",
    ...(attempt.materialsSnapshot || []).map((item) => `- ${item.label}: ${item.detail}`),
  ];
  const response = ["", "## 原文", "", attempt.responseText];
  let result = [];
  if (evaluation.type === "simple") {
    const isV2 = evaluation.rubricVersion === "daily-v0.2" || Boolean(evaluation.taskCoverage);
    result = [
      "",
      "## Daily Practice Rubric",
      "",
      `- 总分：${evaluation.dailyPracticeScore}/10`,
      ...(isV2 ? [
        `- Task Coverage：${evaluation.rubric?.taskCoverage}/2`,
        `- Idea Clarity：${evaluation.rubric?.ideaClarity}/2`,
        `- Organization：${evaluation.rubric?.organization}/2`,
        `- Word Choice：${evaluation.rubric?.wordChoice}/2`,
        `- Sentence Control：${evaluation.rubric?.sentenceControl}/2`,
      ] : [
        `- Task Relevance：${evaluation.rubric?.taskRelevance}/2`,
        `- Idea Clarity：${evaluation.rubric?.ideaClarity}/2`,
        `- Target Vocabulary：${evaluation.rubric?.targetVocabulary}/2`,
        `- Target Pattern：${evaluation.rubric?.targetPattern}/2`,
        `- Sentence Control：${evaluation.rubric?.sentenceControl}/2`,
      ]),
      "",
      "## One Sentence Diagnosis",
      "",
      evaluation.oneSentenceDiagnosis || evaluation.priorityFix || "",
      "",
      "## Minimal Rewrite",
      "",
      evaluation.minimalRewrite || evaluation.rewritePrompt || "",
      "",
      ...((evaluation.teachingFixes || evaluation.topErrors || [])).flatMap((item, index) => [
        `## Teacher Correction ${index + 1}`,
        "",
        `原文：${item.original}`,
        "",
        `问题：${item.problem}`,
        "",
        `基础自然版：${item.basicRewrite || item.minimalFix || ""}`,
        "",
        `基础结构：${item.basicPattern || item.requiredPattern || ""}`,
        "",
        `IELTS 进阶版：${item.advancedRewrite || item.basicRewrite || item.minimalFix || ""}`,
        "",
        `进阶结构：${item.advancedPattern || item.requiredPattern || ""}`,
        "",
        `使用条件：${item.usageCondition || ""}`,
        "",
      ]),
      ...(evaluation.retryTask?.prompt ? [
        "## Retry Task",
        "",
        evaluation.retryTask.instructions || "",
        "",
        evaluation.retryTask.prompt,
        "",
        `词数：${evaluation.retryTask.wordRange || "35-50"}`,
      ] : []),
    ];
  } else {
    result = [
      "",
      "## Estimated Band",
      "",
      evaluation.estimatedBandRange || evaluation.estimatedBand,
      "",
      ...Object.values(evaluation.criteria || {}).flatMap((criterion) => [
        `### ${criterion.name}`,
        "",
        `Band ${criterion.estimatedBand}`,
        "",
        ...(criterion.evidence || []).map((quote) => `> ${quote}`),
        "",
        criterion.limitation || "",
        "",
      ]),
      "## One Priority Fix",
      "",
      evaluation.priorityFix || "",
      "",
      "## Minimal Rewrite Demonstration",
      "",
      evaluation.minimalRewrite || evaluation.rewriteDemonstration || "",
    ];
  }
  const revision = revisionSessionByAttemptId(attempt.id);
  const revisionSection = revision?.rounds?.length ? [
    "",
    "## Revision Rounds",
    "",
    ...revision.rounds.flatMap((round) => [
      `### Round ${round.round}`,
      "",
      round.text,
      "",
      round.feedback?.coachSummary || "",
      "",
    ]),
  ] : [];
  return [...header, ...prompt, ...materials, ...response, ...result, ...revisionSection].join("\n");
}

function exportPracticeHistory() {
  const attempts = filterAttempts();
  if (!attempts.length) return toast("没有可导出的练习记录。", "error");
  const markdown = attempts.map(buildReportMarkdown).join("\n\n---\n\n");
  downloadText(`bandcraft-practice-${localDateKey()}.md`, markdown, "text/markdown");
}

function exportBackup() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    prompts: state.data.prompts,
    dailySessions: state.data.dailySessions,
    attempts: state.data.attempts,
    learningExtensions: state.data.learningExtensions,
    revisionSessions: state.data.revisionSessions,
    corpusItems: state.data.corpusItems,
    corpusAttempts: state.data.corpusAttempts,
    corpusUsageRecords: state.data.corpusUsageRecords,
    settings: state.data.settings,
  };
  downloadText(`bandcraft-backup-${localDateKey()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function restoreBackup() {
  if (!state.ui.pendingBackup) return toast("先选择一个备份文件。", "error");
  const backup = state.ui.pendingBackup;
  if (state.ui.backupMode === "replace") {
    const confirmed = window.confirm("覆盖会删除当前所有数据，且无法撤销。继续吗？");
    if (!confirmed) return;
    state.data = {
      ...defaultData(),
      ...backup,
    };
  } else {
    state.data = mergeBackupData(state.data, backup);
  }
  state.ui.pendingBackup = null;
  saveData();
  render();
  toast("备份已恢复。", "success");
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function updateMaterialCounts() {
  const session = todaySession();
  const vocabularyCount = parseMaterialInput(session?.vocabularyRaw || "", "vocabulary").length;
  const patternCount = parseMaterialInput(session?.patternsRaw || "", "pattern").length;
  const vocabularyElement = document.querySelector('[data-count="vocabulary"]');
  const patternElement = document.querySelector('[data-count="pattern"]');
  if (vocabularyElement) vocabularyElement.textContent = String(vocabularyCount);
  if (patternElement) patternElement.textContent = String(patternCount);
}

function toast(message, type = "info") {
  const element = document.createElement("div");
  element.className = `toast toast-${type}`;
  element.textContent = message;
  toastRegion.appendChild(element);
  requestAnimationFrame(() => element.classList.add("is-visible"));
  setTimeout(() => {
    element.classList.remove("is-visible");
    setTimeout(() => element.remove(), 180);
  }, 3200);
}

app.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  const action = trigger.dataset.action;
  if (action !== "close-dialog") event.preventDefault();

  if (action === "focus-material") {
    navigate("home");
    setTimeout(() => document.querySelector("#today-vocabulary")?.focus(), 0);
  }
  if (action === "set-auth-method") {
    state.ui.authMethod = trigger.dataset.value === "magic" ? "magic" : "password";
    state.auth.error = "";
    render();
  }
  if (action === "toggle-auth-mode") {
    state.ui.authMode = state.ui.authMode === "signup" ? "login" : "signup";
    state.auth.error = "";
    render();
  }
  if (action === "signin-password") await submitPasswordAuth("login");
  if (action === "signup-password") await submitPasswordAuth("signup");
  if (action === "send-magic-link") await submitMagicLink();
  if (action === "sign-out") {
    await signOut();
    state.auth = {
      ...state.auth,
      session: null,
      user: null,
      profile: null,
      error: "",
    };
    navigate("home");
    render();
  }
  if (action === "sync-now") {
    const result = await syncNow();
    toast(
      result === "downloaded"
        ? "已下载云端最新数据。"
        : result === "uploaded"
          ? "已上传本机最新数据。"
          : result === "unchanged"
            ? "本地与云端已一致。"
            : "同步未完成，请查看错误。",
      result ? "success" : "error",
    );
  }
  if (action === "reload-admin") await loadAdminData();
  if (action === "view-admin-user") await viewAdminUser(trigger.dataset.id);
  if (action === "toggle-user-status") await toggleAdminUserStatus(trigger.dataset.id, trigger.dataset.status);
  if (action === "close-admin-user") {
    state.admin.selectedUser = null;
    render();
  }
  if (action === "resend-login-email") {
    await resendLoginEmail(trigger.dataset.email);
    toast("登录邮件已重新发送。", "success");
  }
  if (action === "match-prompt") await handleMatch();
  if (action === "set-practice-mode") {
    navigate(trigger.dataset.value === "corpus" ? "corpus" : "practice");
  }
  if (action === "start-practice") navigate("practice");
  if (action === "new-corpus") navigate("corpus/new");
  if (action === "corpus-dashboard") navigate("corpus");
  if (action === "start-corpus-first-timer") startCorpusFirstCheckIn();
  if (action === "submit-corpus-first") await createCorpusAndEvaluate();
  if (action === "retry-corpus-evaluate") {
    const item = corpusItemById(trigger.dataset.id);
    if (item) await evaluateCorpusFirstAttempt(item);
  }
  if (action === "confirm-corpus-framework") confirmCorpusFramework(trigger.dataset.id);
  if (action === "check-corpus-controlled") await checkCorpusAttempt("controlled");
  if (action === "check-corpus-reused") await checkCorpusAttempt("reused");
  if (action === "reveal-corpus-framework") revealCorpusFramework(trigger.dataset.id);
  if (action === "generate-corpus-prompt") await generateCorpusChinesePrompt(trigger.dataset.id);
  if (action === "check-corpus-usage") await checkCorpusUsage(trigger.dataset.id);
  if (action === "start-corpus-retrieval") startCorpusRetrieval(trigger.dataset.id, trigger.dataset.session);
  if (action === "check-corpus-retrieval") await checkCorpusRetrieval(trigger.dataset.id, trigger.dataset.session);
  if (action === "upgrade-corpus-stage") upgradeCorpusStage(trigger.dataset.id, trigger.dataset.stage);
  if (action === "reset-corpus-stage") resetCorpusStage(trigger.dataset.id);
  if (action === "add-long-term-review") addLongTermCorpusReview(trigger.dataset.id);
  if (action === "rename-corpus") {
    state.ui.renamingCorpusId = trigger.dataset.id;
    render();
  }
  if (action === "cancel-corpus-name") {
    state.ui.renamingCorpusId = "";
    render();
  }
  if (action === "save-corpus-name") {
    const item = corpusItemById(trigger.dataset.id);
    const name = document.querySelector("#corpus-custom-name")?.value.trim() || "";
    if (item && name) {
      item.customName = name;
      item.updatedAt = new Date().toISOString();
      state.ui.renamingCorpusId = "";
      saveData();
      render();
      toast("语料名称已保存。", "success");
    }
  }
  if (action === "filter-corpus") {
    state.ui.corpusFilter = trigger.dataset.value;
    render();
  }
  if (action === "choose-prompt") {
    state.ui.dialog = { type: "choose-prompt" };
    render();
  }
  if (action === "new-prompt") {
    state.ui.dialog = { type: "prompt", promptId: "" };
    render();
  }
  if (action === "edit-prompt") {
    state.ui.dialog = { type: "prompt", promptId: trigger.dataset.id };
    render();
  }
  if (action === "save-prompt") savePromptFromDialog(trigger.dataset.id);
  if (action === "delete-prompt") {
    const prompt = promptById(trigger.dataset.id);
    if (prompt && window.confirm(`删除“${prompt.title}”？历史报告不会被修改。`)) {
      state.data.prompts = state.data.prompts.filter((item) => item.id !== prompt.id);
      saveData();
      render();
      toast("题目已删除。", "success");
    }
  }
  if (action === "import-prompts") {
    state.ui.dialog = { type: "import-prompts" };
    render();
  }
  if (action === "confirm-import-prompts") importPrompts();
  if (action === "export-prompts") exportPromptBank();
  if (action === "use-prompt") usePrompt(trigger.dataset.id);
  if (action === "set-mode") {
    const prompt = activePrompt();
    const text = document.querySelector("#response-text")?.value;
    if (prompt && text) saveDraft(prompt.id, state.ui.mode, text);
    state.ui.mode = trigger.dataset.value === "formal" ? "formal" : "simple";
    render();
  }
  if (action === "start-timer") startTimer();
  if (action === "reset-timer") resetTimer();
  if (action === "submit-response") await handleSubmitResponse();
  if (action === "copy-target" || action === "copy-prompt") {
    const text = action === "copy-target" ? trigger.dataset.text : activePrompt()?.promptText;
    if (text) {
      await navigator.clipboard.writeText(text);
      toast("已复制。", "success");
    }
  }
  if (action === "go-home") navigate("home");
  if (action === "repeat-attempt") {
    const attempt = attemptById(trigger.dataset.id);
    if (attempt) {
      state.ui.mode = attempt.mode;
      state.ui.selectedPromptId = attempt.promptSnapshot?.id;
      navigate("practice");
    }
  }
  if (action === "copy-report") {
    const attempt = attemptById(trigger.dataset.id);
    if (attempt) {
      await navigator.clipboard.writeText(buildReportMarkdown(attempt));
      toast("报告已复制。", "success");
    }
  }
  if (action === "export-report") {
    const attempt = attemptById(trigger.dataset.id);
    if (attempt) {
      downloadText(
        `bandcraft-report-${localDateKey()}.md`,
        buildReportMarkdown(attempt),
        "text/markdown",
      );
    }
  }
  if (action === "start-learning" || action === "generate-learning") {
    await openLearningExtension(trigger.dataset.id);
  }
  if (action === "back-report") navigate(`report/${trigger.dataset.id}`);
  if (action === "check-extraction") checkLearningExtraction(trigger.dataset.id);
  if (action === "check-transfer") checkTransferPractice();
  if (action === "change-learning-section") changeLearningSection(trigger.dataset.id || "");
  if (action === "submit-revision") await submitRevision();
  if (action === "complete-learning") {
    const extension = learningExtensionByAttemptId(state.route.id);
    if (extension) {
      const progress = learningProgress(extension);
      progress.completed = true;
      progress.updatedAt = new Date().toISOString();
      extension.updatedAt = new Date().toISOString();
      saveData();
      render();
      toast("本课学习进度已保存。", "success");
    }
  }
  if (action === "export-history") exportPracticeHistory();
  if (action === "filter-history") {
    state.history.filter = trigger.dataset.value;
    render();
  }
  if (action === "set-history-tab") {
    state.history.tab = trigger.dataset.value === "corpus" ? "corpus" : "writing";
    state.history.query = "";
    render();
  }
  if (action === "filter-bank") {
    state.bank.taskType = trigger.dataset.value;
    render();
  }
  if (action === "choose-backup-file") document.querySelector("#backup-file")?.click();
  if (action === "restore-backup") restoreBackup();
  if (action === "export-backup") exportBackup();
  if (action === "save-deepseek-config") {
    event.preventDefault();
    const form = document.querySelector("#deepseek-config-form");
    if (!form) return;
    const formData = new FormData(form);
    const rawKey = String(formData.get("apiKey") || "").trim();
    const stored = getStoredConfig();
    const nextApiKey = rawKey === "********" ? stored.apiKey : rawKey;
    const next = saveStoredConfig({
      apiKey: nextApiKey,
      baseUrl: String(formData.get("baseUrl") || "").trim(),
      model: String(formData.get("model") || "").trim(),
    });
    refreshServerStatus();
    render();
    toast(next.apiKey ? "DeepSeek 设置已更新。" : "DeepSeek API Key 已清空。", "success");
  }
  if (action === "test-deepseek-config") testDeepSeekConnection();
  if (action === "copy-activation-link") {
    const link = buildActivationUrl();
    if (!link) {
      toast("请先填写并保存 DeepSeek API Key。", "error");
    } else {
      let copied = false;
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {
        copied = false;
      }
      if (copied) toast("激活链接已复制。在别的浏览器或设备打开一次即可自动配置。", "success");
      else window.prompt("复制这条激活链接，在目标设备浏览器打开：", link);
    }
  }
  if (action === "clear-deepseek-config") {
    const { clearStoredConfig } = await import("./deepseek.mjs");
    clearStoredConfig();
    refreshServerStatus();
    render();
    toast("DeepSeek 配置已清除。", "info");
  }
  if (action === "clear-data") {
    if (window.confirm("确定清空全部本地数据？此操作无法撤销。DeepSeek Key 会保留。")) {
      state.data = defaultData();
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key === "bandcraft:deepseek-config:v1") continue;
        if (key?.startsWith("bandcraft:")) localStorage.removeItem(key);
      }
      saveData();
      render();
      toast("本地数据已清空。", "success");
    }
  }
  if (action === "close-dialog") {
    if (event.target === trigger || trigger.classList.contains("icon-button") || trigger.classList.contains("button")) {
      state.ui.dialog = null;
      render();
    }
  }
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches('[data-input="today-vocabulary"]')) {
    const session = ensureTodaySession();
    session.vocabularyRaw = target.value;
    session.updatedAt = new Date().toISOString();
    saveData();
    updateMaterialCounts();
  }
  if (target.matches('[data-input="today-patterns"]')) {
    const session = ensureTodaySession();
    session.patternsRaw = target.value;
    session.updatedAt = new Date().toISOString();
    saveData();
    updateMaterialCounts();
  }
  if (target.matches('[data-input="response"]')) {
    const prompt = activePrompt();
    if (prompt) saveDraft(prompt.id, state.ui.mode, target.value);
    const count = document.querySelector("#word-count");
    if (count) count.textContent = String(wordCount(target.value));
    const progress = document.querySelector(".word-progress");
    const minimum = state.ui.mode === "simple" ? 80 : prompt?.taskType === "task1" ? 150 : 250;
    progress?.classList.toggle("is-ready", wordCount(target.value) >= minimum);
  }
  if (target.matches('[data-input="history-search"]')) {
    state.history.query = target.value;
    const writingList = document.querySelector("#history-list");
    if (writingList) writingList.innerHTML = renderHistoryList(filterAttempts());
    const corpusList = document.querySelector("#corpus-history-list");
    if (corpusList) {
      const query = state.history.query.trim().toLowerCase();
      const items = state.data.corpusItems.filter((item) => {
        const haystack = [item.customName, item.chineseIntent, item.targetExpression, item.standardExpression, ...(item.topicTags || [])]
          .join(" ")
          .toLowerCase();
        return !query || haystack.includes(query);
      });
      corpusList.innerHTML = renderCorpusHistoryList(items);
    }
  }
  if (target.matches('[data-input="bank-search"]')) {
    state.bank.query = target.value;
    const query = state.bank.query.trim().toLowerCase();
    const prompts = state.data.prompts.filter((prompt) => {
      const taskMatch = state.bank.taskType === "all" || prompt.taskType === state.bank.taskType;
      const haystack = [prompt.title, prompt.promptText, prompt.topic, prompt.taskKind, ...(prompt.tags || [])]
        .join(" ")
        .toLowerCase();
      return taskMatch && (!query || haystack.includes(query));
    });
    const list = document.querySelector("#bank-list");
    if (list) list.innerHTML = renderBankList(prompts);
  }
  if (target.matches('[data-input="corpus-search"]')) {
    state.ui.corpusQuery = target.value;
    const list = document.querySelector("#corpus-list");
    if (list) list.innerHTML = renderCorpusList(filterCorpusItems());
  }
  if (target.matches('[data-input="prompt-import-text"]')) {
    state.ui.pendingPromptMarkdown = target.value;
    const preview = parsePromptMarkdown(state.ui.pendingPromptMarkdown);
    const element = document.querySelector("#prompt-import-preview");
    if (element) {
      element.innerHTML = `
        <strong>${preview.length ? `已识别 ${preview.length} 道题目` : "等待 Markdown 内容"}</strong>
        <span>${preview.length
          ? `Task 1 ${preview.filter((prompt) => prompt.taskType === "task1").length} 道 · Task 2 ${preview.filter((prompt) => prompt.taskType === "task2").length} 道`
          : "导入前会检查标题、题型和题目正文。"}</span>
      `;
    }
  }
  if (target.matches('[data-input="learning-answer"]')) {
    const extension = learningExtensionByAttemptId(state.route.id);
    if (extension) {
      const progress = learningProgress(extension);
      progress.answers[target.dataset.id] = target.value;
      progress.updatedAt = new Date().toISOString();
      extension.updatedAt = new Date().toISOString();
      saveData();
    }
  }
  if (target.matches('[data-input="learning-transfer"]')) {
    const extension = learningExtensionByAttemptId(state.route.id);
    if (extension) {
      const progress = learningProgress(extension);
      progress.transferText = target.value;
      progress.updatedAt = new Date().toISOString();
      extension.updatedAt = new Date().toISOString();
      saveData();
      const count = document.querySelector("[data-learning-word-count]");
      if (count) count.textContent = String(wordCount(target.value));
    }
  }
  if (target.matches('[data-input="sentence-revision"]')) {
    const attempt = attemptById(state.route.id);
    if (attempt) {
      const session = ensureRevisionSession(attempt);
      session.sentenceAnswers[target.dataset.id] = target.value;
      session.updatedAt = new Date().toISOString();
      saveData();
    }
  }
  if (target.matches('[data-input="revision-draft"]')) {
    const attempt = attemptById(state.route.id);
    if (attempt) {
      const session = ensureRevisionSession(attempt);
      session.currentText = target.value;
      session.updatedAt = new Date().toISOString();
      saveData();
    }
  }
  if (target.matches('#corpus-chinese, #corpus-target, #corpus-tags, #corpus-level, input[name="corpus-preference"], #corpus-first-attempt')) {
    syncCorpusDraftFromForm();
  }
  if (target.matches('[data-input="backup-mode"]')) {
    state.ui.backupMode = target.value;
  }
});

app.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.matches('[data-input="prompt-file"]')) {
    const file = target.files?.[0];
    if (!file) return;
    state.ui.pendingPromptMarkdown = await file.text();
    render();
  }
  if (target.matches('[data-input="backup-file"]')) {
    const file = target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      state.ui.pendingBackup = normalizeBackup(parsed);
      render();
      toast("备份已读取，请确认导入方式。", "success");
    } catch (error) {
      toast(error.message || "备份文件无效。", "error");
    }
  }
});

window.addEventListener("hashchange", () => {
  state.route = parseRoute();
  state.ui.dialog = null;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

async function init() {
  try {
    const authResult = await initializeAuth();
    state.auth = {
      ...state.auth,
      initialized: true,
      configured: Boolean(authResult.configured),
      required: Boolean(getAuthConfig().authRequired),
      session: authResult.session || null,
      user: authResult.user || null,
      profile: authResult.profile || null,
      error: "",
    };
  } catch (error) {
    state.auth = {
      ...state.auth,
      initialized: true,
      error: error.message || "账号服务加载失败。",
    };
  }
  if (state.auth.session) await syncNow({ renderAfter: false });
  if (!state.auth.required || state.auth.session) await hydratePrompts();
  await refreshServerStatus();
  render();
  window.setInterval(updateCorpusCountdowns, 1000);
  window.setInterval(async () => {
    const before = state.serverStatus?.configured;
    await refreshServerStatus();
    if (before !== state.serverStatus?.configured) render();
  }, 30000);
  window.setInterval(() => syncNow({ renderAfter: false }), 60000);
  if (activation) {
    toast(
      activation.changed
        ? `DeepSeek 已激活（${maskApiKey(activation.apiKey)} · ${activation.model}）。`
        : "DeepSeek 配置已是最新，无需重复激活。",
      "success"
    );
  }
}

init();
