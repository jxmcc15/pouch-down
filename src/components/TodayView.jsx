import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, PiggyBank, ShieldCheck } from 'lucide-react';
import { useApp } from '../state.jsx';
import {
  pacingForNow, todayKey, dayNumberFor, dateForDayNumber, pouchesForDay, resistedForDay,
  currentStreak, checkinForDay,
} from '../store.js';
import { stageForDay, capForDay, WITHDRAWAL_NOTES } from '../plan.js';
import { moneyStats } from '../money.js';
import LogRing from './LogRing.jsx';
import LogToast from './LogToast.jsx';
import TodayLog from './TodayLog.jsx';
import CheckinCard from './CheckinCard.jsx';
import PacingCard from './PacingCard.jsx';
import SOSOverlay from './SOSOverlay.jsx';
import RecoveryTimeline from './RecoveryTimeline.jsx';
import AnimatedNumber from './AnimatedNumber.jsx';
import BackfillPrompt from './BackfillPrompt.jsx';
import { ReadOnlySummaryCard } from './ReadOnlyBanner.jsx';
import { celebrate } from '../confetti.js';

// The toast doubles as the mood-tag window, so it outlives the old 6s.
const TOAST_MS = 12000;

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Parsed at noon so the calendar date (and its weekday) can't shift with the
// device's zone — same trick store.js uses for day math.
function formatWeekdayMonthDay(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}
function formatMonthDay(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric',
  });
}

