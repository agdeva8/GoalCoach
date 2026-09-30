import { useEffect, useState } from "react";
import {
  FileText,
  Link2,
  Trash2,
  ExternalLink,
  Loader2,
  FolderOpen,
  RefreshCw,
  Eye,
  Download,
} from "lucide-react";
import { api, API } from "../lib/api";

/**
 * Sources — all uploaded files and pasted links the coach reasons over.
 *
 * Sources are reference material attached to goals (or kept general).
 * This tab gives a flat grid view: kind icon, name/title, date, linked
 * goal, and actions (view / download / delete).
 *
 * Kind 'file': download from /api/sources/:id/download
 * Kind 'link': open external_url in a new tab
 * Delete: DELETE /api/sources/:id
 */
export default function Sources({ state, onChange }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null); // id of source being deleted

  const refresh = () => {
    setLoading(true);
    setError(null);
    api
      .sources()
      .then((d) => setSources(Array.isArray(d) ? d : d?.sources || []))
      .catch((err) => {
        console.error("Failed to load sources:", err);
        setError(err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const deleteSource = async (id) => {
    setDeleting(id);
    try {
      await api.deleteSource(id);
      setSources((prev) => prev.filter((s) => s.id !== id));
      onChange?.();
    } catch {
      setDeleting(null);
    }
  };

  const goals = state?.goals || [];
  const goalTitle = (goalId) => {
    if (!goalId) return null;
    return goals.find((g) => g.id === goalId)?.title || null;
  };

  return (
    <div data-testid="sources-view" className="space-y-4">
      <div>
        <h2 className="font-display text-sm font-semibold tracking-tight">Sources</h2>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
          Material you attach to a goal so the coach can work out where it starts and ends. The
          coach reads these to confirm the goal&apos;s boundary — not your memories.
        </p>
      </div>

      {loading && sources.length === 0 && (
        <div
          data-testid="sources-skeleton"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
          aria-busy="true"
          aria-live="polite"
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="border border-[var(--border)] bg-[var(--bg-secondary)]/60 rounded-lg p-3 space-y-2.5"
            >
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded gc-skeleton shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="h-3 w-4/5 gc-skeleton" />
                  <div className="h-2.5 w-1/3 gc-skeleton" />
                </div>
              </div>
              <div className="h-2.5 w-1/2 gc-skeleton pt-1" />
            </div>
          ))}
        </div>
      )}

      {loading && sources.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          refreshing…
        </div>
      )}

      {!loading && error && (
        <div className="border border-[var(--border)] rounded-lg p-6 text-center space-y-3 bg-[var(--bg-secondary)]/40" data-testid="sources-error">
          <p className="text-xs text-[var(--text-secondary)]">Couldn't load sources</p>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-[var(--bg-primary)] font-medium hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="w-3 h-3" />
            Couldn't load — retry
          </button>
        </div>
      )}

      {!loading && !error && sources.length === 0 && (
        <div className="border border-dashed border-[var(--border)] rounded-lg p-8 sm:p-12 text-center bg-[var(--bg-secondary)]/40">
          <FolderOpen className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-sm mx-auto">
            No sources yet. Attach files or paste links when adding a goal — the coach
            will read them and reason from the ground up.
          </p>
        </div>
      )}

      {sources.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sources.map((s) => (
            <SourceCard
              key={s.id}
              source={s}
              goalTitle={goalTitle(s.goal_id)}
              onDelete={() => deleteSource(s.id)}
              deleting={deleting === s.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceCard({ source, goalTitle, onDelete, deleting }) {
  const isFile = source.kind === "file";
  const isLink = source.kind === "link";

  /* Files are stored with `original_filename`; `name` only exists on link
     sources. Reading `name` first meant every uploaded file rendered as
     "Untitled file" even though the API had the name the whole time. */
  const displayName =
    (isFile ? source.original_filename : source.name) ||
    source.name ||
    (isLink ? source.url : "Untitled file");

  const displayDate = source.created_at
    ? new Date(source.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const downloadUrl = isFile ? `${API}/sources/${source.id}/download` : null;

  return (
    <div
      data-testid={`source-card-${source.id}`}
      className="border border-[var(--border)] bg-[var(--bg-secondary)]/60 rounded-lg p-3 space-y-2 group"
    >
      {/* Header row: kind icon + name */}
      <div className="flex items-start gap-2.5">
        <div
          className={`w-8 h-8 rounded flex items-center justify-center shrink-0 mt-0.5 ${
            isFile
              ? "bg-[var(--accent)]/10 text-[var(--accent)]"
              : "bg-[var(--warning)]/10 text-[var(--warning)]"
          }`}
        >
          {isFile ? (
            <FileText className="w-4 h-4" />
          ) : (
            <Link2 className="w-4 h-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)] leading-snug line-clamp-2 break-all">
            {displayName}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`inline-flex items-center font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded ${
                isFile
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "bg-[var(--warning)]/10 text-[var(--warning)]"
              }`}
            >
              {source.kind}
            </span>
            {displayDate && (
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {displayDate}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Goal linkage — sources exist to define a goal's boundary, so an
          unlinked source should say so rather than showing nothing. */}
      {goalTitle ? (
        <div className="text-[11px] text-[var(--text-secondary)] pl-0.5">
          <span className="text-[var(--text-muted)] font-mono uppercase tracking-widest text-[9px]">goal</span>{" "}
          {goalTitle}
        </div>
      ) : (
        <div className="text-[11px] text-[var(--text-muted)] pl-0.5">
          <span className="font-mono uppercase tracking-widest text-[9px]">not linked</span>{" "}
          — attach it to a goal so the coach can set that goal&apos;s boundary
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-2 pt-1">
        {isLink && source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Open link
          </a>
        )}
        {isFile && downloadUrl && (
          <>
            {/* View opens the stored file inline in a new tab (the browser
                renders images and PDFs natively). Download saves it with
                the original filename via the same endpoint's
                Content-Disposition header. */}
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`source-view-${source.id}`}
              className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
            >
              <Eye className="w-3 h-3" />
              View file
            </a>
            <a
              href={downloadUrl}
              download
              data-testid={`source-download-${source.id}`}
              className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
            >
              <Download className="w-3 h-3" />
              Download
            </a>
          </>
        )}
        <button
          onClick={onDelete}
          disabled={deleting}
          className={`ml-auto flex items-center gap-1 text-[11px] transition-colors ${
            deleting
              ? "text-[var(--text-muted)]"
              : "text-[var(--text-muted)] hover:text-[var(--danger)]"
          }`}
          title="Delete source"
        >
          {deleting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Trash2 className="w-3 h-3" />
          )}
          Delete
        </button>
      </div>
    </div>
  );
}
