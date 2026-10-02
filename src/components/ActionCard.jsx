import { AnimatePresence, motion } from 'framer-motion';
import { Ban, CalendarPlus, Check, CircleAlert, Clock, PencilLine, Plus, ShieldCheck, Sunrise, Tag, TriangleAlert, Undo2 } from 'lucide-react';

const spring = { type: 'spring', damping: 26, stiffness: 240 };
// Grows from nothing and folds away on the same spring as Fix this day's
// editors. The card uses it on arrival; each state's footer uses it too, so a
// tap reads as "the choice folds away, the result unfolds" instead of a jump.
const grow = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: spring,
};

const ICON = {
  log_pouch_now: Plus,
  log_resisted_now: ShieldCheck,
  add_late_pouch: Clock,
  mark_mistake: Ban,
  add_reason: Tag,
  fill_missed_day: CalendarPlus,
  correct_day_total: PencilLine,
  log_checkin: Sunrise,
};
// `name` came from the model; only the table's own keys may pick a component.
const iconFor = (name) => (Object.hasOwn(ICON, name) ? ICON[name] : CircleAlert);

const TAP = { minHeight: 44 };
// The footer clips while its height springs, which would also clip a button's
// focus ring (2px at a 3px offset). Six pixels of room, taken back by the
// negative margin, keep the ring whole without moving anything.
const RING = 6;

// One thing the coach proposed, as a receipt: the headline and the facts the
// app would write — both built by coachActions.js from the validated values,
// never the model's own words — and the user's two choices. A card is never a
// form: a wrong one is skipped and corrected in chat. Pure props, so the sheet
// owns every state change (and the Undo window, through `undoable`) and the
// render guards can draw each state.
//
// card.status: 'pending' | 'saved' | 'refused' | 'skipped' | 'invalid' | 'undone'
export default function ActionCard({ card, busy = false, undoable = false, onConfirm, onSkip, onUndo }) {
  const invalid = card.status === 'invalid';
  const Icon = invalid ? CircleAlert : iconFor(card.name);
  const headline = invalid ? "The coach proposed something the app can't do" : card.action.summary;
  const struck = card.status === 'skipped' || card.status === 'undone';
  const muted = struck || invalid;
  const tap = busy ? undefined : { scale: 0.98 };

  return (
    <motion.div
      {...grow}
      role="group"
      aria-label={invalid ? 'Proposed action the app can’t do' : `Proposed: ${headline}`}
      className="card"
      style={{ overflow: 'hidden', padding: '12px 14px', marginTop: 8 }}
    >
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Icon size={18} color={muted ? 'var(--fg-faint)' : 'var(--accent-bright)'} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, color: muted ? 'var(--fg-muted)' : 'var(--fg)', textDecoration: struck ? 'line-through' : 'none' }}>
            {headline}
          </div>
          <div className="small faint" style={{ marginTop: 2, lineHeight: 1.4 }}>{invalid ? card.reason : card.action.facts}</div>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={card.status} {...grow} style={{ overflow: 'hidden', padding: RING, margin: -RING }}>
          {card.status === 'pending' && (
            <div className="row" style={{ marginTop: 12 }}>
              <motion.button type="button" className="btn btn-ghost" aria-label={`Skip: ${headline}`} disabled={busy} whileTap={tap} onClick={onSkip} style={{ ...TAP, flex: 1, opacity: busy ? 0.5 : 1 }}>
                Skip
              </motion.button>
              <motion.button type="button" className="btn btn-accent" aria-label={`Confirm: ${headline}`} disabled={busy} whileTap={tap} onClick={onConfirm} style={{ ...TAP, flex: 1, opacity: busy ? 0.5 : 1 }}>
                Confirm
              </motion.button>
            </div>
          )}
          {card.status === 'saved' && (
            // The row keeps its 44px when the Undo chip leaves, so the card
            // doesn't twitch the moment the window closes.
            <div className="spread" style={{ marginTop: 8, minHeight: 44 }}>
              <span role="status" className="row" style={{ gap: 6, color: 'var(--green)', fontWeight: 600, fontSize: 14 }}>
                <Check size={16} aria-hidden="true" /> Saved
              </span>
              <AnimatePresence initial={false}>
                {undoable && (
                  <motion.button
                    key="undo"
                    type="button"
                    className="chip"
                    aria-label={`Undo: ${headline}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={spring}
                    whileTap={{ scale: 0.94 }}
                    onClick={onUndo}
                    style={{ ...TAP, flex: '0 0 auto', padding: '6px 14px', fontSize: 13 }}
                  >
                    <Undo2 size={14} aria-hidden="true" /> Undo
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}
          {card.status === 'refused' && (
            <p role="status" className="small row" style={{ gap: 6, margin: '10px 0 0', color: 'var(--amber)', alignItems: 'flex-start' }}>
              <TriangleAlert size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{`Didn’t save — ${card.reason}`}</span>
            </p>
          )}
          {card.status === 'skipped' && <p role="status" className="small faint" style={{ margin: '8px 0 0' }}>Skipped — nothing saved</p>}
          {card.status === 'undone' && <p role="status" className="small faint" style={{ margin: '8px 0 0' }}>Undone — nothing saved</p>}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
