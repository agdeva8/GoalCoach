import { useEffect, useState } from "react";
import { Image as ImageIcon, Link2, Plus, Trash2, X, Loader2, Camera, ExternalLink } from "lucide-react";
import { api, API } from "../lib/api";

/**
 * Memories — user-pinned photos and Instagram embeds.
 *
 * Two ways to add:
 *   1. Upload a photo: pick a file from disk. The photo goes
 *      through the existing /api/sources/upload pipeline (so the
 *      underlying file lands in the same place all sources do)
 *      and then /api/memories pins that source row as a memory.
 *   2. Paste an Instagram URL: we parse the shortcode, render
 *      the canonical /embed iframe. No scraping of instagram.com
 *      itself — just the public embed endpoint.
 *
 * Display:
 *   - Grid of cards (responsive: 2 cols on mobile, 3 on sm, 4 on lg).
 *   - Photo cards show the image inline (lazy-loaded via the
 *     existing /api/sources/[id]/download flow).
 *   - Instagram cards render the public embed iframe so the user
 *     can scroll/play without leaving the app.
 *   - Each card shows the caption (or a default), date, and the
 *     linked goal title when present. Trash icon deletes (DELETE
 *     /api/memories/[id]).
 *
 * Notes:
 *   - We deliberately do NOT render goal-edit affordances inside a
 *     memory card; goals are managed on the Goals tab. Memories
 *     are a flat timeline.
 *   - The "Add" button opens an inline form with two tabs (Photo
 *     | Instagram). Switching the tab resets the inputs so the
 *     user doesn't accidentally submit the wrong kind.
 */
export default function Memories({ state, onChange }) {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState("photo")
  const [file, setFile] = useState(null)
  const [url, setUrl] = useState("")
  const [caption, setCaption] = useState("")
  const [goalId, setGoalId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")

  const refresh = () => {
    setLoading(true)
    api
      .memories()
      .then((d) => setMemories(d.memories || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  const submitPhoto = async () => {
    if (!file) return
    setSubmitting(true)
    setSubmitError("")
    try {
      // Step 1: upload the file through the existing sources pipeline
      // so the bytes land in the same storage bucket as everything
      // else, and we get a `source_id` back.
      const source = await api.uploadSource(file, goalId || "")
      // Step 2: pin that source as a memory.
      await api.createMemory({
        kind: "photo",
        source_id: source.id,
        caption,
        goal_id: goalId || "",
      })
      setFile(null)
      setCaption("")
      setGoalId("")
      setAdding(false)
      refresh()
      onChange?.()
    } catch (e) {
      setSubmitError(e?.message || "Could not save photo memory")
    } finally {
      setSubmitting(false)
    }
  }

  const submitInstagram = async () => {
    if (!url.trim()) return
    setSubmitting(true)
    setSubmitError("")
    try {
      await api.createMemory({
        kind: "instagram",
        external_url: url.trim(),
        caption,
        goal_id: goalId || "",
      })
      setUrl("")
      setCaption("")
      setGoalId("")
      setAdding(false)
      refresh()
      onChange?.()
    } catch (e) {
      setSubmitError(e?.message || "Could not save Instagram memory")
    } finally {
      setSubmitting(false)
    }
  }

  const deleteMemory = async (id) => {
    try {
      await api.deleteMemory(id)
      setMemories((prev) => prev.filter((m) => m.id !== id))
      onChange?.()
    } catch {
      /* ignore */
    }
  }

  const goals = (state?.goals || []).filter((g) => g.status !== "dropped")

  return (
    <div data-testid="memories-view" className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-tight">Memories</h2>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            Photos and posts that anchor your goals — what's the why, what does it look like?
          </p>
        </div>
        {!adding && (
          <button
            data-testid="memories-add-button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-3 h-8 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" /> Add memory
          </button>
        )}
      </div>

      {adding && (
        <div
          data-testid="memories-add-form"
          className="border border-[var(--border)] bg-[var(--bg-secondary)]/60 rounded-lg p-4 space-y-3"
        >
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--bg-secondary)]/40 p-0.5">
              <button
                data-testid="memories-kind-photo"
                onClick={() => setKind("photo")}
                className={`px-3 h-7 text-[11px] font-mono uppercase tracking-widest transition-colors flex items-center gap-1 rounded ${
                  kind === "photo"
                    ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
                }`}
              >
                <Camera className="w-3 h-3" /> Photo
              </button>
              <button
                data-testid="memories-kind-instagram"
                onClick={() => setKind("instagram")}
                className={`px-3 h-7 text-[11px] font-mono uppercase tracking-widest transition-colors flex items-center gap-1 rounded ${
                  kind === "instagram"
                    ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
                }`}
              >
                <Link2 className="w-3 h-3" /> Instagram
              </button>
            </div>
          </div>

          {kind === "photo" ? (
            <div>
              <input
                data-testid="memories-file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-[var(--text-secondary)] file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-[var(--accent)] file:text-[var(--bg-primary)] file:text-xs file:font-medium hover:file:opacity-90 file:cursor-pointer"
              />
              {file && (
                <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                  {file.name} · {Math.round(file.size / 1024)} KB
                </div>
              )}
            </div>
          ) : (
            <input
              data-testid="memories-url-input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.instagram.com/p/{shortcode}/"
              className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)]"
            />
          )}

          <input
            data-testid="memories-caption-input"
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption (optional)"
            maxLength={200}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)]"
          />

          <select
            data-testid="memories-goal-select"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-accent)]"
          >
            <option value="">No goal linkage</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>

          {submitError && (
            <div className="text-xs text-[var(--danger)]">{submitError}</div>
          )}

          <div className="flex items-center gap-2 justify-end pt-1">
            <button
              type="button"
              data-testid="memories-cancel"
              onClick={() => {
                setAdding(false)
                setFile(null)
                setUrl("")
                setCaption("")
                setGoalId("")
                setSubmitError("")
              }}
              className="text-xs px-3 py-1.5 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="memories-save"
              onClick={kind === "photo" ? submitPhoto : submitInstagram}
              disabled={submitting || (kind === "photo" ? !file : !url.trim())}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-[var(--bg-primary)] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              Save memory
            </button>
          </div>
        </div>
      )}

      {loading && memories.length === 0 && (
        <div className="text-xs text-[var(--text-muted)]">loading…</div>
      )}

      {!loading && memories.length === 0 && !adding && (
        <div className="border border-dashed border-[var(--border)] rounded-lg p-8 sm:p-12 text-center bg-[var(--bg-secondary)]/40">
          <ImageIcon className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-sm mx-auto">
            Pin the things that make goals real — a photo of where you want to be, the post
            that got you started.
          </p>
        </div>
      )}

      <div
        data-testid="memories-grid"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
      >
        {memories.map((m) => (
          <MemoryCard key={m.id} memory={m} onDelete={() => deleteMemory(m.id)} />
        ))}
      </div>
    </div>
  )
}

