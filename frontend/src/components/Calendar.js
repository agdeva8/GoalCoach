import { useState, useMemo, useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, X, AlertOctagon, CheckCircle2, Circle, Milestone, Clock } from "lucide-react";
import CenteredDialog from "./CenteredDialog";
import AutoTextarea from "./AutoTextarea";
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

/**
 * Goal markers — a thin underline on the day a goal's target_date
 * lands. Different shade based on status (active=accent, paused=
 * muted, dropped=strikethrough). Renders an outline on the day cell
 * even when the goal has no milestones yet, so the user always sees
 * their target dates at a glance.
 */
const goalTargetMarkerColor = (g) => {
  if (g.status === "dropped") return "var(--text-muted)"
  if (g.status === "paused") return "var(--text-muted)"
  if (g.target_date) {
    const d = new Date(g.target_date + "T00:00:00")
    if (!isNaN(d.getTime()) && d < TODAY) return "var(--danger)"
  }
  return "var(--accent)"
}

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

  // --- Timetable blocks (direct CRUD, Hard constraint #2) ------------------
  const [blocks, setBlocks] = useState([]);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [editBlock, setEditBlock] = useState(null);
  const [blockLabel, setBlockLabel] = useState("");
  const [blockKind, setBlockKind] = useState("focus");
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("10:00");
  const [blockNote, setBlockNote] = useState("");

  const loadBlocks = useCallback(() => {
    api.timetable()
      .then((res) => setBlocks(res?.blocks || []))
      .catch(() => { /* offline — keep the last list */ });
  }, []);
  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  const addHour = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return `${String(Math.min(23, (h + 1) % 24)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const openAddBlock = (dayDate, startTime) => {
    setEditBlock(null);
    setBlockDialogOpen(true);
    setBlockLabel("");
    setBlockKind("focus");
    setBlockStart(startTime || "09:00");
    setBlockEnd(startTime ? addHour(startTime) : "10:00");
    setBlockNote("");
    setSelectedDay(dayDate);
  };

  const openEditBlock = (b) => {
    setEditBlock(b);
    setBlockDialogOpen(true);
    setBlockLabel(b.label || "");
    setBlockKind(b.kind || "focus");
    setBlockStart(b.start_time || "09:00");
    setBlockEnd(b.end_time || "10:00");
    setBlockNote(b.note || "");
  };

  const closeBlockDialog = () => {
    setEditBlock(null);
    setBlockDialogOpen(false);
  };

  const saveBlock = async () => {
    if (!blockLabel.trim() || !blockStart || !blockEnd) return;
    setSaving(true);
    try {
      const payload = {
        block_date: fmtDate(selectedDay || new Date()),
        start_time: blockStart,
        end_time: blockEnd,
        label: blockLabel.trim(),
        kind: blockKind,
        note: blockNote,
      };
      if (editBlock) await api.updateBlock(editBlock.id, payload);
      else await api.createBlock(payload);
      loadBlocks();
      closeBlockDialog();
    } catch (e) {
      console.error("Failed to save block", e);
    } finally {
      setSaving(false);
    }
  };

  const deleteBlock = async () => {
    if (!editBlock) return;
    const id = editBlock.id;
    // Optimistic — drop it from the list and close immediately.
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    closeBlockDialog();
    try {
      await api.deleteBlock(id);
    } catch (e) {
      console.error("Failed to delete block", e);
      loadBlocks();
    }
  };

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

  // Editable timetable — toggle a commitment done/open from the calendar.
  const toggleCommitment = async (c) => {
    try {
      await api.updateCommitment(c.id, { status: c.status === "done" ? "open" : "done" });
      if (onBlockerChange) onBlockerChange();
    } catch (e) {
      console.error("Failed to update commitment", e);
    }
  };

  const dayItems = (d) => {
    const dateStr = fmtDate(d);
    const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
    const dayMilestones = milestones.filter((m) => m.target_date === dateStr);
    const dayCommitments = commitments.filter((c) => c.due === dateStr);
    const dayBlockers = blockers.filter((b) => blockerCoversDay(b, dayStart));
    const dayGoals = goals.filter((g) => g.target_date === dateStr && g.status !== "dropped");
    const dayBlocks = blocks
      .filter((b) => b.block_date === dateStr)
      .sort((a, b) => String(a.start_time || "").localeCompare(String(b.start_time || "")));
    return { dayMilestones, dayCommitments, dayBlockers, dayGoals, dayBlocks };
  };

  const label = `${MONTHS[current.getMonth()]} ${current.getFullYear()}`;

  return (
    <div data-testid="calendar-view" className="max-w-[820px] mx-auto w-full space-y-4 pb-24">
      {/* Month nav — iOS style: title + Today pill + prev/next */}
      <div className="flex items-center gap-2">
        <h2 data-testid="calendar-month-label" className="flex-1 text-[21px] sm:text-[24px] font-semibold tracking-tight text-[var(--text-primary)]">
          {label}
        </h2>
        <button
          onClick={goToday}
          className="h-11 px-4 rounded-full bg-[var(--bg-secondary)] text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Today
        </button>
        <button
          data-testid="calendar-prev-month"
          aria-label="Previous month"
          onClick={prevMonth}
          className="w-11 h-11 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          data-testid="calendar-next-month"
          aria-label="Next month"
          onClick={nextMonth}
          className="w-11 h-11 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Month grid card */}
      <div className="rounded-2xl bg-[var(--bg-secondary)] overflow-hidden border border-[var(--border)]">
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {DOW.map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 auto-rows-[minmax(74px,1fr)]">
        {calendarDays.map(({ date, currentMonth }, i) => {
          const { dayMilestones, dayCommitments, dayBlockers, dayGoals } = dayItems(date);
          const todayDay = isToday(date);
          const selectedDay2 = isSelected(date);
          const hasItems = dayMilestones.length > 0 || dayCommitments.length > 0 || dayBlockers.length > 0 || dayGoals.length > 0;

          return (
            <div
              key={i}
              data-testid={`calendar-day-${fmtDate(date)}`}
              onClick={() => handleDayClick(date)}
              className={`
                relative border-b border-r border-[var(--border)] overflow-hidden
                cursor-pointer transition-colors select-none
                ${todayDay ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] ring-1 ring-inset ring-[var(--accent)]" : ""}
                ${selectedDay2 ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] ring-1 ring-[var(--accent)]" : ""}
                hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_50%,transparent)]
              `}
            >
              <div className={`absolute top-1 left-1 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-mono ${todayDay ? "bg-[var(--accent)] text-[var(--bg-primary)] font-semibold" : currentMonth ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}>
                {date.getDate()}
              </div>

              {/* Goal target markers — top-right corner of the day cell. */}
              {dayGoals.length > 0 && currentMonth && (
                <div
                  data-testid={`calendar-goal-${fmtDate(date)}`}
                  className="absolute top-1 right-1 flex flex-col items-end gap-0.5 max-w-[70%]"
                  title={`Goal target: ${dayGoals.map((g) => g.title).join(", ")}`}
                >
                  {dayGoals.slice(0, 2).map((g) => (
                    <span
                      key={g.id}
                      className="font-mono text-[9px] uppercase tracking-wider truncate px-1 rounded max-w-full"
                      style={{
                        background: `${goalTargetMarkerColor(g)}33`,
                        color: goalTargetMarkerColor(g),
                        textDecoration: g.status === "paused" ? "line-through" : "none",
                      }}
                    >
                      {g.horizon}
                    </span>
                  ))}
                </div>
              )}

              {/* Add blocker button on empty day hover area */}
              {!hasItems && currentMonth && (
                <button
                  data-testid={`add-blocker-on-${fmtDate(date)}`}
                  onClick={(e) => { e.stopPropagation(); openAddBlocker(date); }}
                  className="absolute top-1 right-1 hidden sm:flex sm:w-6 sm:h-6 items-center justify-center rounded opacity-0 hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity"
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
                  className="absolute left-0 right-0 h-3 bg-[color-mix(in_srgb,var(--danger)_70%,transparent)] hover:bg-[color-mix(in_srgb,var(--danger)_90%,transparent)] transition-colors cursor-pointer flex items-center px-1"
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
                          ? "bg-[color-mix(in_srgb,var(--success)_70%,transparent)] hover:bg-[var(--success)] text-[var(--bg-primary)] line-through"
                          : "bg-[color-mix(in_srgb,var(--accent)_85%,transparent)] hover:bg-[var(--accent)] text-[var(--bg-primary)]"
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
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <div className="rounded-2xl bg-[var(--bg-secondary)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              {MONTHS[selectedDay.getMonth()]} {selectedDay.getDate()}, {selectedDay.getFullYear()}
            </h3>
            <button
              onClick={() => setSelectedDay(null)}
              aria-label="Close day details"
              className="h-11 w-11 -mr-2 inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {(() => {
            const { dayMilestones, dayCommitments, dayBlockers, dayBlocks } = dayItems(selectedDay);
            const hasItems = dayMilestones.length + dayCommitments.length + dayBlockers.length + dayBlocks.length > 0;
            return (
              <div className="space-y-2">
                {!hasItems && (
                  <p className="text-[13px] text-[var(--text-muted)]">Nothing on this day yet.</p>
                )}
                {/* Schedule — time-boxed blocks (direct CRUD) */}
                {dayBlocks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    data-testid={`detail-block-${b.id}`}
                    onClick={() => openEditBlock(b)}
                    className="w-full flex items-center gap-2.5 text-[13px] rounded-xl bg-[var(--bg-tertiary)] px-3 py-2.5 text-left hover:bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg-tertiary))] transition-colors"
                  >
                    <Clock className="w-4 h-4 shrink-0 text-[var(--accent)]" />
                    <span className="tabular-nums text-[12px] text-[var(--text-muted)] shrink-0">{b.start_time}–{b.end_time}</span>
                    <span className="truncate flex-1 text-[var(--text-primary)]">{b.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] shrink-0">{b.kind}</span>
                  </button>
                ))}
                {dayBlockers.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    data-testid={`detail-blocker-${b.id}`}
                    onClick={(e) => openEditBlocker(e, b)}
                    className="w-full flex items-center gap-2 text-[13px] text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] rounded-xl px-3 py-2.5 text-left hover:bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] transition-colors"
                  >
                    <AlertOctagon className="w-4 h-4 shrink-0" />
                    <span className="truncate flex-1">{b.title}</span>
                    <span className="text-[11px] opacity-70 shrink-0">{b.start_date}{b.end_date && b.end_date !== b.start_date ? ` – ${b.end_date}` : ""}</span>
                  </button>
                ))}
                {dayMilestones.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-[13px] px-1">
                    <Milestone className="w-4 h-4 shrink-0" style={{ color: mileColor(m) }} />
                    <span className="text-[var(--text-secondary)] truncate flex-1">{m.title || "Milestone"}</span>
                    {m.status === "done" && <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" />}
                  </div>
                ))}
                {dayCommitments.map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid={`detail-commitment-toggle-${c.id}`}
                      onClick={() => toggleCommitment(c)}
                      aria-pressed={c.status === "done"}
                      aria-label={c.status === "done" ? "Mark not done" : "Mark done"}
                      className="shrink-0 inline-flex items-center justify-center h-11 w-11 -ml-3"
                    >
                      {c.status === "done" ? (
                        <CheckCircle2 className="w-5 h-5 text-[var(--success)]" />
                      ) : (
                        <Circle className="w-5 h-5 text-[var(--text-muted)]" />
                      )}
                    </button>
                    <span className={c.status === "done" ? "line-through text-[var(--text-muted)] text-[13px] truncate flex-1" : "text-[var(--text-secondary)] text-[13px] truncate flex-1"}>
                      {c.text}
                    </span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    data-testid={`add-block-detail-${fmtDate(selectedDay)}`}
                    onClick={() => openAddBlock(selectedDay)}
                    className="min-h-11 flex-1 basis-[30%] flex items-center justify-center gap-1.5 px-3 rounded-xl bg-[var(--accent)] text-[13px] font-semibold text-[var(--bg-primary)] hover:opacity-90 transition-opacity"
                  >
                    <Clock className="w-4 h-4" /> Add block
                  </button>
                  <button
                    data-testid={`add-blocker-detail-${fmtDate(selectedDay)}`}
                    onClick={() => openAddBlocker(selectedDay)}
                    className="min-h-11 flex-1 basis-[30%] flex items-center justify-center gap-1.5 px-3 rounded-xl bg-[var(--bg-tertiary)] text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <AlertOctagon className="w-4 h-4" /> Blocker
                  </button>
                  <button
                    data-testid={`add-commitment-detail-${fmtDate(selectedDay)}`}
                    onClick={() => { setAddCommitmentOpen(true); setCommitmentText(""); }}
                    className="min-h-11 flex-1 basis-[30%] flex items-center justify-center gap-1.5 px-3 rounded-xl bg-[var(--bg-tertiary)] text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Commitment
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
                className="min-h-11 px-3 py-1.5 rounded text-xs border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={closeBlockerDialog}
                disabled={saving}
                className="min-h-11 px-3 py-1.5 rounded text-xs border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid="blocker-save-btn"
                onClick={saveBlocker}
                disabled={saving || !blockerTitle.trim() || !blockerStart}
                className="min-h-11 px-3 py-1.5 rounded text-xs bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? "Saving…" : editBlocker ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </CenteredDialog>

      {/* Add/Edit Block Dialog — time-boxed timetable block (direct CRUD) */}
      <CenteredDialog
        open={blockDialogOpen}
        onClose={closeBlockDialog}
        title={editBlock ? "Edit block" : "Add a time block"}
        subtitle={selectedDay ? fmtDate(selectedDay) : ""}
        maxWidth="max-w-sm"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Label *</label>
            <input
              data-testid="block-label-input"
              type="text"
              value={blockLabel}
              onChange={(e) => setBlockLabel(e.target.value)}
              placeholder="e.g. Deep work — draft proposal"
              className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Start *</label>
              <input
                data-testid="block-start-input"
                type="time"
                value={blockStart}
                onChange={(e) => setBlockStart(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">End *</label>
              <input
                data-testid="block-end-input"
                type="time"
                value={blockEnd}
                onChange={(e) => setBlockEnd(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Kind</label>
            <div className="grid grid-cols-4 gap-1.5">
              {["focus", "routine", "commitment", "blocker"].map((k) => (
                <button
                  key={k}
                  type="button"
                  data-testid={`block-kind-${k}`}
                  onClick={() => setBlockKind(k)}
                  aria-pressed={blockKind === k}
                  className={`h-10 rounded-xl text-[12px] font-medium capitalize transition-colors ${
                    blockKind === k
                      ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Note</label>
            <AutoTextarea
              data-testid="block-note-input"
              value={blockNote}
              onChange={(e) => setBlockNote(e.target.value)}
              minRows={2}
              maxRows={4}
              placeholder="Optional details…"
              className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] text-sm leading-[22px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex gap-2 pt-1">
            {editBlock && (
              <button
                data-testid="block-delete-btn"
                onClick={deleteBlock}
                disabled={saving}
                className="min-h-11 px-3 rounded-xl text-xs border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={closeBlockDialog}
                disabled={saving}
                className="min-h-11 px-4 rounded-xl text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid="block-save-btn"
                onClick={saveBlock}
                disabled={saving || !blockLabel.trim() || !blockStart || !blockEnd}
                className="min-h-11 px-4 rounded-xl text-xs font-semibold bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? "Saving…" : editBlock ? "Save" : "Add"}
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
                className="min-h-11 px-3 py-1.5 rounded text-xs border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid="commitment-save-btn"
                onClick={handleAddCommitment}
                disabled={saving || !commitmentText.trim()}
                className="min-h-11 px-3 py-1.5 rounded text-xs bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity disabled:opacity-50"
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
