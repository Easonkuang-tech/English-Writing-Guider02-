const SESSION_KEY = "bandcraft:supabase-session:v1";

let publicConfig = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  appOrigin: "",
  authRequired: false,
};

function readStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (session?.access_token) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function captureSessionFromUrl() {
  const raw = `${location.hash || ""}&${location.search.replace(/^\?/, "")}`.replace(/^#/, "");
  if (!raw.includes("access_token=")) return null;
  const params = new URLSearchParams(raw);
  const session = {
    access_token: params.get("access_token") || "",
    refresh_token: params.get("refresh_token") || "",
    expires_in: Number(params.get("expires_in")) || 3600,
    expires_at: Math.floor(Date.now() / 1000) + (Number(params.get("expires_in")) || 3600),
    token_type: params.get("token_type") || "bearer",
  };
  if (!session.access_token) return null;
  saveSession(session);
  const route = params.get("bc_route") || "/home";
  history.replaceState(null, "", `${location.pathname}#/${route.replace(/^\//, "")}`);
  return session;
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.msg || payload.message || payload.error_description || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function initializeAuth() {
  const response = await fetch("/api/public-config");
  publicConfig = await parseResponse(response);
  captureSessionFromUrl();
  if (!publicConfig.authRequired) return { configured: false, session: null, user: null, profile: null };

  let session = readStoredSession();
  if (!session?.access_token) return { configured: true, session: null, user: null, profile: null };

  if (session.refresh_token && session.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 30) {
    session = await refreshSession(session.refresh_token).catch(() => null);
  }
  if (!session?.access_token) return { configured: true, session: null, user: null, profile: null };

  const user = await getCurrentUser(session.access_token).catch(() => null);
  if (!user) {
    saveSession(null);
    return { configured: true, session: null, user: null, profile: null };
  }
  const profile = await getProfile(user.id, session.access_token).catch(() => null);
  return { configured: true, session, user, profile };
}

export function getAuthConfig() {
  return publicConfig;
}

export function getSession() {
  return readStoredSession();
}

async function authRequest(path, options = {}) {
  if (!publicConfig.supabaseUrl || !publicConfig.supabaseAnonKey) {
    throw new Error("Supabase 尚未配置。");
  }
  const response = await fetch(`${publicConfig.supabaseUrl}/auth/v1/${path}`, {
    ...options,
    headers: {
      apikey: publicConfig.supabaseAnonKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return parseResponse(response);
}

export async function signInWithPassword(email, password) {
  const session = await authRequest("token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  saveSession(session);
  const user = await getCurrentUser(session.access_token);
  const profile = await getProfile(user.id, session.access_token).catch(() => null);
  return { session, user, profile };
}

export async function signUpWithPassword(email, password, displayName = "") {
  const result = await authRequest("signup", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      data: { display_name: displayName },
    }),
  });
  if (result.access_token) saveSession(result);
  return result;
}

export async function sendMagicLink(email) {
  return authRequest("otp", {
    method: "POST",
    body: JSON.stringify({
      email,
      create_user: true,
      options: {
        email_redirect_to: publicConfig.appOrigin || location.origin,
      },
    }),
  });
}

async function refreshSession(refreshToken) {
  const session = await authRequest("token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  saveSession(session);
  return session;
}

export async function getCurrentUser(accessToken = readStoredSession()?.access_token) {
  if (!accessToken) return null;
  return authRequest("user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getProfile(userId, accessToken = readStoredSession()?.access_token) {
  if (!userId || !accessToken) return null;
  const response = await fetch(
    `${publicConfig.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
    {
      headers: {
        apikey: publicConfig.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const rows = await parseResponse(response);
  return rows[0] || null;
}

export async function signOut() {
  const session = readStoredSession();
  if (session?.access_token) {
    await authRequest("logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => null);
  }
  saveSession(null);
}

export async function apiFetch(path, options = {}) {
  const session = readStoredSession();
  const response = await fetch(`${publicConfig.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: publicConfig.supabaseAnonKey,
      Authorization: `Bearer ${session?.access_token || publicConfig.supabaseAnonKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return response;
}