function MemoryCard({ memory, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false)
  return (
    <div
      data-testid={`memory-card-${memory.id}`}
      className="border border-[var(--border)] bg-[var(--bg-secondary)]/60 rounded-lg overflow-hidden group"
    >
      <div className="aspect-square bg-[var(--bg-tertiary)] relative overflow-hidden">
        {memory.kind === "photo" && memory.source_id ? (
          <img
            src={`${API}/sources/${memory.source_id}/download`}
            alt={memory.caption || "Memory"}
            className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : memory.kind === "instagram" && memory.instagram_shortcode ? (
          <InstagramEmbed shortcode={memory.instagram_shortcode} caption={memory.caption} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
            <ImageIcon className="w-8 h-8" />
          </div>
        )}
        <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!confirmDel ? (
            <button
              type="button"
              data-testid={`memory-delete-trigger-${memory.id}`}
              onClick={() => setConfirmDel(true)}
              className="h-6 w-6 flex items-center justify-center rounded bg-black/60 text-white hover:bg-black/80"
              title="Delete"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          ) : (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-black/80 text-[11px]">
              <span className="text-white">Delete?</span>
              <button
                type="button"
                data-testid={`memory-delete-confirm-${memory.id}`}
                onClick={onDelete}
                className="h-5 px-1.5 rounded bg-[var(--danger)] text-white hover:opacity-90"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="h-5 px-1.5 rounded border border-white/30 text-white/80 hover:text-white"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="p-2.5 space-y-1">
        {memory.caption && (
          <div className="text-xs text-[var(--text-primary)] leading-snug line-clamp-2">
            {memory.caption}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
          <span>
            {new Date(memory.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
          {memory.goal_title && (
            <>
              <span className="opacity-50">·</span>
              <a
                href="#goals"
                onClick={(e) => e.preventDefault()}
                className="truncate hover:text-[var(--accent)] transition-colors"
                title={`Linked to ${memory.goal_title}`}
              >
                {memory.goal_title}
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function InstagramEmbed({ shortcode, caption }) {
  const src = `https://www.instagram.com/p/${shortcode}/embed`
  return (
    <iframe
      title={caption || `Instagram post ${shortcode}`}
      src={src}
      className="w-full h-full bg-[var(--bg-primary)]"
      allowTransparency="true"
      scrolling="no"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  )
}
