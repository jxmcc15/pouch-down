import { motion } from 'framer-motion';
import { ShoppingCart, TriangleAlert } from 'lucide-react';

// Setup screen 8: the generated plan, read-only, before anything is saved.
// Purely presentational — SetupFlow owns the generatePlan call so the footer's
// Begin button and this screen share one memoized result.

const spring = { type: 'spring', damping: 26, stiffness: 240 };

// Calendar-day arithmetic on UTC midnights, so a DST transition can't shift a
// stage by a day (same approach as store.js).
const addDays = (dateStr, n) =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const fmtLong = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

const fmtShort = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });

export default function PlanPreview({ plan, error }) {
  if (!plan) {
    return (
      <div>
        <h2 style={{ fontSize: 22, margin: '8px 0 0', lineHeight: 1.25 }}>
          These numbers don&rsquo;t add up yet
        </h2>
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          {error || 'The plan could not be built from what you entered.'}
        </p>
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          Step back and change one of your answers. Nothing has been saved.
        </p>
      </div>
    );
  }

  const strengths = [...new Set(plan.stages.map((s) => s.mg))].filter((mg) => mg > 0);

  return (
    <div>
      <h2 style={{ fontSize: 22, margin: '8px 0 0', lineHeight: 1.25 }}>
        Zero on {fmtLong(plan.quitDate)}
      </h2>
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        <span className="num">{plan.totalDays}</span> days, starting {fmtLong(plan.startDate)}.
        Count comes down first, then strength — your meal slots are the last to go.
      </p>

      <div className="card" style={{ marginTop: 16, padding: 14 }}>
        <div className="tiny muted">Starting point</div>
        <div className="num" style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>
          {plan.baseline.pouchesPerDay}/day at {plan.baseline.mg} mg
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          {strengths.length > 1
            ? `Steps down through ${strengths.join(', ')} mg across ${plan.stages.length} stages.`
            : `${plan.stages.length} stages, taper by count alone — no lower strength to step down to.`}
        </div>
      </div>

      <h3 style={{ fontSize: 16, margin: '22px 0 10px' }}>The stages</h3>

      {plan.stages.map((s, i) => {
        const from = addDays(plan.startDate, s.days[0] - 1);
        const to = addDays(plan.startDate, s.days[1] - 1);
        const oneDay = s.days[0] === s.days[1];
        return (
          <motion.div
            key={s.id}
            className="card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: Math.min(i * 0.04, 0.28) }}
          >
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <div className="tiny muted">
                day {s.days[0]}
                {oneDay ? '' : `–${s.days[1]}`} · {fmtShort(from)}
                {oneDay ? '' : `–${fmtShort(to)}`}
              </div>
              <div className="num" style={{ fontWeight: 800, fontSize: 17, whiteSpace: 'nowrap' }}>
                {s.pouchesPerDay === 0 ? 'zero' : `${s.pouchesPerDay}/day @ ${s.mg} mg`}
              </div>
            </div>
            <div style={{ fontWeight: 700, margin: '6px 0 2px' }}>{s.name}</div>
            <div className="small muted">{s.tagline}</div>
            {s.shopBefore && (
              <div
                className="row small"
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--amber-glow)',
                  border: '1px solid rgba(251,191,36,0.3)',
                  color: 'var(--amber)',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                <ShoppingCart size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Buy {s.shopBefore.what} before {fmtShort(s.shopBefore.date)}
                </span>
              </div>
            )}
          </motion.div>
        );
      })}

      <div
        className="row small muted"
        style={{ gap: 8, alignItems: 'flex-start', margin: '18px 0 4px' }}
      >
        <TriangleAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Nothing is saved until you tap Begin. After that the dates are fixed — a slip
          breaks the streak but never moves the quit date.
        </span>
      </div>
    </div>
  );
}
