import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { lastSettings } from '../../root.js';
import { todayKey } from '../../store.js';
import { generatePlan, MIN_LENGTH_DAYS } from '../../planGenerator.js';
import PriceHelpSheet from './PriceHelpSheet.jsx';
import PlanPreview from './PlanPreview.jsx';
import {
  CountStep,
  StrengthStep,
  LowerStrengthsStep,
  LengthStep,
  StartDateStep,
  RhythmStep,
  PriceStep,
} from './steps.jsx';

// The setup walkthrough: one question per screen, nothing written to storage
// until Begin. `first` means no attempts exist yet, so screen 1 has nowhere to
// go back to; `onExit` returns to the Front door.

const STRENGTHS = [2, 3, 4, 6, 8, 9, 12, 15];
const MAX_LENGTH_DAYS = 365;
const MAX_PER_DAY = 40;
const MAX_START_AHEAD_DAYS = 365;
const spring = { type: 'spring', damping: 26, stiffness: 240 };

// Forward slides in from the right and out to the left; Back mirrors it. The
// direction is read through AnimatePresence's `custom`, which is the only way
// the *leaving* screen learns which way the flow just went.
const slide = {
  enter: (d) => ({ opacity: 0, x: d * 28 }),
  center: { opacity: 1, x: 0 },
  leave: (d) => ({ opacity: 0, x: d * -28 }),
};

// Calendar-day arithmetic on UTC midnights — DST can't shift the answer.
const addDays = (dateStr, n) =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const isDateStr = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

const lowerThan = (mg) => (mg == null ? [] : STRENGTHS.filter((s) => s < mg));

// What's still wrong with this screen's answer, in plain words — cause first,
// then the fix. Null means the screen is complete and Next may light up.
function problemWith(key, d, today) {
  switch (key) {
    case 'count':
      if (!Number.isInteger(d.pouchesPerDay)) return 'Enter a whole number of pouches.';
      if (d.pouchesPerDay < 2) return 'That is below 2, and a taper needs something to cut. Enter 2 or more.';
      if (d.pouchesPerDay > MAX_PER_DAY) return `That is above ${MAX_PER_DAY}, which is more than this plan can shape. Enter ${MAX_PER_DAY} or fewer.`;
      return null;
    case 'strength':
      return d.mg == null ? 'Pick the strength you use now.' : null;
    case 'lower':
      return null; // none selected is a real answer: taper by count alone
    case 'length':
      if (!Number.isInteger(d.lengthDays)) return 'Enter a whole number of days.';
      if (d.lengthDays < MIN_LENGTH_DAYS) return `That is under ${MIN_LENGTH_DAYS} days, which squeezes the stages to nothing. Enter ${MIN_LENGTH_DAYS} or more.`;
      if (d.lengthDays > MAX_LENGTH_DAYS) return `That is over ${MAX_LENGTH_DAYS} days. Enter ${MAX_LENGTH_DAYS} or fewer.`;
      return null;
    case 'start':
      if (!isDateStr(d.startDate)) return 'Pick a date for Day 1.';
      if (d.startDate < today) return 'That date has already passed, and backdating leaves unlogged days. Pick today or later.';
      if (d.startDate > addDays(today, MAX_START_AHEAD_DAYS)) return 'That is more than a year out. Pick a nearer date.';
      return null;
    case 'rhythm': {
      const meals = d.mealTimes ?? {};
      if (![meals.breakfast, meals.lunch, meals.dinner, d.wakeTime, d.sleepTime].every(isTime))
        return 'One of these times is empty. Fill in all five.';
      if (!(toMin(meals.breakfast) < toMin(meals.lunch) && toMin(meals.lunch) < toMin(meals.dinner)))
        return 'Your meals are out of order. Set breakfast before lunch, and lunch before dinner.';
      return null;
    }
    case 'price':
      if (!(Number.isFinite(d.costPerTin) && d.costPerTin >= 0))
        return 'Enter what one tin costs — a number, or 0 to skip the money tracking.';
      if (!(Number.isInteger(d.pouchesPerTin) && d.pouchesPerTin >= 1))
        return 'Enter how many pouches are in a tin — a whole number, 1 or more.';
      return null;
    default:
      return null;
  }
}

