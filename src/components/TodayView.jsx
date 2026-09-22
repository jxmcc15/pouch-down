import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { useApp } from '../state.jsx';
import {
  pacingForNow, todayKey, dayNumberFor, pouchesForDay, resistedForDay,
  checkinForDay,
} from '../store.js';
import { stageForDay, capForDay, WITHDRAWAL_NOTES } from '../plan.js';
import { UNDO_WINDOW_MS } from '../justLogged.js';
import LogRing from './LogRing.jsx';
import LogToast from './LogToast.jsx';
import TodayLog from './TodayLog.jsx';
import CheckinCard from './CheckinCard.jsx';
import PacingCard from './PacingCard.jsx';
import SOSOverlay from './SOSOverlay.jsx';
import RecoveryTimeline from './RecoveryTimeline.jsx';
import AnimatedNumber from './AnimatedNumber.jsx';
import BackfillPrompt from './BackfillPrompt.jsx';
import MoneyCard from './MoneyCard.jsx';
import StreakChip from './awards/StreakChip.jsx';
import { TrophyTile } from './awards/TrophyCase.jsx';
import { ReadOnlySummaryCard } from './ReadOnlyBanner.jsx';
import { celebrate } from '../confetti.js';

// The toast must close inside the api's undo window, or its Undo would do nothing.
const TOAST_MS = Math.min(12000, UNDO_WINDOW_MS);

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

// Quit day is marked by kind in generated plans; attempt 1's hand-written plan
// predates `kind`, and there the quit stage is the only one with no pouches.
// Never the stage number — that differs from plan to plan.
const isQuitStage = (stage) => stage.kind === 'quit' || stage.pouchesPerDay === 0;

// `openTrophies` opens the trophy case from App.jsx rather than from here on
// purpose: `.sheet` is position:fixed, and a fixed element inside the tab
// wrapper would anchor to Framer's transform on that wrapper instead of to the
// viewport. Every other sheet in the app is mounted at the top level for the
// same reason, next to openSettings.
export default function TodayView({ openSettings, openTrophies }) {
  const { state, api, tick, readOnly } = useApp();
  const [sosOpen, setSosOpen] = useState(false);
  const [lastLog, setLastLog] = useState(null); // {id, until}

  const dateStr = todayKey();
  const dayNum = dayNumberFor(state, dateStr);
  const stage = stageForDay(state.plan, Math.min(Math.max(dayNum, 1), state.plan.totalDays));
  const used = pouchesForDay(state, dateStr);
  const cap = capForDay(state.plan, dayNum);
  const resisted = resistedForDay(state, dateStr);
  const pacing = pacingForNow(state);
  const postQuit = dayNum > state.plan.totalDays;
  const prePlan = dayNum < 1;
  const quitDay = dayNum === state.plan.totalDays;
  // Pre-plan card facts: the first stage's strength (what the ring shows), and
  // the plan's first shopping stop — the stage that steps the strength down —
  // if the plan ever does.
  const firstStage = state.plan.stages[0];
  const firstShop = prePlan ? state.plan.stages.find((s) => s.shopBefore) : null;

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
  // The timer alone isn't enough: iOS suspends timers while the phone is
  // locked, so on unlock it may not have fired yet. This re-checks on every
  // render, and the 1s tick from state.jsx re-renders this view, so a pouch
  // logged hours ago never comes back with an Undo on it.
  const toastLive = lastLog != null && Date.now() < lastLog.until;

  // Order matters: a past attempt whose quit day has come and gone would
  // otherwise render the "Nicotine-free — N days" clock, which counts elapsed
  // calendar time and asks for no evidence at all. Attempt 1 ended in silence,
  // so that clock would be the app telling a comfortable lie about a plan that
  // did not hold. Silence is never success — show the record instead.
  if (readOnly) return <ReadOnlySummaryCard />;
  if (postQuit) {
    return <RecoveryTimeline />;
  }

  return (
    <div>
      {prePlan && (
        <motion.div className="card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <div style={{ fontWeight: 600 }}>
            {dayNum === 0
              ? `Day 1 is tomorrow — ${formatWeekdayMonthDay(state.plan.startDate)}.`
              : `Day 1 is ${formatWeekdayMonthDay(state.plan.startDate)}.`}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Log anything you use — there's no cap yet.
            {firstShop &&
              ` You won't need ${firstShop.mg}mg until ${formatMonthDay(firstShop.shopBefore.date)}.`}
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
              {/* Quit day's heading below already says "Quit day"; say it once. */}
              Day {dayNum} of {state.plan.totalDays}
              {isQuitStage(stage) ? '' : ` · Stage ${stage.id}`}
            </div>
            <h2 style={{ fontSize: 20 }}>{stage.name}</h2>
            <StreakChip onOpenTrophies={openTrophies} />
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
        quitDay={quitDay}
        prePlan={prePlan}
      />

      <AnimatePresence>
        {toastLive && (
          <LogToast
            key={lastLog.id}
            eventId={lastLog.id}
            until={lastLog.until}
            onDone={() => setLastLog(null)}
          />
        )}
      </AnimatePresence>

      {pacing.mode === 'plan' && <PacingCard pacing={{ ...pacing, tick }} />}

      <TodayLog />

      <motion.div
        className="row"
        style={{ marginTop: 14, gap: 14 }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.1 }}
      >
        {/* The streak moved up into the header as a chip (StreakChip) — it is
            the first thing worth seeing, and one streak display is enough. Its
            old slot here goes to the trophy count, which doubles as the second
            door into the case. */}
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <ShieldCheck size={18} color="var(--accent-bright)" style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 800 }} className="num">
            <AnimatedNumber value={resisted} />
          </div>
          <div className="tiny faint">resisted today</div>
        </div>
        <TrophyTile onOpen={openTrophies} />
      </motion.div>

      {/* The old flat "saved" tile couldn't carry the caveat that makes the
          number honest, so the money lives in one card that states what it
          counted. */}
      <div style={{ marginTop: 14 }}>
        <MoneyCard onOpenSettings={openSettings} />
      </div>

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
              : `Quit date: ${formatWeekdayMonthDay(state.plan.quitDate)} · slips never move it.`}
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
