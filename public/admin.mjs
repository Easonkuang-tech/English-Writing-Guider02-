import { apiFetch, sendMagicLink } from "./auth.mjs";

async function jsonOrThrow(response) {
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(payload.message || payload.hint || `后台请求失败（${response.status}）`);
  }
  return payload;
}

async function countRows(table, filter = "") {
  const response = await apiFetch(`${table}?select=id${filter}`, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
  if (!response.ok) throw new Error(`无法统计 ${table}。`);
  const range = response.headers.get("content-range") || "*/0";
  return Number(range.split("/").pop()) || 0;
}

export async function loadAdminDashboard() {
  const [
    profiles,
    writingAttempts,
    corpusItems,
    retrievalSessions,
    aiFailures,
    settingsRows,
  ] = await Promise.all([
    jsonOrThrow(await apiFetch("profiles?select=*&order=created_at.desc")),
    jsonOrThrow(await apiFetch("writing_attempts?select=id,user_id,status,created_at")),
    jsonOrThrow(await apiFetch("corpus_items?select=id,user_id,stage,next_review_at,updated_at")),
    jsonOrThrow(await apiFetch("retrieval_sessions?select=id,user_id,status,timed_out,completed_at")),
    countRows("evaluations", "&status=eq.failed"),
    jsonOrThrow(await apiFetch("user_settings?select=user_id,payload,version,updated_at")),
  ]);

  const users = profiles.map((profile) => {
    const settings = settingsRows.find((row) => row.user_id === profile.id);
    const payload = settings?.payload || {};
    const userAttempts = Array.isArray(payload.attempts)
      ? payload.attempts
      : writingAttempts.filter((attempt) => attempt.user_id === profile.id);
    const corpus = Array.isArray(payload.corpusItems)
      ? payload.corpusItems
      : corpusItems.filter((item) => item.user_id === profile.id);
    const reviews = corpus.flatMap((item) => [
      ...(item.learningPlan?.sameDayTests || []),
      ...(item.learningPlan?.scheduledReviews || []),
    ]);
    return {
      ...profile,
      writingCount: userAttempts.length,
      corpusCount: corpus.length,
      cloudVersion: settings?.version || 0,
      lastCloudSync: settings?.updated_at || null,
      reviewCount: reviews.length,
      dueReviewCount: reviews.filter((review) => review.status === "pending" && new Date(review.dueAt || 0) <= new Date()).length,
      timedOutReviewCount: reviews.filter((review) => review.timedOut).length,
      stageCounts: {
        new: corpus.filter((item) => item.stage === "new").length,
        controlled: corpus.filter((item) => item.stage === "controlled").length,
        reused: corpus.filter((item) => item.stage === "reused").length,
        spontaneous: corpus.filter((item) => item.stage === "spontaneous").length,
      },
    };
  });

  return {
    metrics: {
      users: profiles.length,
      activeUsers: profiles.filter((profile) => profile.status === "active").length,
      writingAttempts: users.reduce((sum, user) => sum + user.writingCount, 0),
      corpusItems: users.reduce((sum, user) => sum + user.corpusCount, 0),
      dueReviews: users.reduce((sum, user) => sum + (user.dueReviewCount || 0), 0),
      timedOutReviews: users.reduce((sum, user) => sum + (user.timedOutReviewCount || 0), 0),
      aiFailures,
      stageCounts: {
        new: users.reduce((sum, user) => sum + user.stageCounts.new, 0),
        controlled: users.reduce((sum, user) => sum + user.stageCounts.controlled, 0),
        reused: users.reduce((sum, user) => sum + user.stageCounts.reused, 0),
        spontaneous: users.reduce((sum, user) => sum + user.stageCounts.spontaneous, 0),
      },
    },
    users,
  };
}

export async function loadUserDetail(userId) {
  const filter = `user_id=eq.${encodeURIComponent(userId)}`;
  const [profile, settings] = await Promise.all([
    jsonOrThrow(await apiFetch(`profiles?id=eq.${encodeURIComponent(userId)}&select=*`)),
    jsonOrThrow(await apiFetch(`user_settings?user_id=eq.${encodeURIComponent(userId)}&select=payload,version,updated_at`)),
  ]);
  const payload = settings[0]?.payload || {};
  const attempts = Array.isArray(payload.attempts) ? payload.attempts : [];
  const corpus = Array.isArray(payload.corpusItems) ? payload.corpusItems : [];
  const reviews = corpus.flatMap((item) => [
    ...(item.learningPlan?.sameDayTests || []),
    ...(item.learningPlan?.scheduledReviews || []),
  ]);
  return {
    profile: profile[0] || null,
    cloudVersion: settings[0]?.version || 0,
    lastCloudSync: settings[0]?.updated_at || null,
    attempts,
    corpus,
    reviews,
  };
}

export async function setUserStatus(userId, status) {
  const response = await apiFetch(`profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
    headers: { Prefer: "return=representation" },
  });
  return jsonOrThrow(response);
}

export async function resendLoginEmail(email) {
  return sendMagicLink(email);
}