export default function SetupFlow({ first = false, onExit }) {
  const { root, api } = useApp();
  const today = todayKey();

  const [draft, setDraft] = useState(() => ({
    pouchesPerDay: null,
    mg: null,
    strengths: null,
    lengthDays: 90,
    startDate: addDays(today, 1),
    ...lastSettings(root),
  }));
  const [stepKey, setStepKey] = useState('count');
  const [dir, setDir] = useState(1); // +1 forward, -1 back — drives the slide
  const [touched, setTouched] = useState(false); // errors appear once a field is left
  const [priceHelp, setPriceHelp] = useState(false);
  const [priceNonce, setPriceNonce] = useState(0); // remounts PriceStep after the AI fills it

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  // Screen 3 disappears only once a strength is picked and it turns out to be
  // the lowest chip. Before that it counts, so the progress total starts at 8
  // and settles rather than jumping up on screen 2.
  const lower = lowerThan(draft.mg);
  const hasLowerStep = draft.mg == null || lower.length > 0;
  const stepKeys = useMemo(
    () => ['count', 'strength', ...(hasLowerStep ? ['lower'] : []), 'length', 'start', 'rhythm', 'price', 'preview'],
    [hasLowerStep]
  );

  const i = Math.max(0, stepKeys.indexOf(stepKey));
  const problem = problemWith(stepKey, draft, today);
  const shownError = touched ? problem : null;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stepKey]);

  const go = (delta) => {
    const next = stepKeys[i + delta];
    if (!next) return;
    setDir(delta);
    setTouched(false);
    setStepKey(next);
  };

  // Screen 1's Back leaves setup entirely; everywhere else it walks the flow.
  const onBack = () => (i === 0 ? onExit?.() : go(-1));
  const showBack = !(i === 0 && first);

  // Picking a strength reseeds the "which can you buy" answer, but only when the
  // strength actually changed — re-tapping the same chip must not wipe screen 3.
  const pickStrength = (mg) => set(mg === draft.mg ? { mg } : { mg, strengths: lowerThan(mg) });

  // Built here rather than inside PlanPreview so the footer's Begin and the
  // screen itself share one result. Validation should make the throw
  // unreachable; if it ever isn't, say so plainly instead of taking the app down.
  const { plan, planError } = useMemo(() => {
    const incomplete = stepKeys.some((k) => k !== 'preview' && problemWith(k, draft, today));
    if (incomplete) return { plan: null, planError: null };
    try {
      return {
        plan: generatePlan({
          pouchesPerDay: draft.pouchesPerDay,
          mg: draft.mg,
          strengths: draft.strengths ?? lowerThan(draft.mg),
          lengthDays: draft.lengthDays,
          startDate: draft.startDate,
          mealTimes: draft.mealTimes,
          sleepTime: draft.sleepTime,
          pouchesPerTin: draft.pouchesPerTin,
        }),
        planError: null,
      };
    } catch (err) {
      return { plan: null, planError: err?.message ?? 'Something in these numbers does not add up.' };
    }
  }, [draft, stepKeys, today]);

  const onPreview = stepKey === 'preview';
  const blocked = onPreview ? !plan : !!problem;

  const begin = () => {
    if (!plan) return;
    // A start while viewing a past attempt silently no-ops; the guard is atomic,
    // so leaving the viewer in the same handler is enough.
    api.exitViewing();
    api.startAttempt({
      plan,
      settings: {
        mealTimes: draft.mealTimes,
        costPerTin: draft.costPerTin,
        pouchesPerTin: draft.pouchesPerTin,
        wakeTime: draft.wakeTime,
        sleepTime: draft.sleepTime,
      },
    });
  };

  const screens = {
    count: <CountStep draft={draft} set={set} max={MAX_PER_DAY} error={shownError} onTouch={() => setTouched(true)} />,
    strength: <StrengthStep draft={draft} options={STRENGTHS} onPick={pickStrength} error={shownError} />,
    lower: <LowerStrengthsStep draft={draft} options={lower} set={set} error={shownError} />,
    length: <LengthStep draft={draft} set={set} error={shownError} onTouch={() => setTouched(true)} />,
    start: (
      <StartDateStep
        draft={draft}
        set={set}
        min={today}
        max={addDays(today, MAX_START_AHEAD_DAYS)}
        error={shownError}
        onTouch={() => setTouched(true)}
      />
    ),
    rhythm: <RhythmStep draft={draft} set={set} error={shownError} onTouch={() => setTouched(true)} />,
    price: (
      <PriceStep
        key={priceNonce}
        draft={draft}
        set={set}
        error={shownError}
        onTouch={() => setTouched(true)}
        onHelp={() => setPriceHelp(true)}
      />
    ),
    preview: <PlanPreview plan={plan} error={planError} />,
  };

  return (
    <>
      <div className="app-shell">
        <header style={{ marginBottom: 14 }}>
          <div className="spread">
            <span className="tiny muted">Set up your plan</span>
            <span className="tiny muted num">
              Step {i + 1} of {stepKeys.length}
            </span>
          </div>
          <div className="row" aria-hidden="true" style={{ gap: 6, marginTop: 10 }}>
            {stepKeys.map((k, n) => (
              <motion.span
                key={k}
                animate={{ width: n === i ? 24 : 8, opacity: n <= i ? 1 : 0.4 }}
                transition={spring}
                style={{
                  height: 6,
                  borderRadius: 3,
                  flexShrink: 0,
                  background: n <= i ? 'var(--accent-bright)' : 'var(--border-strong)',
                }}
              />
            ))}
          </div>
        </header>

        <main style={{ flex: 1, paddingBottom: 8 }}>
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={stepKey}
              custom={dir}
              variants={slide}
              initial="enter"
              animate="center"
              exit="leave"
              transition={spring}
            >
              {screens[stepKey]}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer
          style={{
            position: 'sticky',
            bottom: 0,
            margin: '0 -20px',
            padding: '14px 20px calc(env(safe-area-inset-bottom) + 16px)',
            background:
              'linear-gradient(180deg, rgba(2,2,3,0) 0%, rgba(2,2,3,0.88) 34%, rgba(2,2,3,0.96) 100%)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <motion.button
            type="button"
            className="btn btn-accent"
            onClick={onPreview ? begin : () => go(1)}
            disabled={blocked}
            whileTap={blocked ? undefined : { scale: 0.98 }}
            style={{
              width: '100%',
              minHeight: 52,
              opacity: blocked ? 0.42 : 1,
              cursor: blocked ? 'default' : 'pointer',
            }}
          >
            {onPreview ? 'Begin' : 'Next'}
          </motion.button>

          {showBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={i === 0 ? 'Leave setup without saving' : 'Back to the previous step'}
              className="small"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                minHeight: 44,
                padding: '0 10px',
                marginLeft: -10,
                marginTop: 2,
                color: 'var(--fg-muted)',
                background: 'none',
                fontWeight: 500,
              }}
            >
              <ChevronLeft size={15} />
              Back
            </button>
          )}
        </footer>
      </div>

      <AnimatePresence>
        {priceHelp && (
          <PriceHelpSheet
            key="price-help"
            onClose={() => setPriceHelp(false)}
            onUse={({ pricePerTin, pouchesPerTin } = {}) => {
              const patch = {};
              if (Number.isFinite(pricePerTin) && pricePerTin >= 0) patch.costPerTin = pricePerTin;
              if (Number.isInteger(pouchesPerTin) && pouchesPerTin >= 1) patch.pouchesPerTin = pouchesPerTin;
              if (Object.keys(patch).length) {
                set(patch);
                setPriceNonce((n) => n + 1); // re-seed the inputs from the new numbers
              }
              setPriceHelp(false);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
