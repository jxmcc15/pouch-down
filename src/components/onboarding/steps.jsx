import { useState } from 'react';
import { motion } from 'framer-motion';
import { Minus, Plus, Check, Sparkles, TriangleAlert } from 'lucide-react';
import { MIN_LENGTH_DAYS } from '../../planGenerator.js';

// One component per setup screen. Every screen is presentational: it reads the
// draft, hands edits back through `set`, and tells the flow when a field has
// been left (`onTouch`) so errors appear on blur rather than on every keystroke.
// Nothing here writes to storage — SetupFlow's Begin is the only write.

const LENGTH_CHIPS = [60, 90, 120];
const MAX_LENGTH_DAYS = 365;

// ---- shared bits (internal) ----

function Head({ title, sub }) {
  return (
    <>
      <h2 style={{ fontSize: 22, margin: '8px 0 0', lineHeight: 1.25 }}>{title}</h2>
      {sub && (
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          {sub}
        </p>
      )}
    </>
  );
}

function Helper({ id, children }) {
  return (
    <p id={id} className="small muted" style={{ margin: '10px 0 0', opacity: 0.85 }}>
      {children}
    </p>
  );
}

// Errors carry an icon as well as the red, so the state never rests on colour alone.
function FieldError({ children }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="small row"
      style={{ margin: '10px 0 0', gap: 7, alignItems: 'flex-start', color: 'var(--red)' }}
    >
      <TriangleAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </p>
  );
}

