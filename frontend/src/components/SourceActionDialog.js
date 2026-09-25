import { useEffect, useRef, useState } from "react";
import { Paperclip, Link2, Trash2, Send } from "lucide-react";
import CenteredDialog from "./CenteredDialog";

/**
 * SourceActionDialog — single dialog surface for every source mutation
 * (upload file, add link, delete). Each mode opens via the same
 * CenteredDialog shell so the warm theme and dismissal ergonomics match
 * the rest of the app. The parent decides which mode to open via the
 * `mode` prop and supplies the matching submit handler.
 *
 * Props:
 *   open       — controlled visibility
 *   onClose    — close handler
 *   mode       — "upload" | "link" | "delete"
 *   source     — for delete mode, the {id, original_filename} object
 *   onUploadFile — (file, goalId) => Promise for upload mode
 *   onAddLink    — (url, goalId) => Promise for link mode
 *   onDeleteSource — (id) => Promise for delete mode
 *   goalId    — optional goalId to scope the source to a specific goal
 *   goalTitle — optional title used to make the dialog copy goal-aware
 */
export default function SourceActionDialog({
  open,
  onClose,
  mode = "upload",
  source = null,
  onUploadFile = async () => {},
  onAddLink = async () => {},
  onDeleteSource = async () => {},
  goalId = "",
  goalTitle = "",
}) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setError("");
      setSubmitting(false);
    }
  }, [open]);

  const submitUpload = async (file) => {
    setError("");
    setSubmitting(true);
    try {
      await onUploadFile(file, goalId);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  const submitLink = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError("");
    setSubmitting(true);
    try {
      await onAddLink(trimmed, goalId);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Could not add link");
    } finally {
      setSubmitting(false);
    }
  };

  const submitDelete = async () => {
    if (!source?.id) return;
    setError("");
    setSubmitting(true);
    try {
      await onDeleteSource(source.id);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Could not remove source");
    } finally {
      setSubmitting(false);
    }
  };

  let title = "";
  let subtitle = "";
  let body = null;
  let footer = null;

  if (mode === "upload") {
    title = goalTitle ? `Attach a source to "${goalTitle}"` : "Attach a source";
    subtitle = "Upload a PDF, .md, .txt, .csv, .json, .png or .jpg.";
    body = (
      <div className="space-y-3">
        <input
          ref={fileRef}
          data-testid="source-upload-input"
          type="file"
          accept=".pdf,.md,.txt,.csv,.json,.png,.jpg,.jpeg"
          className="block w-full text-xs text-[var(--text-secondary)] file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-[var(--accent)] file:text-[var(--bg-primary)] file:text-xs file:font-medium hover:file:opacity-90 file:cursor-pointer"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) submitUpload(f);
            e.target.value = "";
          }}
        />
        {submitting && <p className="font-mono text-[10px] text-[var(--text-muted)]">Uploading…</p>}
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      </div>
    );
    footer = null;
  } else if (mode === "link") {
    title = goalTitle ? `Add a link to "${goalTitle}"` : "Add a link as a source";
    subtitle = "Paste any URL — the coach will pull the text out.";
    body = (
      <div className="space-y-3">
        <input
          data-testid="source-link-input"
          autoFocus
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitLink(); } }}
          placeholder="https://…"
          className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)]"
        />
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      </div>
    );
    footer = (
      <>
        <button onClick={onClose} data-testid="source-link-cancel" className="text-xs px-3 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          Cancel
        </button>
        <button
          data-testid="source-link-submit"
          onClick={submitLink}
          disabled={!url.trim() || submitting}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          <Send className="w-3 h-3" /> Add source
        </button>
      </>
    );
  } else if (mode === "delete") {
    title = `Remove "${source?.original_filename || "source"}"?`;
    subtitle = "This won't delete the underlying file from your disk — only the link to it from GoalCoach.";
    body = (
      <div className="space-y-3">
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Are you sure? If a goal was using this source the coach will flag it as a boundary change on your next turn.
        </p>
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      </div>
    );
    footer = (
      <>
        <button onClick={onClose} data-testid="source-delete-cancel" className="text-xs px-3 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          Cancel
        </button>
        <button
          data-testid="source-delete-confirm"
          onClick={submitDelete}
          disabled={submitting}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded bg-[var(--danger)] text-[var(--bg-primary)] disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          <Trash2 className="w-3 h-3" /> Remove
        </button>
      </>
    );
  }

  const Icon = mode === "link" ? Link2 : mode === "delete" ? Trash2 : Paperclip;

  return (
    <CenteredDialog
      open={open}
      onClose={onClose}
      icon={Icon}
      title={title}
      subtitle={subtitle}
      maxWidth="max-w-md"
      testId={`source-action-dialog-${mode}`}
    >
      {body}
    </CenteredDialog>
  );
}
