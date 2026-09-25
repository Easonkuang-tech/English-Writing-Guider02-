import { apiFetch } from "./auth.mjs";

const DEVICE_KEY = "bandcraft:device-id:v1";

function deviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

export function ensureSyncMeta(data) {
  const current = data._sync && typeof data._sync === "object" ? data._sync : {};
  data._sync = {
    deviceId: current.deviceId || deviceId(),
    version: Number(current.version) || 0,
    updatedAt: current.updatedAt || new Date(0).toISOString(),
    lastSyncedAt: current.lastSyncedAt || null,
  };
  return data._sync;
}

async function fetchCloudRow(userId) {
  const response = await apiFetch(
    `user_settings?user_id=eq.${encodeURIComponent(userId)}&select=user_id,payload,version,updated_at`,
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "无法读取云端数据。");
  return rows[0] || null;
}

export async function pullCloudState(userId) {
  const row = await fetchCloudRow(userId);
  if (!row) return null;
  ensureSyncMeta(row.payload);
  return {
    data: row.payload,
    version: Number(row.version) || 1,
    updatedAt: row.updated_at,
  };
}

export async function pushCloudState(userId, data) {
  const sync = ensureSyncMeta(data);
  const version = Math.max(Number(sync.version) || 0, 1);
  const response = await apiFetch("user_settings?on_conflict=user_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      user_id: userId,
      payload: data,
      version,
      updated_at: new Date().toISOString(),
    }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "无法保存云端数据。");
  sync.lastSyncedAt = new Date().toISOString();
  return rows[0] || null;
}

export async function reconcileCloudState(userId, localData) {
  const localSync = ensureSyncMeta(localData);
  const remote = await pullCloudState(userId);

  if (!remote) {
    await pushCloudState(userId, localData);
    return { action: "uploaded", data: localData };
  }

  const localTime = new Date(localSync.updatedAt || 0).getTime();
  const remoteTime = new Date(remote.data?._sync?.updatedAt || remote.updatedAt || 0).getTime();

  if (remoteTime > localTime) {
    return { action: "downloaded", data: remote.data };
  }

  if (localTime > remoteTime) {
    await pushCloudState(userId, localData);
    return { action: "uploaded", data: localData };
  }

  localSync.lastSyncedAt = new Date().toISOString();
  return { action: "unchanged", data: localData };
}
