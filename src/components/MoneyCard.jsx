import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useApp } from '../state.jsx';
import { moneyStats } from '../money.js';
import AnimatedNumber from './AnimatedNumber.jsx';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Settings carry a price but no currency code, so the app picks one and the
// runtime locale does the rest — grouping, decimal mark, symbol placement.
const CURRENCY = 'USD';
const fmtCents = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY });
const fmtWhole = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// Springs overshoot and an unpriced tin makes every figure 0, so nothing
// reaches a formatter unscrubbed: no NaN, no Infinity, and no "-$0.00" on the
// way past zero.
const money = (v) => fmtCents.format(Number.isFinite(v) && Math.abs(v) >= 0.005 ? v : 0);
const moneyWhole = (v) => fmtWhole.format(Number.isFinite(v) && Math.abs(v) >= 0.5 ? v : 0);

function Figure({ label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="tiny muted">{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
        <AnimatedNumber value={value} format={money} />
      </div>
    </div>
  );
}

// What the taper has actually cost and kept — counted on logged days only.
// An unlogged day is not a saving, so it contributes nothing here and the card
// says so out loud; the old model quietly credited it and inflated the number.
// Read-only: it never writes an event or a setting, it just links to the price
// fields so a wrong tin price is one tap from being fixed.
export default function MoneyCard({ onOpenSettings }) {
  const { state } = useApp();
  if (!state) return null;

  const { loggedDays, perPouch, oldPace, spent, kept, afterQuit } = moneyStats(state);
  const priced = Number.isFinite(perPouch) && perPouch > 0;
  const counted = priced && loggedDays > 0;
  // Going over your old pace is information, not a verdict: amber, never red,
  // and the label carries the meaning so colour is never the only signal.
  const over = kept < 0;
  const tappable = typeof onOpenSettings === 'function';

  const quitLine = `Quit for good: about ${moneyWhole(afterQuit.perMonth)}/month back — ${moneyWhole(afterQuit.perYear)} a year.`;

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      whileTap={tappable ? { scale: 0.99 } : undefined}
      onClick={tappable ? () => onOpenSettings() : undefined}
      style={tappable ? { cursor: 'pointer' } : undefined}
    >
      <div className="spread">
        <span className="tiny muted">Money</span>
        {/* The whole card is a thumb target, but the named button is the real
            control: keyboard and screen-reader users get a labelled, focusable
            target, and the figures below stay readable as content instead of
            being swallowed into one button's accessible name. */}
        {tappable && (
          <motion.button
            type="button"
            aria-label="Open price settings"
            onClick={(e) => {
              e.stopPropagation(); // the card handles the tap; don't open twice
              onOpenSettings();
            }}
            whileTap={{ scale: 0.92 }}
            className="row"
            style={{
              gap: 4,
              minWidth: 44,
              minHeight: 44,
              justifyContent: 'flex-end',
              padding: '0 0 0 12px',
              margin: '-11px -2px -11px 0',
              background: 'none',
              color: 'var(--fg-muted)',
            }}
          >
            <span className="tiny">prices</span>
            <ChevronRight size={14} />
          </motion.button>
        )}
      </div>

      {!priced ? (
        <p className="small muted" style={{ margin: '12px 0 0' }}>
          Add your tin price and how many pouches are in a tin, and this fills in.
        </p>
      ) : !counted ? (
        <>
          <p className="small muted" style={{ margin: '12px 0 0' }}>
            Nothing counted yet — log a day and this fills in.
          </p>
          <p className="small muted" style={{ margin: '10px 0 0' }}>{quitLine}</p>
        </>
      ) : (
        <>
          {/* The working, then the answer: old pace minus what you spent. Two
              columns, not three, so a four-figure total has room on a 390px
              phone without shrinking the type. */}
          <div className="row" style={{ gap: 14, marginTop: 14 }}>
            <Figure label="Old pace" value={oldPace} />
            <Figure label="You spent" value={spent} />
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '14px 0' }} />

          <div className="tiny muted">{over ? 'Over your old pace' : 'Kept'}</div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              marginTop: 2,
              color: over ? 'var(--amber)' : 'var(--green)',
            }}
          >
            {/* Under "Over your old pace" the figure is the amount you went
                over, so it animates the magnitude — a minus sign there would
                read as a double negative. */}
            <AnimatedNumber value={over ? -kept : kept} format={money} />
          </div>

          <p className="small muted" style={{ margin: '12px 0 0' }}>{quitLine}</p>
          {/* Muted and dimmed rather than .faint — .faint sits under 3:1 on
              glass, and this caveat is the whole point of the card. */}
          <p className="small" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--fg-muted)', opacity: 0.85 }}>
            Counted on {loggedDays} logged day{loggedDays === 1 ? '' : 's'}. Unlogged days count for nothing.
          </p>
        </>
      )}
    </motion.div>
  );
}
