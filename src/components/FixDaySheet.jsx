import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Minus, Plus, PencilLine, Undo2 } from 'lucide-react';
import { useApp } from '../state.jsx';
import {
  rawEventsForDay, timedPouchesForDay, correctionForDay, pouchesForDay, reasonFor,
  triggersFor, statusForDay, dayNumberFor, fmtTime, todayKey, pouchFlags,
} from '../store.js';
import { capForDay } from '../plan.js';
import { TRIGGERS } from '../triggers.js';
import { resolveLate, fmtHM } from '../latePouch.js';
import { UNDO_WINDOW_MS } from '../justLogged.js';
import BackfillForm from './BackfillForm.jsx';
import ReasonFields from './ReasonFields.jsx';
import { pouchVerdict } from '../pouchVerdict.js';
import { asText } from '../text.js';

const spring = { type: 'spring', damping: 26, stiffness: 240 };
// Everything that opens in place grows from nothing on the same spring.
const grow = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: spring,
  style: { overflow: 'hidden' },
};
// Undo is shown for 12 s, like the log toast; the api honours it 3 s longer so
// a tap landing as the chip leaves still counts.
const UNDO_SHOWN_MS = UNDO_WINDOW_MS - 3000;
const STEP_MAX = 40;

const fmtHeader = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtShort = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// The calendar date an event was entered on, in the zone it was entered in —
// never the reader's zone (time.js rule).
// A ts that doesn't parse gives null, so the caller leaves the date out.
function enteredOn(ev) {
  const ms = Date.parse(ev.ts);
  if (!Number.isFinite(ms)) return null;
  const off = ev.tzOffsetMin ?? -new Date(ms).getTimezoneOffset();
  const shifted = new Date(ms + (Number.isFinite(off) ? off : 0) * 60000);
  return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : null;
}

// A stored note is only shown or edited when it really is text.
const noteText = (r) => (typeof r?.note === 'string' ? r.note : '');
// Shown when the api refuses a save (returns null), until the next change.
function SaveFailed({ text }) {
  return <p role="alert" className="small faint" style={{ margin: '8px 0 0' }}>{text}</p>;
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
// The field holds what was typed as text and is clamped only on blur and on
// Save — clamping each keystroke turned "12" into 4 then 40.
function CorrectionForm({ state, day, cap }) {
  const { api } = useApp();
  const timed = timedPouchesForDay(state, day);
  const current = pouchesForDay(state, day);
  const correction = correctionForDay(state, day);
  const max = Math.max(STEP_MAX, current);
  const [text, setText] = useState(String(current));
  const [failed, setFailed] = useState(false);
  const clamp = (n) => Math.min(max, Math.max(timed, Math.round(n)));
  const parsed = text.trim() === '' ? NaN : Number(text);
  const valid = Number.isFinite(parsed);
  const total = valid ? clamp(parsed) : current;
  const over = total > cap;
  const dirty = valid && total !== current;
  const edit = (next) => { setText(next); setFailed(false); };
  const enteredDate = correction ? enteredOn(correction) : null;

  const stepBtn = (delta, label, Icon) => {
    const disabled = delta < 0 ? total <= timed : total >= max;
    return (
      <motion.button
        className="btn"
        onClick={() => edit(String(clamp(total + delta)))}
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
            value={text}
            min={timed}
            max={max}
            onChange={(e) => edit(e.target.value)}
            onBlur={() => setText(String(total))}
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
          Corrected{enteredDate ? ` ${fmtShort(enteredDate)}` : ''} · was {timed}
        </p>
      )}
      <p className="small faint" style={{ margin: '10px 0 0' }}>
        Filling this in keeps the log honest — it&rsquo;s the log that gets you to quit day, not the streak.
      </p>

      <motion.button
        className="btn btn-accent"
        disabled={!dirty}
        whileTap={dirty ? { scale: 0.98 } : undefined}
        onClick={() => {
          setText(String(total));
          if (!api.logCorrection({ day, count: total })) setFailed(true);
        }}
        style={{ width: '100%', marginTop: 14, opacity: dirty ? 1 : 0.45 }}
      >
        Save total
      </motion.button>
      {failed && <SaveFailed text="That didn’t save — check the number and try again." />}
    </div>
  );
}