export default function TodayView() {
  const { state, api, tick, readOnly } = useApp();
  const [sosOpen, setSosOpen] = useState(false);
  const [lastLog, setLastLog] = useState(null); // {id, until}

  const dateStr = todayKey();
  const dayNum = dayNumberFor(state, dateStr);
  const stage = stageForDay(state.plan, Math.min(Math.max(dayNum, 1), state.plan.totalDays));
  const used = pouchesForDay(state, dateStr);
  const cap = capForDay(state.plan, dayNum);
  const resisted = resistedForDay(state, dateStr);
  const streak = currentStreak(state);
  const saved = moneyStats(state).kept;
  const pacing = pacingForNow(state);
  const postQuit = dayNum > state.plan.totalDays;
  const prePlan = dayNum < 1;
  const quitDay = dayNum === state.plan.totalDays;
  // Pre-plan card facts: the first real (non-quit) stage's strength, and the
  // first later stage that steps it down, if the plan ever does.
  const firstStage = state.plan.stages[0];
  const nextMgStage = prePlan
    ? state.plan.stages.find((s) => s.pouchesPerDay > 0 && s.mg < firstStage.mg)
    : null;

  // Celebrate completed stages once (entering a new stage fires confetti).
  // Never while viewing a past attempt: the api no-ops on an archived attempt,
  // so the celebration would replay on every open without ever being recorded.
  useEffect(() => {
    if (readOnly || prePlan || postQuit || !stage) return;
    const completed = state.plan.stages.filter((s) => s.days[1] < dayNum && s.pouchesPerDay > 0);
    const uncelebrated = completed.find((s) => !state.celebratedStages.includes(s.id));
    if (uncelebrated) {
      api.markStageCelebrated(uncelebrated.id);
      setTimeout(celebrate, 600);
    }
  }, [dayNum, prePlan, postQuit, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const logPouch = (trigger = null) => {
    const id = api.logPouch(trigger);
    setLastLog({ id, until: Date.now() + TOAST_MS });
  };

  useEffect(() => {
    if (!lastLog) return;
    const id = setTimeout(() => setLastLog(null), lastLog.until - Date.now());
    return () => clearTimeout(id);
  }, [lastLog]);

  if (postQuit) {
    return <RecoveryTimeline />;
  }

  return (
    <div>
      {prePlan && (
        <motion.div className="card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <div style={{ fontWeight: 600 }}>
            Day 1 is {formatWeekdayMonthDay(state.plan.startDate)}.
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Logging now builds your honest baseline — no caps judged yet. Stock
            check: you have {firstStage.mg}mg on hand
            {nextMgStage
              ? `; ${nextMgStage.mg}mg isn't needed until ${formatMonthDay(dateForDayNumber(state, nextMgStage.days[0]))}.`
              : '.'}
          </div>
        </motion.div>
      )}

      {!prePlan && stage && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="spread"
          style={{ marginBottom: 4 }}
        >
          <div>
            <div className="tiny muted">
              Day {dayNum} of {state.plan.totalDays} · Stage {stage.id === 8 ? '— quit' : stage.id}
            </div>
            <h2 style={{ fontSize: 20 }}>{stage.name}</h2>
          </div>
          <div className="card num" style={{ padding: '8px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              <AnimatedNumber value={Math.max(state.plan.totalDays - dayNum, 0)} />
            </div>
            <div className="tiny faint">days to quit</div>
          </div>
        </motion.div>
      )}

      {!prePlan && stage?.tagline && (
        <motion.p
          className="small muted"
          style={{ margin: '2px 0 0' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          {stage.tagline}
        </motion.p>
      )}

      {/* Viewing a past attempt: the api already no-ops every mutation, so this
          is purely about not showing controls that would do nothing. */}
      {readOnly ? (
        <ReadOnlySummaryCard />
      ) : (
        <>
          <AnimatePresence>
            {!checkinForDay(state, dateStr) && state.checkinDismissedFor !== dateStr && (
              <CheckinCard key="checkin" />
            )}
          </AnimatePresence>

          <BackfillPrompt />

          <LogRing
            used={used}
            cap={cap}
            mg={prePlan ? firstStage.mg : stage?.mg ?? 0}
            onLog={() => logPouch(null)}
            disabled={quitDay || (stage && stage.pouchesPerDay === 0)}
          />

          <AnimatePresence>
            {lastLog && (
              <LogToast key={lastLog.id} eventId={lastLog.id} onUndo={() => setLastLog(null)} />
            )}
          </AnimatePresence>
        </>
      )}

      {pacing.mode === 'plan' && <PacingCard pacing={{ ...pacing, tick }} />}

      <TodayLog />

      <motion.div
        className="row"
        style={{ marginTop: 14, gap: 14 }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.1 }}
      >
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <Flame size={18} color={streak > 0 ? 'var(--amber)' : 'var(--fg-faint)'} style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 800 }} className="num">
            <AnimatedNumber value={streak} />
          </div>
          <div className="tiny faint">day streak</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <PiggyBank size={18} color="var(--green)" style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }} className="num">
            <AnimatedNumber value={saved} format={(v) => `$${v.toFixed(2)}`} />
          </div>
          <div className="tiny faint">saved vs old habit</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <ShieldCheck size={18} color="var(--accent-bright)" style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 800 }} className="num">
            <AnimatedNumber value={resisted} />
          </div>
          <div className="tiny faint">resisted today</div>
        </div>
      </motion.div>

      {!readOnly && (
        <motion.button
          className="btn"
          style={{
            width: '100%',
            marginTop: 14,
            minHeight: 56,
            fontSize: 17,
            background: 'rgba(248,113,113,0.10)',
            border: '1px solid rgba(248,113,113,0.35)',
            color: 'var(--red)',
          }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setSosOpen(true)}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.15 }}
        >
          Craving? SOS — ride it out
        </motion.button>
      )}

      {!prePlan && dayNum >= 1 && (
        <motion.p
          className="small faint"
          style={{ textAlign: 'center', marginTop: 14 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {quitDay
            ? `Quit day. ${WITHDRAWAL_NOTES.postQuit}`
            : stage && dayNum === stage.days[0] && stage.id > 1
              ? WITHDRAWAL_NOTES.stageFlip
              : `Quit date: ${state.plan.quitDate} · slips never move it.`}
        </motion.p>
      )}

      <AnimatePresence>
        {sosOpen && (
          <SOSOverlay
            onClose={() => setSosOpen(false)}
            onResisted={(trigger) => {
              api.logResisted(trigger);
              setSosOpen(false);
            }}
            onUsed={(trigger) => {
              logPouch(trigger);
              setSosOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
