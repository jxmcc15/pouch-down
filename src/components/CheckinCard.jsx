import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ChevronDown, Dumbbell } from 'lucide-react';
import { useApp } from '../state.jsx';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Morning health check-in for the Today tab. The parent owns visibility
// (renders only when today has no check-in and isn't dismissed), so this
// component just collects an answer and logs it — no local "saved" state.
export default function CheckinCard() {
  const { api } = useApp();
  const [sleepQuality, setSleepQuality] = useState(null); // 1–5, or null = unanswered
  const [workout, setWorkout] = useState(false);
  const [workoutTouched, setWorkoutTouched] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The exact-number fields hold a raw draft string (SettingsSheet's numberField
  // idiom) so they can sit empty mid-edit. Here the draft IS the value — this
  // card writes no settings, so there's nothing to commit or revert on blur;
  // we simply validate at save time.
  const [hoursRaw, setHoursRaw] = useState('');
  const [scoreRaw, setScoreRaw] = useState('');

  const hoursNum = Number(hoursRaw);
  const hoursValid =
    hoursRaw.trim() !== '' && Number.isFinite(hoursNum) && hoursNum >= 0 && hoursNum <= 14;
  const scoreNum = Number(scoreRaw);
  const scoreValid =
    scoreRaw.trim() !== '' && Number.isFinite(scoreNum) && scoreNum >= 0 && scoreNum <= 100;

  // Enabled once the user has actually answered something: a sleep dot, an
  // explicit workout tap (either direction counts as an answer), or a valid
  // exact number. This keeps an all-default empty check-in from being saved.
  const canSave = sleepQuality != null || workoutTouched || hoursValid || scoreValid;

  const save = () => {
    if (!canSave) return;
    const payload = { workout, source: 'manual' };
    if (sleepQuality != null) payload.sleepQuality = sleepQuality;
    if (hoursValid) payload.sleepHours = hoursNum;
    if (scoreValid) payload.sleepScore = scoreNum;
    api.logCheckin(payload);
    // Once the event lands the parent stops rendering this card — nothing else to do.
  };

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={spring}
    >
      <div className="spread">
        <span className="tiny muted">Morning check-in</span>
        <button
          aria-label="Dismiss check-in for today"
          onClick={() => api.dismissCheckinToday()}
          style={{
            display: 'inline-flex',
            padding: 8,
            margin: -8,
            minHeight: 'auto',
            color: 'var(--fg-faint)',
            background: 'none',
          }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ marginTop: 14, fontSize: 15, fontWeight: 500 }}>How'd you sleep?</div>
      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        {[1, 2, 3, 4, 5].map((q) => {
          const on = sleepQuality != null && q <= sleepQuality;
          return (
            <motion.button
              key={q}
              onClick={() => setSleepQuality(q)}
              whileTap={{ scale: 0.9 }}
              aria-label={`Sleep quality ${q} of 5`}
              aria-pressed={sleepQuality === q}
              style={{
                flex: 1,
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                padding: 0,
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: on ? 'var(--accent)' : 'var(--surface)',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
                  boxShadow: on ? '0 0 10px var(--accent-glow)' : 'none',
                  transition: 'background 120ms var(--ease), border-color 120ms var(--ease)',
                }}
              />
            </motion.button>
          );
        })}
      </div>
      <div className="spread" style={{ marginTop: 6 }}>
        <span className="small faint">rough</span>
        <span className="small faint">great</span>
      </div>

      <motion.button
        className={`chip${workout ? ' selected' : ''}`}
        onClick={() => {
          setWorkout((v) => !v);
          setWorkoutTouched(true);
        }}
        whileTap={{ scale: 0.96 }}
        aria-pressed={workout}
        style={{ marginTop: 16 }}
      >
        <Dumbbell size={15} />
        worked out
      </motion.button>

      <div style={{ marginTop: 14 }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="small faint"
          aria-expanded={expanded}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            minHeight: 'auto',
            padding: '4px 0',
            background: 'none',
          }}
        >
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={spring}
            style={{ display: 'inline-flex' }}
          >
            <ChevronDown size={14} />
          </motion.span>
          add exact numbers
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="exact"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            style={{ overflow: 'hidden' }}
          >
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="ci-hours">sleep hours</label>
                <input
                  id="ci-hours"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="14"
                  step="0.1"
                  placeholder="7.5"
                  value={hoursRaw}
                  onChange={(e) => setHoursRaw(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="ci-score">sleep score</label>
                <input
                  id="ci-score"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="82"
                  value={scoreRaw}
                  onChange={(e) => setScoreRaw(e.target.value)}
                />
              </div>
            </div>
            <p className="small faint" style={{ margin: '8px 0 0' }}>
              Optional — hours 0–14, score 0–100 if your watch gives one.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        className="btn btn-accent"
        onClick={save}
        disabled={!canSave}
        whileTap={canSave ? { scale: 0.98 } : undefined}
        style={{
          width: '100%',
          marginTop: 18,
          opacity: canSave ? 1 : 0.45,
          cursor: canSave ? 'pointer' : 'default',
        }}
      >
        Save check-in
      </motion.button>
    </motion.div>
  );
}
