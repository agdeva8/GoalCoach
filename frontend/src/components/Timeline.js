import { useMemo, useState } from "react";
import { ChevronLeft, CalendarClock, AlertOctagon, Circle, CheckCircle2 } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const parse = (s) => {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
};
const fmtDay = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const startOfWeek = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};

function makeBuckets(level, anchor) {
  const y = anchor.getFullYear();
  if (level === "year") {
    return [0, 1, 2, 3].map((q) => ({
      start: new Date(y, q * 3, 1),
      end: new Date(y, q * 3 + 3, 1),
      label: `Q${q + 1}`,
      sub: `${MONTHS[q * 3]}–${MONTHS[q * 3 + 2]} ${y}`,
      next: "quarter",
    }));
  }
  if (level === "quarter") {
    const qm = anchor.getMonth();
    return [0, 1, 2].map((i) => ({
      start: new Date(y, qm + i, 1),
      end: new Date(y, qm + i + 1, 1),
      label: MONTHS[qm + i],
      sub: `${y}`,
      next: "month",
    }));
  }
  if (level === "month") {
    const m = anchor.getMonth();
    const res = [];
    let ws = startOfWeek(new Date(y, m, 1));
    const monthEnd = new Date(y, m + 1, 1);
    while (ws < monthEnd) {
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      const lastDay = new Date(we.getTime() - 86400000);
      res.push({ start: new Date(ws), end: new Date(we), label: `${fmtDay(ws)} – ${fmtDay(lastDay)}`, sub: "", next: "week" });
      ws = we;
    }
    return res;
  }
  // week -> days
  const ws = startOfWeek(anchor);
  return [...Array(7)].map((_, i) => {
    const ds = new Date(ws);
    ds.setDate(ds.getDate() + i);
    const de = new Date(ds);
    de.setDate(de.getDate() + 1);
    return { start: ds, end: de, label: DOW[i], sub: fmtDay(ds), next: null };
  });
}

