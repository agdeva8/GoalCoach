import { withTimeout, TimeoutError } from "./fetch-with-timeout";

export { TimeoutError };

// `frontend/.env` is gitignored, so a Vercel git build has this unset. It must
// fall back to "" (relative `/api` on this origin), otherwise the template
// produces the literal URL "undefined/api" and every request 404s. Only set a
// full URL when the API genuinely lives on another origin (local dev).
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const API = `${BACKEND_URL}/api`;

const DEFAULT_TIMEOUT_MS = 30000;

async function req(path, opts = {}) {
  const { quiet, timeout = DEFAULT_TIMEOUT_MS, ...fetchOpts } = opts;
  const controller = new AbortController();
  const signal = fetchOpts.signal || controller.signal;

  const res = await withTimeout(
    fetch(`${API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(fetchOpts.headers || {}) },
      ...fetchOpts,
      signal,
    }),
    timeout,
    `API ${path}`,
    { controller, signal },
  );

  // `quiet: true` swallows the error so callers can branch on a
  // null/defined return instead of catching. Used by the auth probe
  // so cold-start 401s don't show up as console noise on every page
  // load when the user isn't signed in.
  if (!res.ok) {
    if (quiet && res.status >= 400 && res.status < 500) {
      return null;
    }
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export const api = {
  me: () => req("/auth/me", { quiet: true }),
  guest: () => req("/auth/guest", { method: "POST" }),
  session: (session_id) => req("/auth/session", { method: "POST", body: JSON.stringify({ session_id }) }),
  logout: () => req("/auth/logout", { method: "POST" }),
  setProvider: (model_provider) => req("/preferences", { method: "PUT", body: JSON.stringify({ model_provider }) }),
  models: () => req("/preferences/models"),
  state: () => req("/state"),
  history: () => req("/chat/history"),
  clearHistory: () => req("/chat/history", { method: "DELETE" }),
  audit: () => req("/audit"),
  confirm: (message_id, proposal_id) =>
    req("/tools/confirm", { method: "POST", body: JSON.stringify({ message_id, proposal_id }) }),
  reject: (message_id, proposal_id) =>
    req("/tools/reject", { method: "POST", body: JSON.stringify({ message_id, proposal_id }) }),
  // Blockers (direct edit)
  blockers: () => req("/blockers"),
  createBlocker: (b) => req("/blockers", { method: "POST", body: JSON.stringify(b) }),
  updateBlocker: (id, b) => req(`/blockers/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteBlocker: (id) => req(`/blockers/${id}`, { method: "DELETE" }),
  // Commitments (direct edit)
  commitments: () => req("/commitments"),
  createCommitment: (c) => req("/commitments", { method: "POST", body: JSON.stringify(c) }),
  updateCommitment: (id, c) => req(`/commitments/${id}`, { method: "PATCH", body: JSON.stringify(c) }),
  // Sources
  sources: () => req("/sources"),
  addLink: (body) => req("/sources/link", { method: "POST", body: JSON.stringify(body) }),
  previewLink: (url) => req("/sources/link/preview", { method: "POST", body: JSON.stringify({ url }) }),
  deleteSource: (id) => req(`/sources/${id}`, { method: "DELETE" }),
  uploadSource: async (file, goalId = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("goal_id", goalId);
    const controller = new AbortController();
    const res = await withTimeout(
      fetch(`${API}/sources/upload`, {
        method: "POST",
        credentials: "include",
        body: fd,
        signal: controller.signal,
      }),
      DEFAULT_TIMEOUT_MS,
      "API /sources/upload",
      { controller },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Upload failed");
    }
    return res.json();
  },
  // Memories
  memories: () => req("/memories"),
  createMemory: (body) => req("/memories", { method: "POST", body: JSON.stringify(body) }),
  deleteMemory: (id) => req(`/memories/${id}`, { method: "DELETE" }),
  // Motivation
  motivation: () => req("/motivation/recommend"),
};

export function exportUrl() {
  return `${API}/audit/export`;
}

export function sourceDownloadUrl(id) {
  return `${API}/sources/${id}/download`;
}
