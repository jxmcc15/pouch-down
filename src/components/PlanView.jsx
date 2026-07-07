import { motion } from 'framer-motion';
import { ShoppingCart, Scale, Timer, HeartHandshake } from 'lucide-react';
import { STAGES, TOTAL_DAYS } from '../plan.js';
import { dateForDayNumber, dayNumberFor, todayKey } from '../store.js';
import { useApp } from '../state.jsx';

function fmtDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const RULES = [
  {
    Icon: Scale,
    title: 'Absorb and continue',
    body: 'An over day breaks the streak, nothing else. Tomorrow’s cap never changes and the quit date never moves.',
  },
  {
    Icon: Timer,
    title: 'The 10-minute rule',
    body: 'Craving off-schedule? SOS first. Ten minutes, then decide. Most cravings die in three.',
  },
  {
    Icon: HeartHandshake,
    title: 'Honesty is the product',
    body: 'A true yellow day is worth more than a false green one. The chart only helps you if it’s real.',
  },
];

export default function PlanView() {
  const { state } = useApp();
  const todayN = dayNumberFor(todayKey());
  const spring = { type: 'spring', damping: 24, stiffness: 180 };

  return (
    <div>
      <h2 style={{ fontSize: 20, margin: '4px 0 2px' }}>The taper</h2>
      <p className="small muted" style={{ margin: '0 0 16px' }}>
        Count first, then strength. Meals stay protected — floaters get cut.
      </p>

      {STAGES.map((s, i) => {
        const active = todayN >= s.days[0] && todayN <= s.days[1];
        const done = todayN > s.days[1];
        return (
          <motion.div
            key={s.id}
            className="card"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.05 }}
            style={{
              borderColor: active ? 'var(--accent-bright)' : done ? 'rgba(52,211,153,0.3)' : 'var(--border)',
              boxShadow: active ? '0 0 24px var(--accent-glow)' : undefined,
              opacity: done ? 0.75 : 1,
            }}
          >
            <div className="spread">
              <div className="tiny" style={{ color: active ? 'var(--accent-bright)' : done ? 'var(--green)' : 'var(--fg-faint)' }}>
                {done ? 'done · ' : active ? 'now · ' : ''}
                days {s.days[0]}{s.days[1] !== s.days[0] ? `–${s.days[1]}` : ''} · {fmtDate(dateForDayNumber(s.days[0]))}
                {s.days[1] !== s.days[0] ? `–${fmtDate(dateForDayNumber(s.days[1]))}` : ''}
              </div>
              <div className="num" style={{ fontWeight: 800, fontSize: 17 }}>
                {s.pouchesPerDay === 0 ? 'zero' : `${s.pouchesPerDay}/day · ${s.mg}mg`}
              </div>
            </div>
            <div style={{ fontWeight: 700, margin: '4px 0 2px' }}>{s.name}</div>
            <div className="small muted">{s.tagline}</div>
            {s.slots.length > 0 && (
              <div className="row small faint" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                {s.slots.map((slot, j) => (
                  <span
                    key={j}
                    style={{
                      padding: '3px 10px',
                      borderRadius: 999,
                      border: '1px solid var(--border)',
                      background: slot.anchor !== 'fixed' ? 'rgba(94,106,210,0.12)' : 'var(--surface)',
                    }}
                  >
                    {slot.label.toLowerCase()}
                  </span>
                ))}
              </div>
            )}
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
                }}
              >
                <ShoppingCart size={15} />
                Buy {s.shopBefore.what} before {fmtDate(s.shopBefore.date)}
              </div>
            )}
          </motion.div>
        );
      })}

      <h3 style={{ fontSize: 16, margin: '22px 0 10px' }}>House rules</h3>
      {RULES.map((r, i) => (
        <motion.div
          key={r.title}
          className="card row"
          style={{ alignItems: 'flex-start', gap: 12 }}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.3 + i * 0.06 }}
        >
          <r.Icon size={19} color="var(--accent-bright)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{r.title}</div>
            <div className="small muted">{r.body}</div>
          </div>
        </motion.div>
      ))}

      <p className="small faint" style={{ textAlign: 'center', margin: '18px 0 4px' }}>
        Baseline: ~9/day @ 9mg (~81mg/day) · Day {TOTAL_DAYS} = zero ·{' '}
        {state.settings.mealTimes.breakfast} / {state.settings.mealTimes.lunch} /{' '}
        {state.settings.mealTimes.dinner} meals
      </p>
    </div>
  );
}
