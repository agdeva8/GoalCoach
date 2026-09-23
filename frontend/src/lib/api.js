const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

async function req(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export const api = {
  me: () => req("/auth/me"),
  session: (session_id) => req("/auth/session", { method: "POST", body: JSON.stringify({ session_id }) }),
  logout: () => req("/auth/logout", { method: "POST" }),
  setProvider: (model_provider) => req("/preferences", { method: "PUT", body: JSON.stringify({ model_provider }) }),
  state: () => req("/state"),
  history: () => req("/chat/history"),
  audit: () => req("/audit"),
  confirm: (message_id, proposal_id) =>
    req("/tools/confirm", { method: "POST", body: JSON.stringify({ message_id, proposal_id }) }),
  reject: (message_id, proposal_id) =>
    req("/tools/reject", { method: "POST", body: JSON.stringify({ message_id, proposal_id }) }),
};

export function exportUrl() {
  return `${API}/audit/export`;
}
