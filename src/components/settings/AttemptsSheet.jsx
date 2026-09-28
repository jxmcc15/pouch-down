import { useState } from 'react';
import { motion } from 'framer-motion';
import { History } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { isLogged, dateForDayNumber, asOfDay, dayNumberFor } from '../../store.js';
import { stageForDay } from '../../plan.js';
import { asText } from '../../text.js';
import SubSheet from './SubSheet.jsx';

const fmtShort = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Days with a log behind them, from day 1 up to day `upToN`. Silence is never
// counted: a day only counts if isLogged says something was logged.
const loggedDaysIn = (attempt, upToN = attempt.plan.totalDays) => {
  let n = 0;
  for (let i = 1; i <= Math.min(upToN, attempt.plan.totalDays); i++) {
    if (isLogged(attempt, dateForDayNumber(attempt, i))) n++;
  }
  return n;
};

// The attempt you're on, the ones behind you, and — live only — the way out.
// Both actions here leave Settings entirely, so `onClose` closes everything.
export default function AttemptsSheet({ onClose }) {
  const { state, root, api, readOnly } = useApp();
  const [confirmEnd, setConfirmEnd] = useState(false);

  const past = root.attempts.filter((a) => a.id !== state.id && a.status === 'archived');
  // Attempts copy has to be true in every state: viewing a past attempt (with
  // or without an active one to go back to), or on the active attempt with or
  // without earlier ones.
  const exitTo = root.activeAttemptId ? 'get back to your current attempt' : 'start a new one';
  const attemptsNote = readOnly
    ? past.length > 0
      ? `You're viewing a past attempt, read-only. Open another below, or exit at the top to ${exitTo}.`
      : `You're viewing a past attempt, read-only. Exit at the top to ${exitTo}.`
    : past.length > 0
      ? 'Nothing is ever deleted. Open one to look back at it.'
      : 'This is your first attempt. Past ones show up here once you start a new one.';

  // Judged as of the attempt's own day — today while live, its end once
  // archived — and held to the plan, so a past attempt never reads as ongoing.
  const asOfN = Math.min(Math.max(dayNumberFor(state, asOfDay(state)), 0), state.plan.totalDays);
  const stage = asOfN >= 1 ? stageForDay(state.plan, asOfN) : null;

  return (
    <SubSheet label="Attempts" onClose={onClose}>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="tiny muted">{readOnly ? 'Viewing' : 'Current'}</div>
        <div style={{ fontWeight: 700, fontSize: 17, marginTop: 4 }}>Attempt {state.id.slice(1)}</div>
        <div className="small muted num" style={{ marginTop: 2 }}>
          {fmtShort(state.plan.startDate)} → {fmtShort(state.plan.quitDate)} ·{' '}
          {asOfN >= 1 ? `day ${asOfN} of ${state.plan.totalDays}` : 'not started yet'}
          {stage ? ` · ${asText(stage.name)}` : ''}
        </div>
        {asOfN >= 1 && (
          <div className="small faint num" style={{ marginTop: 2 }}>
            {loggedDaysIn(state, asOfN)} of {asOfN} days logged{readOnly ? '' : ' so far'}
          </div>
        )}
      </div>

      <div className="section-head">Past attempts</div>
      <p className="small muted" style={{ margin: 0 }}>
        {attemptsNote}
      </p>
      {past.map((a) => (
        <motion.button
          key={a.id}
          className="btn"
          style={{ width: '100%', marginTop: 8, justifyContent: 'flex-start', minHeight: 52 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            api.viewAttempt(a.id);
            onClose();
          }}
        >
          <History size={16} />
          <span style={{ textAlign: 'left' }}>
            Attempt {a.id.slice(1)}
            <span className="small faint" style={{ display: 'block', fontWeight: 400 }}>
              {fmtShort(a.plan.startDate)} – {fmtShort(a.plan.quitDate)} ·{' '}
              {loggedDaysIn(a)} of {a.plan.totalDays} days logged
            </span>
          </span>
        </motion.button>
      ))}

      {/* Never one tap: the red button only asks, and the confirm says exactly
          what ending costs before anything happens. */}
      {!readOnly && (
        <div className="danger-zone">
          <div className="section-head">Danger zone</div>
          {confirmEnd ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <p className="small" style={{ margin: 0 }}>
                Your history stays, read-only. You can't reopen this attempt.
                Next, you'll set up a new plan.
              </p>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <motion.button
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    api.archiveActive();
                    onClose();
                  }}
                >
                  End attempt
                </motion.button>
                <motion.button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setConfirmEnd(false)}
                >
                  Keep going
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <>
              <motion.button
                className="btn btn-danger"
                style={{ width: '100%' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setConfirmEnd(true)}
              >
                End this attempt and start over
              </motion.button>
              <p className="small faint" style={{ margin: '8px 0 0' }}>
                Asks you to confirm first. Nothing is deleted.
              </p>
            </>
          )}
        </div>
      )}
    </SubSheet>
  );
}
