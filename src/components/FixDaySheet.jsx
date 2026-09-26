import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus, PencilLine } from 'lucide-react';
import { useApp } from '../state.jsx';
import {
  eventsForDay, timedPouchesForDay, correctionForDay, pouchesForDay, reasonFor,
  triggersFor, statusForDay, dayNumberFor, fmtTime,
} from '../store.js';
import { capForDay } from '../plan.js';
import { TRIGGERS } from '../triggers.js';
import BackfillForm from './BackfillForm.jsx';
import { pouchVerdict } from '../pouchVerdict.js';

const spring = { type: 'spring', damping: 26, stiffness: 240 };
const NOTE_MAX = 140;
const STEP_MAX = 40;

const fmtHeader = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtShort = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// The calendar date an event was entered on, in the zone it was entered in —
// never the reader's zone (time.js rule).
function enteredOn(ev) {
  const ms = Date.parse(ev.ts);
  const off = ev.tzOffsetMin ?? -new Date(ms).getTimezoneOffset();
  return new Date(ms + off * 60000).toISOString().slice(0, 10);
}

const PILL = {
  green: { text: 'on plan', color: 'var(--green)', bg: 'var(--green-glow)' },
  yellow: { text: 'over', color: 'var(--amber)', bg: 'var(--amber-glow)' },
  nolog: { text: 'no log', color: 'var(--fg-faint)', bg: 'var(--surface)' },
  'today-under': { text: 'today', color: 'var(--accent-bright)', bg: 'rgba(94, 106, 210, 0.18)' },
  'today-over': { text: 'today · over', color: 'var(--amber)', bg: 'var(--amber-glow)' },
};

function StatusPill({ status }) {
  const p = PILL[status] ?? { text: status, color: 'var(--fg-muted)', bg: 'var(--surface)' };
  return (
    <span
      className="tiny"
      style={{ padding: '3px 9px', borderRadius: 999, border: `1px solid ${p.color}`, color: p.color, background: p.bg, fontWeight: 600, whiteSpace: 'nowrap' }}
    >
      {p.text}
    </span>
  );
}

// "Actual total" for a logged past day. Starts at pouchesForDay (so an
// existing correction shows); can't go below what was logged with a time.
function CorrectionForm({ state, day, cap }) {
  const { api } = useApp();
  const timed = timedPouchesForDay(state, day);
  const current = pouchesForDay(state, day);
  const correction = correctionForDay(state, day);
  const max = Math.max(STEP_MAX, current);
  const [total, setTotal] = useState(current);
  const clamp = (n) => Math.min(max, Math.max(timed, Math.round(n)));
  const over = total > cap;
  const dirty = total !== current;

  const stepBtn = (delta, label, Icon) => {
    const disabled = delta < 0 ? total <= timed : total >= max;
    return (
      <motion.button
        className="btn"
        onClick={() => setTotal((t) => clamp(t + delta))}
        disabled={disabled}
        aria-label={label}
        whileTap={disabled ? undefined : { scale: 0.94 }}
        style={{ flex: '0 0 auto', width: 56, minHeight: 48, padding: 0, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer' }}
      >
        <Icon size={20} />
      </motion.button>
    );
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="spread">
        <span className="tiny muted">Actual total</span>
        <span className="small faint num">Timed logs: {timed}</span>
      </div>

      <div className="row" style={{ gap: 12, marginTop: 12 }}>
        {stepBtn(-1, 'Fewer', Minus)}
        <div style={{ flex: 1, textAlign: 'center' }}>
          <input
            className="num"
            type="number"
            inputMode="numeric"
            aria-label="Actual total"
            value={total}
            min={timed}
            max={max}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setTotal(clamp(n));
            }}
            style={{ width: '100%', textAlign: 'center', fontSize: 36, fontWeight: 700, lineHeight: 1.1, background: 'transparent', border: 'none', color: 'var(--fg)', padding: 0 }}
          />
          <div className="small faint" style={{ marginTop: 2 }}>{total === 1 ? 'pouch' : 'pouches'}</div>
        </div>
        {stepBtn(1, 'More', Plus)}
      </div>

      <p role="status" aria-live="polite" className="small" style={{ margin: '12px 0 0', color: over ? 'var(--amber)' : 'var(--green)', fontWeight: 500 }}>
        {over
          ? `${total} of ${cap} — over, streak breaks; tomorrow’s cap doesn’t change`
          : `${total} of ${cap} — on plan`}
      </p>
      {correction && (
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Corrected {fmtShort(enteredOn(correction))} · was {timed}
        </p>
      )}
      <p className="small faint" style={{ margin: '10px 0 0' }}>
        Filling this in keeps the log honest — it&rsquo;s the log that gets you to quit day, not the streak.
      </p>

      <motion.button
        className="btn btn-accent"
        disabled={!dirty}
        whileTap={dirty ? { scale: 0.98 } : undefined}
        onClick={() => api.logCorrection({ day, count: total })}
        style={{ width: '100%', marginTop: 14, opacity: dirty ? 1 : 0.45 }}
      >
        Save total
      </motion.button>
    </div>
  );
}