// 56px square so the stepper stays comfortably above the 44pt touch minimum.
function StepperButton({ onClick, disabled, label, children }) {
  return (
    <motion.button
      type="button"
      className="btn"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      style={{
        width: 56,
        height: 56,
        minHeight: 56,
        padding: 0,
        flexShrink: 0,
        borderRadius: 16,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </motion.button>
  );
}

function Chip({ selected, onClick, label, children }) {
  return (
    <motion.button
      type="button"
      className={`chip${selected ? ' selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      whileTap={{ scale: 0.95 }}
      style={{ minWidth: 76, justifyContent: 'center' }}
    >
      {selected && <Check size={14} />}
      <span className="num">{children}</span>
    </motion.button>
  );
}

// ---- screen 1 ----

export function CountStep({ draft, set, max, error, onTouch }) {
  // Raw draft string so the field can sit empty mid-edit (SettingsSheet's
  // numberField idiom); the committed number lives in the flow's draft.
  const [raw, setRaw] = useState(draft.pouchesPerDay == null ? '' : String(draft.pouchesPerDay));

  const commit = (next) => {
    setRaw(next);
    const n = Number(next);
    set({ pouchesPerDay: next.trim() !== '' && Number.isInteger(n) ? n : null });
  };

  const current = draft.pouchesPerDay;
  const canDec = Number.isInteger(current) && current > 2;
  const canInc = !Number.isInteger(current) || current < max;
  // From empty, + lands on the minimum rather than guessing a number for them.
  const bump = (delta) => {
    const base = Number.isInteger(current) ? current : 2 - delta;
    commit(String(Math.min(max, Math.max(2, base + delta))));
    onTouch();
  };

  return (
    <div>
      <Head
        title="How many pouches a day, right now?"
        sub="Be honest — the plan is built from this number, and nobody sees it but you."
      />
      <label htmlFor="setup-count">pouches a day</label>
      <div className="row" style={{ gap: 12 }}>
        <StepperButton onClick={() => bump(-1)} disabled={!canDec} label="One fewer pouch a day">
          <Minus size={20} />
        </StepperButton>
        <input
          id="setup-count"
          className="num"
          type="number"
          inputMode="numeric"
          min="2"
          max={max}
          step="1"
          value={raw}
          onChange={(e) => commit(e.target.value)}
          onBlur={onTouch}
          aria-describedby="setup-count-help"
          style={{ flex: 1, minHeight: 56, textAlign: 'center', fontSize: 28, fontWeight: 700, padding: '8px 6px' }}
        />
        <StepperButton onClick={() => bump(1)} disabled={!canInc} label="One more pouch a day">
          <Plus size={20} />
        </StepperButton>
      </div>
      <FieldError>{error}</FieldError>
      <Helper id="setup-count-help">
        Tap the number to type it, or use the buttons. Count a normal day, not your best one.
      </Helper>
    </div>
  );
}

// ---- screen 2 ----

export function StrengthStep({ draft, options, onPick, error }) {
  return (
    <div>
      <Head
        title="What strength do you use now?"
        sub="Pick the one you reach for most. The taper steps down from here."
      />
      <label id="setup-mg-label">strength</label>
      <div
        role="group"
        aria-labelledby="setup-mg-label"
        aria-describedby="setup-mg-help"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}
      >
        {options.map((mg) => (
          <Chip key={mg} selected={draft.mg === mg} onClick={() => onPick(mg)}>
            {mg} mg
          </Chip>
        ))}
      </div>
      <FieldError>{error}</FieldError>
      <Helper id="setup-mg-help">
        Mixing strengths? Pick the one you use most of the time.
      </Helper>
    </div>
  );
}

// ---- screen 3 (skipped when there is nothing below the current strength) ----

export function LowerStrengthsStep({ draft, options, set, error }) {
  const chosen = draft.strengths ?? options;
  const toggle = (mg) =>
    set({
      strengths: chosen.includes(mg) ? chosen.filter((s) => s !== mg) : [...chosen, mg].sort((a, b) => b - a),
    });

  return (
    <div>
      <Head
        title="Which lower strengths can you actually buy?"
        sub="The plan only steps down to strengths you can get hold of."
      />
      <label id="setup-lower-label">available strengths</label>
      <div
        role="group"
        aria-labelledby="setup-lower-label"
        aria-describedby="setup-lower-help"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}
      >
        {options.map((mg) => (
          <Chip
            key={mg}
            selected={chosen.includes(mg)}
            onClick={() => toggle(mg)}
            label={`${mg} mg — I can buy this`}
          >
            {mg} mg
          </Chip>
        ))}
      </div>
      <FieldError>{error}</FieldError>
      <Helper id="setup-lower-help">
        They all start on — untick anything your shop does not stock. Untick every one and
        the plan tapers by count alone.
      </Helper>
    </div>
  );
}

// ---- screen 4 ----

export function LengthStep({ draft, set, error, onTouch }) {
  const [custom, setCustom] = useState(!LENGTH_CHIPS.includes(draft.lengthDays));
  const [raw, setRaw] = useState(draft.lengthDays == null ? '' : String(draft.lengthDays));

  const pick = (days) => {
    setCustom(false);
    setRaw(String(days));
    set({ lengthDays: days });
  };
  const commit = (next) => {
    setRaw(next);
    const n = Number(next);
    set({ lengthDays: next.trim() !== '' && Number.isInteger(n) ? n : null });
  };

  return (
    <div>
      <Head
        title="How long do you want to take?"
        sub="Longer is gentler on the cravings. Shorter is sharper. Ninety days is the middle."
      />
      <label id="setup-length-label">days from Day 1 to zero</label>
      <div
        role="group"
        aria-labelledby="setup-length-label"
        aria-describedby="setup-length-help"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}
      >
        {LENGTH_CHIPS.map((days) => (
          <Chip
            key={days}
            selected={!custom && draft.lengthDays === days}
            onClick={() => pick(days)}
          >
            {days} days
          </Chip>
        ))}
        <Chip selected={custom} onClick={() => setCustom(true)} label="Custom — set your own number of days">
          Custom
        </Chip>
      </div>

      {custom && (
        <div style={{ marginTop: 14 }}>
          <label htmlFor="setup-length">number of days</label>
          <input
            id="setup-length"
            className="num"
            type="number"
            inputMode="numeric"
            min={MIN_LENGTH_DAYS}
            max={MAX_LENGTH_DAYS}
            step="1"
            value={raw}
            onChange={(e) => commit(e.target.value)}
            onBlur={onTouch}
            aria-describedby="setup-length-help"
            style={{ fontSize: 20, fontWeight: 600 }}
          />
        </div>
      )}

      <FieldError>{error}</FieldError>
      <Helper id="setup-length-help">
        Between {MIN_LENGTH_DAYS} and {MAX_LENGTH_DAYS} days. The quit date is fixed once you
        begin — a slip never moves it.
      </Helper>
    </div>
  );
}

// ---- screen 5 ----

export function StartDateStep({ draft, set, min, max, error, onTouch }) {
  return (
    <div>
      <Head
        title="When is Day 1?"
        sub="The morning your cap starts counting."
      />
      <label htmlFor="setup-start">Day 1</label>
      <input
        id="setup-start"
        type="date"
        min={min}
        max={max}
        value={draft.startDate ?? ''}
        onChange={(e) => set({ startDate: e.target.value })}
        onBlur={onTouch}
        aria-describedby="setup-start-help"
      />
      <FieldError>{error}</FieldError>
      <Helper id="setup-start-help">
        Tomorrow is a good answer. Until Day 1 arrives the app still logs everything — it
        just doesn&rsquo;t hold you to a cap.
      </Helper>
    </div>
  );
}

// ---- screen 6 ----

export function RhythmStep({ draft, set, error, onTouch }) {
  const setMeal = (meal, value) => set({ mealTimes: { ...draft.mealTimes, [meal]: value } });

  return (
    <div>
      <Head
        title="Your daily rhythm"
        sub="Pouch slots hang off your meals. The plan protects those and cuts the extra pouches between meals first."
      />

      {/* Two columns, not three: a time input's intrinsic width (08:00 AM plus
          the picker icon) is wider than a third of a 390px phone, so a 3-up row
          pushed dinner off the right edge. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, alignItems: 'flex-start' }}>
        {['breakfast', 'lunch', 'dinner'].map((meal) => (
          <div key={meal} style={{ minWidth: 0 }}>
            <label htmlFor={`setup-${meal}`}>{meal}</label>
            <input
              id={`setup-${meal}`}
              type="time"
              value={draft.mealTimes?.[meal] ?? ''}
              onChange={(e) => setMeal(meal, e.target.value)}
              onBlur={onTouch}
              aria-describedby="setup-rhythm-help"
            />
          </div>
        ))}
      </div>
      <Helper id="setup-rhythm-help">Slots unlock 15 minutes after each meal.</Helper>

      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="setup-wake">wake</label>
          <input
            id="setup-wake"
            type="time"
            value={draft.wakeTime ?? ''}
            onChange={(e) => set({ wakeTime: e.target.value })}
            onBlur={onTouch}
            aria-describedby="setup-sleep-help"
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="setup-sleep">sleep</label>
          <input
            id="setup-sleep"
            type="time"
            value={draft.sleepTime ?? ''}
            onChange={(e) => set({ sleepTime: e.target.value })}
            onBlur={onTouch}
            aria-describedby="setup-sleep-help"
          />
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <Helper id="setup-sleep-help">
        Sleep time sets where the evening slot lands. Rough times are fine — you can change
        them later in Settings.
      </Helper>
    </div>
  );
}

// ---- screen 7 ----

export function PriceStep({ draft, set, error, onTouch, onHelp }) {
  // Same raw-draft idiom as SettingsSheet: the field may sit empty mid-edit,
  // and blur drops the draft so the display falls back to what was committed.
  const [raws, setRaws] = useState({});

  const field = (key, { integer, min }) => ({
    value: raws[key] ?? (draft[key] ?? ''),
    onChange: (e) => {
      const next = e.target.value;
      setRaws((r) => ({ ...r, [key]: next }));
      const n = Number(next);
      const ok =
        next.trim() !== '' && Number.isFinite(n) && n >= min && (!integer || Number.isInteger(n));
      set({ [key]: ok ? n : null });
    },
    onBlur: () => {
      setRaws(({ [key]: _drop, ...rest }) => rest);
      onTouch();
    },
  });

  return (
    <div>
      <Head
        title="What do you really pay?"
        sub="Money saved is counted from this, and only from days you actually log."
      />

      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="setup-cost">cost per tin ($)</label>
          <input
            id="setup-cost"
            className="num"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.25"
            aria-describedby="setup-price-help"
            {...field('costPerTin', { integer: false, min: 0 })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="setup-ppt">pouches per tin</label>
          <input
            id="setup-ppt"
            className="num"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            aria-describedby="setup-price-help"
            {...field('pouchesPerTin', { integer: true, min: 1 })}
          />
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <Helper id="setup-price-help">
        Out-the-door price including tax. Most tins hold 20. Enter 0 if you would rather not
        track the money at all.
      </Helper>

      <motion.button
        type="button"
        className="btn btn-ghost"
        onClick={onHelp}
        whileTap={{ scale: 0.98 }}
        style={{ width: '100%', marginTop: 16 }}
      >
        <Sparkles size={16} />
        Help me work it out
      </motion.button>
      <Helper>
        Buy them in multipacks or off a shelf deal? Describe how you buy them and the coach
        turns it into a per-tin price. Typing it yourself works just as well.
      </Helper>
    </div>
  );
}
