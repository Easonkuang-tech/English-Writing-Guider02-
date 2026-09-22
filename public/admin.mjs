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
  ] = await Promise.all([
    jsonOrThrow(await apiFetch("profiles?select=*&order=created_at.desc")),
    jsonOrThrow(await apiFetch("writing_attempts?select=id,user_id,status,created_at")),
    jsonOrThrow(await apiFetch("corpus_items?select=id,user_id,stage,next_review_at,updated_at")),
    jsonOrThrow(await apiFetch("retrieval_sessions?select=id,user_id,status,timed_out,completed_at")),
    countRows("evaluations", "&status=eq.failed"),
  ]);

  const users = profiles.map((profile) => {
    const userAttempts = writingAttempts.filter((attempt) => attempt.user_id === profile.id);
    const corpus = corpusItems.filter((item) => item.user_id === profile.id);
    return {
      ...profile,
      writingCount: userAttempts.length,
      corpusCount: corpus.length,
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
      writingAttempts: writingAttempts.length,
      corpusItems: corpusItems.length,
      dueReviews: retrievalSessions.filter((session) => session.status === "pending" && new Date(session.due_at || 0) <= new Date()).length,
      timedOutReviews: retrievalSessions.filter((session) => session.timed_out).length,
      aiFailures,
      stageCounts: {
        new: corpusItems.filter((item) => item.stage === "new").length,
        controlled: corpusItems.filter((item) => item.stage === "controlled").length,
        reused: corpusItems.filter((item) => item.stage === "reused").length,
        spontaneous: corpusItems.filter((item) => item.stage === "spontaneous").length,
      },
    },
    users,
  };
}

export async function loadUserDetail(userId) {
  const filter = `user_id=eq.${encodeURIComponent(userId)}`;
  const [profile, attempts, corpus, reviews] = await Promise.all([
    jsonOrThrow(await apiFetch(`profiles?id=eq.${encodeURIComponent(userId)}&select=*`)),
    jsonOrThrow(await apiFetch(`writing_attempts?${filter}&select=*&order=created_at.desc&limit=50`)),
    jsonOrThrow(await apiFetch(`corpus_items?${filter}&select=*&order=updated_at.desc&limit=50`)),
    jsonOrThrow(await apiFetch(`retrieval_sessions?${filter}&select=*&order=created_at.desc&limit=100`)),
  ]);
  return { profile: profile[0] || null, attempts, corpus, reviews };
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