// A small undo, offered while the api would still honour it. Shared by "Added"
// and "Marked" so the two read and behave the same.
function UndoChip({ label, onUndo }) {
  return (
    <motion.button type="button" className="chip" aria-label={label} whileTap={{ scale: 0.94 }} onClick={onUndo} style={{ flex: '0 0 auto', padding: '6px 14px', fontSize: 13 }}>
      <Undo2 size={14} /> Undo
    </motion.button>
  );
}

// undoEvent only takes the newest event, so once anything lands after ours the
// chip would promise what the api won't do. Hide it rather than lie.
const isNewest = (state, id) => state.events[state.events.length - 1]?.id === id;

// Inline editor for why one pouch happened. Saves the full set as a new
// reason event; the earlier one stays in history. Mark as mistake lives here,
// behind a confirm, because this is the one door to it (spec decision 6).
function ReasonEditor({ state, ev, onDone, onMarked }) {
  const { api, readOnly } = useApp();
  const existing = reasonFor(state, ev);
  const [picked, setPicked] = useState(() => triggersFor(state, ev).filter((t) => TRIGGERS.includes(t)));
  const [note, setNote] = useState(() => noteText(existing));
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const canSave = picked.length > 0 || note.trim() !== '';
  const toggle = (t) => {
    setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
    setFailed(false);
  };
  const mark = () => {
    const v = api.voidPouch(ev.id);
    if (!v) { setFailed(true); return; }
    onMarked(v);
    onDone();
  };

  return (
    <motion.div {...grow}>
      <div style={{ padding: '4px 2px 12px' }}>
        <ReasonFields picked={picked} note={note} onToggle={toggle} onNote={(v) => { setNote(v); setFailed(false); }} />
        {/* Three buttons don't fit one row at 390px, so Mark as mistake gets
            its own. The confirm replaces both rows, so the only buttons in
            reach while it's open are the two that answer it. */}
        <AnimatePresence mode="wait" initial={false}>
          {confirming ? (
            <motion.div key="confirm" {...grow}>
              <div style={{ paddingTop: 12 }}>
                <p className="small" style={{ margin: '2px 0 10px' }}>
                  Mark this pouch as a mistake? It stops counting; it stays in your history.
                </p>
                <div className="row" style={{ gap: 10 }}>
                  <motion.button className="btn btn-ghost" type="button" whileTap={{ scale: 0.98 }} onClick={() => { setConfirming(false); setFailed(false); }} style={{ flex: 1 }}>
                    Keep it
                  </motion.button>
                  <motion.button className="btn btn-accent" type="button" whileTap={{ scale: 0.98 }} onClick={mark} style={{ flex: 1 }}>
                    Confirm
                  </motion.button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="actions" {...grow}>
              <div style={{ paddingTop: 10 }}>
                {!readOnly && (
                  <motion.button className="btn btn-ghost" type="button" whileTap={{ scale: 0.98 }} onClick={() => { setConfirming(true); setFailed(false); }} style={{ width: '100%', marginBottom: 10 }}>
                    Mark as mistake
                  </motion.button>
                )}
                <div className="row" style={{ gap: 10 }}>
                  <motion.button className="btn btn-ghost" type="button" whileTap={{ scale: 0.98 }} onClick={onDone} style={{ flex: 1 }}>
                    Cancel
                  </motion.button>
                  <motion.button
                    className="btn btn-accent"
                    type="button"
                    disabled={!canSave}
                    whileTap={canSave ? { scale: 0.98 } : undefined}
                    onClick={() => { if (api.logReason({ target: ev.id, triggers: picked, note })) onDone(); else setFailed(true); }}
                    style={{ flex: 1, opacity: canSave ? 1 : 0.45 }}
                  >
                    Save reasons
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {failed && <SaveFailed text="That didn’t save — try again." />}
      </div>
    </motion.div>
  );
}

// Every pouch of the day, voided ones included — this is a drawing of the
// record, not a count. A voided row keeps its words readable — struck, in the
// muted grey, never red — with only the dot and "mistake" in faint, like
// History and Today's log. It no longer opens the editor: nothing is left to do.
function PouchList({ state, day }) {
  const { api } = useApp();
  const [editing, setEditing] = useState(null);
  const [marked, setMarked] = useState(null); // { id, voidId, until } after a mark
  const pouches = rawEventsForDay(state, day)
    .filter((e) => e.type === 'pouch')
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const anyLive = pouches.some((ev) => !pouchFlags(state, ev).voided);

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="tiny muted" style={{ marginBottom: 6 }}>Pouches</div>
      {pouches.length === 0 ? (
        <p className="small faint" style={{ margin: 0 }}>None logged yet.</p>
      ) : (
        <>
          {anyLive && <p className="small faint" style={{ margin: '0 0 6px' }}>Tap one to add why it happened, or to mark a mistake.</p>}
          {/* One list, one item per pouch, struck or not: a reader hears how
              many there were, and a mistake is still one of them. */}
          <div role="list">
            {pouches.map((ev, i) => {
              const { voided, late, untimed } = pouchFlags(state, ev);
              const v = pouchVerdict(state, ev);
              // Stored strings pass through asText: one that became an object
              // drops out instead of taking the sheet down.
              const tags = triggersFor(state, ev).map(asText).filter(Boolean);
              const slotLabel = asText(ev.ctx?.slotLabel);
              const note = noteText(reasonFor(state, ev));
              const open = editing === ev.id;
              const clock = untimed ? 'time unknown' : fmtTime(ev);
              const label = untimed ? 'Pouch, time unknown' : `Pouch at ${fmtTime(ev)}`;
              const strike = voided ? { textDecoration: 'line-through' } : null;
              const showMarked = voided && marked?.id === ev.id && Date.now() < marked.until;
              const facts = (
                <span className="small" style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 7px' }}>
                  <span className="muted num" style={strike}>{clock}</span>
                  {slotLabel && <><span className="faint">·</span><span className="muted" style={strike}>{slotLabel}</span></>}
                  {/* An untimed pouch's verdict is "time unknown" too — already said. */}
                  {!untimed && <><span className="faint">·</span><span style={{ color: voided ? 'var(--fg-muted)' : v.color, fontWeight: 500, ...strike }}>{v.text}</span></>}
                  {late && <><span className="faint">·</span><span className="faint">added later</span></>}
                  {tags.length > 0 && <><span className="faint">·</span><span className="faint">{tags.join(', ')}</span></>}
                  {note && <span className="faint" style={{ flexBasis: '100%', fontStyle: 'italic' }}>{note}</span>}
                </span>
              );
              return (
                <div
                  key={ev.id}
                  role="listitem"
                  aria-label={voided ? `${label}, marked as a mistake` : undefined}
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
                >
                  {voided ? (
                    <div style={{ padding: '10px 2px', minHeight: 44, display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--fg-faint)', flexShrink: 0 }} />
                      {facts}
                      {showMarked ? (
                        <span className="row" style={{ gap: 8, flexShrink: 0 }}>
                          <span className="small muted">Marked</span>
                          {isNewest(state, marked.voidId) && (
                            <UndoChip
                              label="Undo marking this pouch"
                              onUndo={() => {
                                // A frame can outlive the window by up to a tick after an unlock.
                                if (Date.now() < marked.until) api.undoEvent(marked.voidId);
                                setMarked(null);
                              }}
                            />
                          )}
                        </span>
                      ) : (
                        <span className="small faint" style={{ flexShrink: 0 }}>mistake</span>
                      )}
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={label}
                        aria-expanded={open}
                        onClick={() => setEditing(open ? null : ev.id)}
                        style={{ width: '100%', background: 'transparent', padding: '10px 2px', minHeight: 44, textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 9 }}
                      >
                        <span style={{ width: 8, height: 8, marginTop: 6, borderRadius: '50%', background: v.color, flexShrink: 0, opacity: 0.85 }} />
                        {facts}
                        <PencilLine size={14} color="var(--fg-faint)" style={{ flexShrink: 0, marginTop: 3 }} />
                      </button>
                      <AnimatePresence initial={false}>
                        {open && (
                          <ReasonEditor
                            key="edit"
                            state={state}
                            ev={ev}
                            onDone={() => setEditing(null)}
                            onMarked={(voidId) => setMarked({ id: ev.id, voidId, until: Date.now() + UNDO_SHOWN_MS })}
                          />
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// "16:30" for the current minute — today's starting guess, since a pouch you
// just remembered most often happened a moment ago.
function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Log a pouch that was missed, with the time it happened or "I don't remember".
// The resolved line and the "later than now" check come from latePouch.js, the
// same module the api validates with, so the sheet can't promise a save the api
// will refuse. Recomputed every render: `tick` re-renders each second, so a
// time that was "later than now" turns saveable as the clock reaches it.
function AddPouchCard({ day }) {
  const { api, state } = useApp();
  const isToday = day === todayKey();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(() => (isToday ? nowHM() : '12:00'));
  const [unknown, setUnknown] = useState(false);
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState(null); // { id, until } after a save
  // Once per open: after a save the form plays its closing animation with Save
  // still on screen, and a second tap would append a second pouch that undo
  // can't reach. Set before the api call, cleared on a failed save or when the card reopens.
  const [saved, setSaved] = useState(false);
  const resolved = resolveLate({ day, time: unknown ? null : time });
  const canSave = resolved.ok && !resolved.future && !saved;
  const showAdded = added && Date.now() < added.until;

  // Opening starts clean, and today's guess is the minute it opens, not the
  // minute the sheet first rendered.
  const toggleOpen = () => {
    if (!open) {
      setTime(isToday ? nowHM() : '12:00');
      setUnknown(false);
      setPicked([]);
      setNote('');
      setFailed(false);
      setAdded(null);
      setSaved(false);
    }
    setOpen(!open);
  };
  const toggle = (t) => {
    setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
    setFailed(false);
  };
  const save = () => {
    if (saved) return;
    setSaved(true);
    const id = api.logLatePouch({ day, time: unknown ? null : time, triggers: picked, note });
    if (!id) { setSaved(false); setFailed(true); return; }
    setAdded({ id, until: Date.now() + UNDO_SHOWN_MS });
    setOpen(false);
  };

  let line;
  if (resolved.skipped) line = <span style={{ color: 'var(--fg-muted)' }}>that time didn’t exist — clocks went forward</span>;
  else if (resolved.future) line = `${fmtHM(time)} — that’s later than now`;
  else if (!resolved.ok) line = `${fmtHeader(day)} · pick a time`;
  else {
    line = (
      <>
        {`${fmtHeader(day)} · ${unknown ? 'time unknown' : fmtHM(time)}`}
        {resolved.nextCalendarDay && <span className="faint" style={{ fontWeight: 400 }}>{` · counts toward ${fmtShort(day)} (days run to 4 AM)`}</span>}
      </>
    );
  }

  return (
    <div className="card" style={{ marginTop: 14, padding: '4px 18px' }}>
      <AnimatePresence mode="wait" initial={false}>
        {showAdded ? (
          <motion.div key="added" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring}
            className="spread" style={{ minHeight: 48, padding: '6px 0' }}>
            <span role="status" aria-live="polite" className="row" style={{ gap: 8, color: 'var(--green)', fontWeight: 600 }}>
              <Check size={18} /> Added
            </span>
            {isNewest(state, added.id) && (
              <UndoChip
                label="Undo adding this pouch"
                onUndo={() => {
                  if (Date.now() < added.until) api.undoEvent(added.id);
                  setAdded(null);
                }}
              />
            )}
          </motion.div>
        ) : (
          <motion.button
            key="row"
            type="button"
            aria-label="Add a pouch"
            aria-expanded={open}
            onClick={toggleOpen}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            style={{ width: '100%', background: 'transparent', minHeight: 48, padding: '10px 0', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}
          >
            <span style={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
              {/* The plus turns into a close mark: the same tap folds it away. */}
              <motion.span animate={{ rotate: open ? 45 : 0 }} transition={spring} style={{ display: 'grid' }}>
                <Plus size={16} color="var(--accent-bright)" />
              </motion.span>
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>Add a pouch</span>
              <span className="small faint">one you missed, with its time</span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {open && (
          // A closing form takes no taps: Save is still drawn while it folds away.
          <motion.div key="form" {...grow} style={saved ? { pointerEvents: 'none' } : undefined}>
            <div style={{ padding: '4px 0 16px' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="time"
                  aria-label="Time"
                  value={time}
                  disabled={unknown}
                  onChange={(e) => { setTime(e.target.value); setFailed(false); }}
                  style={{ flex: '1 1 120px', width: 'auto', minWidth: 0, minHeight: 44, padding: '0 12px', fontSize: 16, borderRadius: 12, border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--fg)', opacity: unknown ? 0.45 : 1 }}
                />
                <motion.button
                  type="button"
                  className={`chip ${unknown ? 'selected' : ''}`}
                  aria-pressed={unknown}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => { setUnknown((u) => !u); setFailed(false); }}
                  style={{ flex: '0 0 auto', padding: '8px 14px', fontSize: 13 }}
                >
                  {"I don't remember the time"}
                </motion.button>
              </div>

              <div className="tiny muted" style={{ margin: '16px 0 8px' }}>Why · optional</div>
              <ReasonFields picked={picked} note={note} onToggle={toggle} onNote={(v) => { setNote(v); setFailed(false); }} />

              <p role="status" aria-live="polite" className="small num" style={{ margin: '14px 0 0', fontWeight: 500, color: resolved.future ? 'var(--fg-muted)' : 'var(--fg)' }}>
                {line}
              </p>

              <div className="row" style={{ gap: 10, marginTop: 12 }}>
                <motion.button className="btn btn-ghost" type="button" whileTap={{ scale: 0.98 }} onClick={() => setOpen(false)} style={{ flex: 1 }}>
                  Cancel
                </motion.button>
                <motion.button
                  className="btn btn-accent"
                  type="button"
                  disabled={!canSave}
                  whileTap={canSave ? { scale: 0.98 } : undefined}
                  onClick={save}
                  style={{ flex: 1, opacity: canSave ? 1 : 0.45 }}
                >
                  Save pouch
                </motion.button>
              </div>
              {failed && <SaveFailed text="That didn’t save — check the time and try again." />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Fix a day — a past one, or today while it's still being lived. Everything
// here appends: a backfill, a correction, a reason, a remembered pouch, or a
// void. Nothing logged is ever rewritten.
export default function FixDaySheet({ day, onClose }) {
  const { state, readOnly } = useApp();
  const n = dayNumberFor(state, day);
  const cap = capForDay(state.plan, n);
  const status = statusForDay(state, day);
  const isToday = status === 'today-under' || status === 'today-over';
  // Plan day 1 through today (past quit day too); never a baseline day.
  const canAdd = n >= 1 && day <= todayKey() && !readOnly;
  // A day whose only pouches were marked as mistakes is nolog again, but its
  // struck rows are still its history and still drawn.
  const hasPouches = rawEventsForDay(state, day).some((e) => e.type === 'pouch');

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

        {(status === 'green' || status === 'yellow') && n <= state.plan.totalDays && (
          <CorrectionForm key={`${day}:${correctionForDay(state, day)?.id ?? ''}`} state={state} day={day} cap={cap} />
        )}

        {isToday && canAdd && (
          <p className="small muted" style={{ margin: '14px 0 0' }}>
            {"Today's total comes from the log — add one you missed below."}
          </p>
        )}

        {canAdd && <AddPouchCard key={day} day={day} />}

        {(status !== 'nolog' || hasPouches) && <PouchList state={state} day={day} />}

        <button className="btn btn-ghost" type="button" onClick={onClose} style={{ width: '100%', marginTop: 16 }}>
          Done
        </button>
      </motion.div>
    </>
  );
}
