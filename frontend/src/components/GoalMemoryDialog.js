import { useRef, useState } from "react";
import { Camera, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import CenteredDialog from "./CenteredDialog";
import { api } from "../lib/api";

/**
 * GoalMemoryDialog — add a memory (photo or Instagram URL) attached to
 * a specific goal. Lives in the goal card action row so the user can
 * anchor a memory without navigating to the Memories tab.
 *
 * Two tabs mirror the Memories tab's add form: Photo (file upload
 * through the existing source pipeline) and Instagram (URL with shape
 * validation). Saves call `onSaved` so the parent can refresh state.
 */
export default function GoalMemoryDialog({ open, onClose, goalId, goalTitle, onSaved }) {
  const [kind, setKind] = useState("photo");
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const fileRef = useRef(null);

  const reset = () => {
    setKind("photo");
    setFile(null);
    setUrl("");
    setCaption("");
    setSubmitting(false);
    setSubmitError("");
  };

  const close = () => {
    reset();
    onClose?.();
  };

  const submitPhoto = async () => {
    if (!file) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      // Re-use the sources pipeline so the bytes land in the same
      // storage bucket as everything else.
      const source = await api.uploadSource(file, goalId || "");
      await api.createMemory({
        kind: "photo",
        source_id: source.id,
        caption,
        goal_id: goalId || "",
      });
      toast.success("Memory attached to goal");
      onSaved?.();
      close();
    } catch (e) {
      setSubmitError(e?.message || "Could not save photo memory");
    } finally {
      setSubmitting(false);
    }
  };

  const submitInstagram = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?/.test(trimmed)) {
      setSubmitError("That doesn't look like an Instagram post URL — paste a link like instagram.com/p/...");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      await api.createMemory({
        kind: "instagram",
        external_url: trimmed,
        caption,
        goal_id: goalId || "",
      });
      toast.success("Memory attached to goal");
      onSaved?.();
      close();
    } catch (e) {
      setSubmitError(e?.message || "Could not save Instagram memory");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => (kind === "photo" ? submitPhoto() : submitInstagram());

  const canSubmit = submitting
    ? false
    : kind === "photo"
    ? !!file
    : !!url.trim();

  return (
    <CenteredDialog
      open={open}
      onClose={close}
      testId="goal-memory-dialog"
      icon={Camera}
      title={goalTitle ? `Add memory · ${goalTitle}` : "Add memory to this goal"}
      subtitle="A photo or post that anchors what this goal really means."
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        {/* Kind tabs */}
        <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--bg-secondary)]/40 p-0.5">
          <button
            type="button"
            data-testid="goal-memory-kind-photo"
            onClick={() => { setKind("photo"); setSubmitError(""); }}
            className={`px-3 h-8 text-[11px] font-mono uppercase tracking-widest transition-colors flex items-center gap-1.5 rounded ${
              kind === "photo"
                ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
            }`}
          >
            <Camera className="w-3.5 h-3.5" aria-hidden="true" /> Photo
          </button>
          <button
            type="button"
            data-testid="goal-memory-kind-instagram"
            onClick={() => { setKind("instagram"); setSubmitError(""); }}
            className={`px-3 h-8 text-[11px] font-mono uppercase tracking-widest transition-colors flex items-center gap-1.5 rounded ${
              kind === "instagram"
                ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
            }`}
          >
            <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Instagram
          </button>
        </div>

        {/* Inputs */}
        {kind === "photo" ? (
          <div>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setSubmitError(""); }}
              data-testid="goal-memory-file-input"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              data-testid="goal-memory-file-button"
              className="w-full flex items-center justify-center gap-2 h-11 border border-dashed border-[var(--border)] hover:border-[var(--border-accent)] text-sm text-[var(--text-secondary)] rounded transition-colors"
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              {file ? file.name : "Choose a photo"}
            </button>
          </div>
        ) : (
          <div>
            <label htmlFor="goal-memory-instagram-url" className="block text-[11px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
              Instagram URL
            </label>
            <input
              id="goal-memory-instagram-url"
              data-testid="goal-memory-instagram-input"
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setSubmitError(""); }}
              placeholder="https://www.instagram.com/p/..."
              className="w-full h-11 bg-[var(--bg-primary)] border border-[var(--border)] rounded px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)]"
            />
          </div>
        )}

        {/* Caption */}
        <div>
          <label htmlFor="goal-memory-caption" className="block text-[11px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
            Why this memory matters <span className="opacity-60">(optional)</span>
          </label>
          <textarea
            id="goal-memory-caption"
            data-testid="goal-memory-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            placeholder="What's the why behind this memory?"
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)] resize-none"
          />
        </div>

        {/* Error */}
        {submitError && (
          <p
            data-testid="goal-memory-error"
            className="text-xs text-[var(--danger)] leading-relaxed"
            role="alert"
          >
            {submitError}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            data-testid="goal-memory-cancel"
            className="h-10 px-4 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="goal-memory-save"
            className="h-10 flex items-center gap-2 px-4 rounded bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-xs disabled:opacity-40 hover:opacity-90 active:scale-[0.98] transition-[opacity,transform] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {submitting ? "Saving…" : "Attach memory"}
          </button>
        </div>
      </div>
    </CenteredDialog>
  );
}
