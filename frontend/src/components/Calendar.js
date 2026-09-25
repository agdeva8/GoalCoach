import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, X, AlertOctagon, CheckCircle2, Circle, Milestone } from "lucide-react";
import CenteredDialog from "./CenteredDialog";
import { api } from "../lib/api";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtInputDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TODAY = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; })();

const mileColor = (m) => {
  if (m.status === "done") return "var(--success)";
  const d = m.target_date ? new Date(m.target_date + "T00:00:00") : null;
  if (d && !isNaN(d.getTime()) && d < TODAY) return "var(--danger)";
  return "var(--warning)";
};

const horizonColor = (horizon) => {
  switch (horizon) {
    case "weekly": return "var(--accent)";
    case "short": return "var(--warning)";
    case "medium": return "var(--accent)";
    case "long": return "var(--success)";
    default: return "var(--text-muted)";
  }
};

// Blockers span multiple days — check if a blocker covers a given day
const blockerCoversDay = (b, dayStart) => {
  if (!b.start_date || !b.end_date) return false;
  const bs = new Date(b.start_date + "T00:00:00");
  const be = new Date(b.end_date + "T00:00:00");
  be.setHours(23, 59, 59, 999);
  return dayStart >= bs && dayStart <= be;
};

export default function Calendar({ state, onPrefill, onBlockerChange }) {
  const [current, setCurrent] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDay, setSelectedDay] = useState(null); // Date object
  const [editBlocker, setEditBlocker] = useState(null); // blocker object or null (null = add mode)
  const [addBlockerOpen, setAddBlockerOpen] = useState(false); // explicit add mode
  const [addCommitmentOpen, setAddCommitmentOpen] = useState(false);
  const [commitmentText, setCommitmentText] = useState("");
  const [blockerTitle, setBlockerTitle] = useState("");
  const [blockerStart, setBlockerStart] = useState("");
  const [blockerEnd, setBlockerEnd] = useState("");
  const [blockerNote, setBlockerNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Calendar grid days
  const calendarDays = useMemo(() => {
    const year = current.getFullYear();
    const month = current.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday-based offset
    let startOffset = (firstDay.getDay() + 6) % 7;
    const days = [];

    // Prev month filler
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, currentMonth: false });
    }
    // Current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      days.push({ date: d, currentMonth: true });
    }
    // Next month filler to complete grid (always 6 rows = 42 cells)
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push({ date: d, currentMonth: false });
    }
    return days;
  }, [current]);

  const milestones = state?.milestones || [];
  const commitments = state?.commitments || [];
  const blockers = state?.blockers || [];
  const goals = state?.goals || [];

  const prevMonth = () => setCurrent((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const nextMonth = () => setCurrent(new Date(current.getFullYear(), current.getMonth() + 1, 1));
  const goToday = () => setCurrent(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const openAddBlocker = useCallback((dayDate) => {
    setEditBlocker(null);
    setAddBlockerOpen(true);
    setBlockerTitle("");
    setBlockerStart(fmtDate(dayDate));
    setBlockerEnd(fmtDate(dayDate));
    setBlockerNote("");
    setSelectedDay(dayDate);
  }, []);

  const openEditBlocker = useCallback((e, blocker) => {
    e.stopPropagation();
    setEditBlocker(blocker);
    setBlockerTitle(blocker.title || "");
    setBlockerStart(blocker.start_date || "");
    setBlockerEnd(blocker.end_date || blocker.start_date || "");
    setBlockerNote(blocker.note || "");
    setSelectedDay(null);
  }, []);

  const closeBlockerDialog = () => {
    setEditBlocker(null);
    setAddBlockerOpen(false);
    setSelectedDay(null);
    setBlockerTitle("");
    setBlockerStart("");
    setBlockerEnd("");
    setBlockerNote("");
  };

  const saveBlocker = async () => {
    if (!blockerTitle.trim() || !blockerStart) return;
    setSaving(true);
    try {
      const payload = {
        title: blockerTitle.trim(),
        start_date: blockerStart,
        end_date: blockerEnd || blockerStart,
        note: blockerNote,
      };
      if (editBlocker) {
        await api.updateBlocker(editBlocker.id, payload);
      } else {
        await api.createBlocker(payload);
      }
      if (onBlockerChange) onBlockerChange();
      closeBlockerDialog();
    } catch (e) {
      console.error("Failed to save blocker", e);
    } finally {
      setSaving(false);
    }
  };

  const deleteBlocker = async () => {
    if (!editBlocker) return;
    setSaving(true);
    try {
      await api.deleteBlocker(editBlocker.id);
      if (onBlockerChange) onBlockerChange();
      closeBlockerDialog();
    } catch (e) {
      console.error("Failed to delete blocker", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDayClick = (dayDate) => {
    setSelectedDay(dayDate);
  };

  const handleAddCommitment = async () => {
    if (!commitmentText.trim() || !selectedDay) return;
    setSaving(true);
    try {
      await api.createCommitment({
        text: commitmentText.trim(),
        due: fmtDate(selectedDay),
        goal_id: null,
      });
      setCommitmentText("");
      setAddCommitmentOpen(false);
      if (onBlockerChange) onBlockerChange();
    } catch (e) {
      console.error("Failed to add commitment", e);
    } finally {
      setSaving(false);
    }
  };

  const isToday = (d) => d.getTime() === TODAY.getTime();
  const isSelected = (d) => selectedDay && d.getTime() === selectedDay.getTime();
  const dateLabel = (d) => fmtDate(d);

  const dayItems = (d) => {
    const dateStr = fmtDate(d);
    const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
    const dayMilestones = milestones.filter((m) => m.target_date === dateStr);
    const dayCommitments = commitments.filter((c) => c.due === dateStr);
    const dayBlockers = blockers.filter((b) => blockerCoversDay(b, dayStart));
    return { dayMilestones, dayCommitments, dayBlockers };
  };

  const label = `${MONTHS[current.getMonth()]} ${current.getFullYear()}`;

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "var(--font-body)" }}>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
        <button
          data-testid="calendar-prev-month"
          onClick={prevMonth}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center">
          <span data-testid="calendar-month-label" className="font-display text-sm font-semibold text-[var(--text-primary)] tracking-tight">
            {label}
          </span>
        </div>
        <button
          data-testid="calendar-next-month"
          onClick={nextMonth}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={goToday}
          className="px-2 h-7 rounded text-[10px] font-mono uppercase tracking-wider border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
        >
          Today
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 shrink-0 border-b border-[var(--border)]">
        {DOW.map((d) => (
          <div key={d} className="py-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="flex-1 grid grid-cols-7 grid-rows-6 overflow-hidden">
        {calendarDays.map(({ date, currentMonth }, i) => {
          const { dayMilestones, dayCommitments, dayBlockers } = dayItems(date);
          const todayDay = isToday(date);
          const selectedDay2 = isSelected(date);
          const hasItems = dayMilestones.length > 0 || dayCommitments.length > 0 || dayBlockers.length > 0;

          return (
            <div
              key={i}
              data-testid={`calendar-day-${fmtDate(date)}`}
              onClick={() => handleDayClick(date)}
              className={`
                relative border-b border-r border-[var(--border)] overflow-hidden
                cursor-pointer transition-colors select-none
                ${currentMonth ? "" : "opacity-30"}
                ${todayDay ? "bg-[var(--accent)]/5" : ""}
                ${selectedDay2 ? "bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/40" : ""}
                hover:bg-[var(--bg-tertiary)]/50
              `}
            >
              <div className={`absolute top-1 left-1 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-mono ${todayDay ? "bg-[var(--accent)] text-[var(--bg-primary)] font-semibold" : "text-[var(--text-secondary)]"}`}>
                {date.getDate()}
              </div>

              {/* Add blocker button on empty day hover area */}
              {!hasItems && currentMonth && (
                <button
                  data-testid={`add-blocker-on-${fmtDate(date)}`}
                  onClick={(e) => { e.stopPropagation(); openAddBlocker(date); }}
                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded opacity-0 hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity"
                  title="Add blocker"
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}

              {/* Blocker bars */}
              {dayBlockers.map((b) => (
                <div
                  key={b.id}
                  data-testid={`calendar-blocker-${b.id}`}
                  onClick={(e) => openEditBlocker(e, b)}
                  className="absolute left-0 right-0 h-3 bg-[var(--danger)]/70 hover:bg-[var(--danger)]/90 transition-colors cursor-pointer flex items-center px-1"
                  style={{ top: "26px" }}
                  title={b.title}
                >
                  <span className="text-[8px] text-white truncate leading-none">{b.title}</span>
                </div>
              ))}

              {/* Milestone dot */}
              {dayMilestones.length > 0 && (
                <div
                  className="absolute left-1 flex items-center gap-0.5"
                  style={{ top: "30px" }}
                >
                  {dayMilestones.slice(0, 3).map((m) => (
                    <div
                      key={m.id}
                      title={m.title}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: mileColor(m) }}
                    />
                  ))}
                </div>
              )}

              {/* Commitment bars — Google Calendar style. Each commitment
                  renders as a small colored bar with the task text inline
                  so the user can read it without clicking. Stacked when
                  multiple commitments fall on the same day. */}
              {dayCommitments.length > 0 && (
                <div className="absolute left-0.5 right-0.5 top-7 flex flex-col gap-0.5">
                  {dayCommitments.slice(0, 3).map((c) => (
                    <div
                      key={c.id}
                      data-testid={`calendar-commitment-${c.id}`}
                      title={c.text}
                      className={`h-3.5 px-1.5 flex items-center text-[8px] truncate cursor-pointer transition-colors ${
                        c.status === "done"
                          ? "bg-[var(--success)]/70 hover:bg-[var(--success)] text-[var(--bg-primary)] line-through"
                          : "bg-[var(--accent)]/85 hover:bg-[var(--accent)] text-[var(--bg-primary)]"
                      }`}
                    >
                      <span className="truncate leading-none">{c.text}</span>
                    </div>
                  ))}
                  {dayCommitments.length > 3 && (
                    <div className="text-[8px] text-[var(--text-muted)] text-right pr-1">
                      +{dayCommitments.length - 3}
                    </div>
                  )}
                </div>
              )}

              {/* Overflow indicator */}
              {(dayMilestones.length > 3 || dayCommitments.length > 3) && (
                <div className="absolute bottom-0.5 right-1 text-[8px] text-[var(--text-muted)]">
                  +{(dayMilestones.length + dayCommitments.length) - 6}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-secondary)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-display text-xs font-semibold text-[var(--text-primary)]">
              {MONTHS[selectedDay.getMonth()]} {selectedDay.getDate()}, {selectedDay.getFullYear()}
            </span>
            <button
              onClick={() => setSelectedDay(null)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {(() => {
            const { dayMilestones, dayCommitments, dayBlockers } = dayItems(selectedDay);
            const hasItems = dayMilestones.length + dayCommitments.length + dayBlockers.length > 0;
            if (!hasItems) {
              return (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] text-[var(--text-muted)]">No items on this day.</p>
                  <div className="flex gap-2">
                    <button
                      data-testid={`add-blocker-detail-${fmtDate(selectedDay)}`}
                      onClick={() => openAddBlocker(selectedDay)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--danger)] hover:text-[var(--danger)] transition-colors"
                    >
                      <AlertOctagon className="w-3 h-3" /> Add blocker
                    </button>
                    <button
                      data-testid={`add-commitment-detail-${fmtDate(selectedDay)}`}
                      onClick={() => { setAddCommitmentOpen(true); setCommitmentText(""); }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add commitment
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {dayBlockers.map((b) => (
                  <div
                    key={b.id}
                    data-testid={`detail-blocker-${b.id}`}
                    onClick={(e) => openEditBlocker(e, b)}
                    className="flex items-center gap-1.5 text-[11px] text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded px-2 py-1 cursor-pointer hover:bg-[var(--danger)]/20 transition-colors"
                  >
                    <AlertOctagon className="w-3 h-3 shrink-0" />
                    <span className="truncate">{b.title}</span>
                    <span className="ml-auto text-[10px] opacity-70">{b.start_date}{b.end_date && b.end_date !== b.start_date ? ` – ${b.end_date}` : ""}</span>
                  </div>
                ))}
                {dayMilestones.map((m) => (
                  <div key={m.id} className="flex items-center gap-1.5 text-[11px]">
                    <Milestone className="w-3 h-3 shrink-0" style={{ color: mileColor(m) }} />
                    <span className="text-[var(--text-secondary)] truncate">{m.title || "Milestone"}</span>
                    {m.status === "done" && <CheckCircle2 className="w-3 h-3 text-[var(--success)] shrink-0" />}
                  </div>
                ))}
                {dayCommitments.map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5 text-[11px]">
                    {c.status === "done" ? (
                      <CheckCircle2 className="w-3 h-3 text-[var(--success)] shrink-0" />
                    ) : (
                      <Circle className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                    )}
                    <span className={c.status === "done" ? "line-through text-[var(--text-muted)] truncate" : "text-[var(--text-secondary)] truncate"}>
                      {c.text}
                    </span>
                  </div>
                ))}
                <div className="flex gap-2 pt-1 border-t border-[var(--border)]">
                  <button
                    onClick={() => openAddBlocker(selectedDay)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--danger)] hover:text-[var(--danger)] transition-colors"
                  >
                    <AlertOctagon className="w-3 h-3" /> Add blocker
                  </button>
                  <button
                    onClick={() => { setAddCommitmentOpen(true); setCommitmentText(""); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add commitment
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Add/Edit Blocker Dialog */}
      <CenteredDialog
        open={editBlocker !== null || addBlockerOpen}
        onClose={closeBlockerDialog}
        title={editBlocker ? "Edit Blocker" : "Add Blocker"}
        subtitle={editBlocker ? `Editing "${editBlocker.title}"` : fmtDate(selectedDay || new Date())}
        maxWidth="max-w-sm"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">Title *</label>
            <input
              data-testid="blocker-title-input"
              type="text"
              value={blockerTitle}
              onChange={(e) => setBlockerTitle(e.target.value)}
              placeholder="e.g. On vacation, Conference week"
              className="w-full px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">Start *</label>
              <input
                data-testid="blocker-start-input"
                type="date"
                value={blockerStart}
                onChange={(e) => setBlockerStart(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">End</label>
              <input
                data-testid="blocker-end-input"
                type="date"
                value={blockerEnd}
                onChange={(e) => setBlockerEnd(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">Note</label>
            <textarea
              data-testid="blocker-note-input"
              value={blockerNote}
              onChange={(e) => setBlockerNote(e.target.value)}
              placeholder="Optional details…"
              rows={2}
              className="w-full px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none"
            />
          </div>
          <div className="flex gap-2 pt-1">
            {editBlocker && (
              <button
                data-testid="blocker-delete-btn"
                onClick={deleteBlocker}
                disabled={saving}
                className="px-3 py-1.5 rounded text-xs border border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={closeBlockerDialog}
                disabled={saving}
                className="px-3 py-1.5 rounded text-xs border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid="blocker-save-btn"
                onClick={saveBlocker}
                disabled={saving || !blockerTitle.trim() || !blockerStart}
                className="px-3 py-1.5 rounded text-xs bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? "Saving…" : editBlocker ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </CenteredDialog>

      {/* Add Commitment Dialog */}
      <CenteredDialog
        open={addCommitmentOpen}
        onClose={() => { setAddCommitmentOpen(false); setCommitmentText(""); }}
        title="Add Commitment"
        subtitle={selectedDay ? fmtDate(selectedDay) : ""}
        maxWidth="max-w-sm"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-1">What do you want to commit to? *</label>
            <input
              data-testid="commitment-text-input"
              type="text"
              value={commitmentText}
              onChange={(e) => setCommitmentText(e.target.value)}
              placeholder="e.g. Draft intro paragraph"
              className="w-full px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              onKeyDown={(e) => e.key === "Enter" && handleAddCommitment()}
            />
          </div>
          <div className="flex gap-2">
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => { setAddCommitmentOpen(false); setCommitmentText(""); }}
                disabled={saving}
                className="px-3 py-1.5 rounded text-xs border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid="commitment-save-btn"
                onClick={handleAddCommitment}
                disabled={saving || !commitmentText.trim()}
                className="px-3 py-1.5 rounded text-xs bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </CenteredDialog>
    </div>
  );
}