export default function Timeline({ state, onPrefill }) {
  const [view, setView] = useState({ level: "year", anchor: new Date(new Date().getFullYear(), 0, 1) });
  const today = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }, []);

  const items = useMemo(() => {
    const out = [];
    (state?.goals || []).forEach((g) => {
      const d = parse(g.target_date);
      if (d && g.status !== "dropped") out.push({ date: d, label: g.title, sub: "goal target", kind: "goal", done: false });
    });
    (state?.milestones || []).forEach((m) => {
      const d = parse(m.target_date);
      if (d) out.push({ date: d, label: m.title || "Milestone", sub: m.goal_title, kind: "milestone", done: m.status === "done" });
    });
    (state?.commitments || []).forEach((c) => {
      const d = parse(c.due);
      if (d) out.push({ date: d, label: c.text, sub: c.goal_title, kind: "commitment", done: c.status === "done" });
    });
    return out;
  }, [state]);

  const blockers = useMemo(
    () =>
      (state?.blockers || [])
        .map((b) => ({ start: parse(b.start_date), end: parse(b.end_date) || parse(b.start_date), title: b.title }))
        .filter((b) => b.start),
    [state]
  );

  const buckets = makeBuckets(view.level, view.anchor);
  const isEmpty = items.length === 0 && blockers.length === 0;

  const itemsIn = (s, e) => items.filter((it) => it.date >= s && it.date < e);
  const blockersIn = (s, e) => blockers.filter((b) => b.start < e && b.end >= s);

  const drill = (b) => b.next && setView({ level: b.next, anchor: b.start });
  const goBack = () => {
    const a = view.anchor;
    if (view.level === "quarter") setView({ level: "year", anchor: new Date(a.getFullYear(), 0, 1) });
    else if (view.level === "month") setView({ level: "quarter", anchor: new Date(a.getFullYear(), Math.floor(a.getMonth() / 3) * 3, 1) });
    else if (view.level === "week") setView({ level: "month", anchor: new Date(a.getFullYear(), a.getMonth(), 1) });
  };

  const crumbs = [];
  const ay = view.anchor.getFullYear();
  crumbs.push({ label: `${ay}`, onClick: () => setView({ level: "year", anchor: new Date(ay, 0, 1) }) });
  if (["quarter", "month", "week"].includes(view.level)) {
    const q = Math.floor(view.anchor.getMonth() / 3);
    crumbs.push({ label: `Q${q + 1}`, onClick: () => setView({ level: "quarter", anchor: new Date(ay, q * 3, 1) }) });
  }
  if (["month", "week"].includes(view.level)) {
    const m = view.anchor.getMonth();
    crumbs.push({ label: MONTHS[m], onClick: () => setView({ level: "month", anchor: new Date(ay, m, 1) }) });
  }
  if (view.level === "week") {
    const ws = startOfWeek(view.anchor);
    crumbs.push({ label: fmtDay(ws), onClick: null });
  }

  if (isEmpty) {
    return (
      <div data-testid="timeline-view" className="p-4 sm:p-6">
        <div className="border border-dashed border-[var(--border)] p-6 text-center">
          <CalendarClock className="w-6 h-6 mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            No dates on the map yet. Ask the coach to sketch a realistic timeline — it'll propose target
            dates and a few milestones per goal, with buffer built in.
          </p>
          {onPrefill && (
            <button
              data-testid="timeline-prefill-button"
              onClick={() => onPrefill("Map out a realistic timeline for my goals — propose target dates and 2-4 milestones each, with buffer for real life.")}
              className="mt-3 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Ask the coach to build my timeline →
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="timeline-view" className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {view.level !== "year" && (
          <button data-testid="timeline-back" onClick={goBack} className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}
        <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="opacity-50">/</span>}
              {c.onClick ? (
                <button onClick={c.onClick} className="hover:text-[var(--accent)] transition-colors">{c.label}</button>
              ) : (
                <span className="text-[var(--accent)]">{c.label}</span>
              )}
            </span>
          ))}
        </div>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{view.level} view</span>
      </div>

      <div className={`grid gap-2 ${view.level === "week" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
        {buckets.map((b, idx) => {
          const its = itemsIn(b.start, b.end);
          const bls = blockersIn(b.start, b.end);
          const drift = its.filter((it) => !it.done && it.date < today);
          const isNow = today >= b.start && today < b.end;
          const clickable = !!b.next;
          return (
            <div
              key={idx}
              data-testid={`timeline-bucket-${view.level}-${idx}`}
              onClick={() => clickable && drill(b)}
              className={`border p-3 transition-colors ${isNow ? "border-[var(--accent)]" : "border-[var(--border)]"} ${clickable ? "cursor-pointer hover:border-[var(--border-accent)] hover:bg-[var(--bg-secondary)]" : ""} bg-[var(--bg-secondary)]/40`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">{b.label}</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">{b.sub}{isNow ? " · now" : ""}</span>
              </div>

              {its.length === 0 && bls.length === 0 ? (
                <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">clear</div>
              ) : (
                <div className="mt-2 space-y-1">
                  {its.slice(0, 6).map((it, i) => {
                    const overdue = !it.done && it.date < today;
                    const color = it.done ? "var(--success)" : overdue ? "var(--danger)" : "var(--text-secondary)";
                    return (
                      <div key={i} className="flex items-start gap-1.5 text-[11px]" style={{ color }}>
                        {it.done ? <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" /> : <Circle className="w-3 h-3 mt-0.5 shrink-0" />}
                        <span className={it.done ? "line-through" : ""}>{it.label}{it.sub ? ` · ${it.sub}` : ""}</span>
                      </div>
                    );
                  })}
                  {its.length > 6 && <div className="text-[10px] text-[var(--text-muted)]">+{its.length - 6} more</div>}
                </div>
              )}

              {bls.map((bl, i) => (
                <div key={`bl-${i}`} className="mt-1.5 flex items-center gap-1.5 text-[10px] font-mono text-[var(--warning)]">
                  <AlertOctagon className="w-3 h-3 shrink-0" /> blocker: {bl.title}
                </div>
              ))}

              {drift.length > 0 && (
                <div data-testid="timeline-drift" className="mt-1.5 pt-1.5 border-t border-[var(--danger)]/30 text-[10px] font-mono uppercase tracking-wider text-[var(--danger)]">
                  drift · {drift.length} past due
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 pt-1 font-mono text-[10px] text-[var(--text-muted)]">
        {[["done", "var(--success)"], ["upcoming", "var(--text-secondary)"], ["drift", "var(--danger)"]].map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: v }} /> {k}
          </span>
        ))}
      </div>
    </div>
  );
}
