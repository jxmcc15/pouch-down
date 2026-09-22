import { motion } from 'framer-motion';
import { HeartPulse, Check } from 'lucide-react';
import { RECOVERY_MILESTONES } from '../plan.js';
import { useApp } from '../state.jsx';
import AnimatedNumber from './AnimatedNumber.jsx';

// Post-quit mode: the app counts UP. Milestones are approximations from
// standard cessation guidance, not medical advice.
//
// The count is calendar time since quit day, not logged evidence — there is no
// post-quit logging yet — so the copy says exactly that and claims no more.
export default function RecoveryTimeline() {
  const { state } = useApp(); // subscribe to the 1s tick so counters stay live
  const quitAt = new Date(`${state.plan.quitDate}T00:00:00`);
  const now = new Date();
  const hoursSince = Math.max(0, (now - quitAt) / 3600000);
  const daysSince = hoursSince / 24;

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 180 }}
        style={{ textAlign: 'center', padding: '18px 0 22px' }}
      >
        <HeartPulse size={28} color="var(--green)" />
        <h2 style={{ fontSize: 26, marginTop: 8 }}>Since quit day</h2>
        <div style={{ fontSize: 46, fontWeight: 800, color: 'var(--green)' }} className="num">
          <AnimatedNumber value={daysSince} format={(v) => v.toFixed(1)} />
          <span style={{ fontSize: 20, color: 'var(--fg-muted)', fontWeight: 600 }}> days</span>
        </div>
        <p className="small muted" style={{ margin: '6px auto 0', maxWidth: 300 }}>
          The plan is over. This counts the time since quit day — below is
          roughly what recovery looks like as it adds up.
        </p>
      </motion.div>

      {RECOVERY_MILESTONES.map((m, i) => {
        const reached = hoursSince >= m.hours;
        return (
          <motion.div
            key={m.label}
            className="card"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 180, delay: i * 0.05 }}
            style={{
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
              borderColor: reached ? 'rgba(52,211,153,0.35)' : 'var(--border)',
              opacity: reached ? 1 : 0.55,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: reached ? 'var(--green-glow)' : 'var(--surface-strong)',
                border: `1px solid ${reached ? 'rgba(52,211,153,0.5)' : 'var(--border-strong)'}`,
                color: 'var(--green)',
              }}
            >
              {reached && <Check size={15} />}
            </div>
            <div>
              <div className="tiny" style={{ color: reached ? 'var(--green)' : 'var(--fg-faint)' }}>
                {m.label}
              </div>
              <div className="small" style={{ color: reached ? 'var(--fg)' : 'var(--fg-muted)' }}>
                {m.body}
              </div>
            </div>
          </motion.div>
        );
      })}

      <p className="small faint" style={{ textAlign: 'center', margin: '16px 0' }}>
        Timelines are approximations, not medical advice. A slip after quit day
        is data, not defeat.
      </p>
    </div>
  );
}