// Inline editor for why one pouch happened. Saves the full set as a new
// reason event; the earlier one stays in history.
function ReasonEditor({ state, ev, onDone }) {
  const { api } = useApp();
  const existing = reasonFor(state, ev);
  const [picked, setPicked] = useState(() => triggersFor(state, ev).filter((t) => TRIGGERS.includes(t)));
  const [note, setNote] = useState(existing?.note ?? '');
  const canSave = picked.length > 0 || note.trim() !== '';
  const toggle = (t) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  const chipStyle = { minHeight: 36, padding: '6px 13px', fontSize: 13 };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={spring}
      style={{ overflow: 'hidden' }}
    >
      <div style={{ padding: '4px 2px 12px' }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {TRIGGERS.map((t) => (
            <motion.button
              key={t}
              type="button"
              className={`chip ${picked.includes(t) ? 'selected' : ''}`}
              aria-pressed={picked.includes(t)}
              style={chipStyle}
              whileTap={{ scale: 0.94 }}
              onClick={() => toggle(t)}
            >
              {t}
            </motion.button>
          ))}
        </div>
        <input
          type="text"
          aria-label="Note"
          placeholder="anything else?"
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--fg)', fontSize: 16 }}
        />
        <div className="row" style={{ gap: 10, marginTop: 10 }}>
          <motion.button className="btn btn-ghost" type="button" whileTap={{ scale: 0.98 }} onClick={onDone} style={{ flex: 1 }}>
            Cancel
          </motion.button>
          <motion.button
            className="btn btn-accent"
            type="button"
            disabled={!canSave}
            whileTap={canSave ? { scale: 0.98 } : undefined}
            onClick={() => { if (api.logReason({ target: ev.id, triggers: picked, note })) onDone(); }}
            style={{ flex: 1, opacity: canSave ? 1 : 0.45 }}
          >
            Save reasons
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

function PouchList({ state, day }) {
  const [editing, setEditing] = useState(null);
  const pouches = eventsForDay(state, day)
    .filter((e) => e.type === 'pouch')
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="tiny muted" style={{ marginBottom: 6 }}>Pouches with a time</div>
      {pouches.length === 0 ? (
        <p className="small faint" style={{ margin: 0 }}>None logged with a time.</p>
      ) : (
        <>
          <p className="small faint" style={{ margin: '0 0 6px' }}>Tap one to add why it happened.</p>
          {pouches.map((ev, i) => {
            const v = pouchVerdict(state, ev);
            const tags = triggersFor(state, ev);
            const note = reasonFor(state, ev)?.note;
            const open = editing === ev.id;
            return (
              <div key={ev.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                <button
                  type="button"
                  aria-label={`Pouch at ${fmtTime(ev)}`}
                  aria-expanded={open}
                  onClick={() => setEditing(open ? null : ev.id)}
                  style={{ width: '100%', background: 'transparent', padding: '10px 2px', minHeight: 44, textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 9 }}
                >
                  <span style={{ width: 8, height: 8, marginTop: 6, borderRadius: '50%', background: v.color, flexShrink: 0, opacity: 0.85 }} />
                  <span className="small" style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 7px' }}>
                    <span className="muted num">{fmtTime(ev)}</span>
                    {ev.ctx?.slotLabel && <><span className="faint">·</span><span className="muted">{ev.ctx.slotLabel}</span></>}
                    <span className="faint">·</span>
                    <span style={{ color: v.color, fontWeight: 500 }}>{v.text}</span>
                    {tags.length > 0 && <><span className="faint">·</span><span className="faint">{tags.join(', ')}</span></>}
                    {note && <span className="faint" style={{ flexBasis: '100%', fontStyle: 'italic' }}>{note}</span>}
                  </span>
                  <PencilLine size={14} color="var(--fg-faint)" style={{ flexShrink: 0, marginTop: 3 }} />
                </button>
                <AnimatePresence initial={false}>
                  {open && <ReasonEditor key="edit" state={state} ev={ev} onDone={() => setEditing(null)} />}
                </AnimatePresence>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// Fix a past day (or add reasons to today's pouches). Everything here appends:
// a backfill, a correction, or a reason. Nothing logged is ever rewritten.
export default function FixDaySheet({ day, onClose }) {
  const { state } = useApp();
  const n = dayNumberFor(state, day);
  const cap = capForDay(state.plan, n);
  const status = statusForDay(state, day);
  const isToday = status === 'today-under' || status === 'today-over';

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        role="dialog"
        aria-label="Fix this day"
      >
        <div className="sheet-handle" />
        <h3 style={{ fontSize: 16, margin: 0 }}>Fix this day</h3>
        <div className="spread" style={{ marginTop: 6 }}>
          <span className="small muted">Day {n} · {fmtHeader(day)}</span>
          <span className="row" style={{ gap: 8 }}>
            <StatusPill status={status} />
            <span className="small faint num">cap {cap}</span>
          </span>
        </div>

        {status === 'nolog' && (
          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>No log for this day. How many did you have?</div>
            <BackfillForm key={day} day={day} cap={cap} />
          </div>
        )}

        {(status === 'green' || status === 'yellow') && (
          <CorrectionForm key={`${day}:${correctionForDay(state, day)?.id ?? ''}`} state={state} day={day} cap={cap} />
        )}

        {isToday && (
          <p className="small muted" style={{ margin: '14px 0 0' }}>
            Today is still being logged — corrections open tomorrow.
          </p>
        )}

        {status !== 'nolog' && <PouchList state={state} day={day} />}

        <button className="btn btn-ghost" type="button" onClick={onClose} style={{ width: '100%', marginTop: 16 }}>
          Done
        </button>
      </motion.div>
    </>
  );
}
