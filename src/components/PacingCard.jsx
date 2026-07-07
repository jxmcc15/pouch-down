import { motion } from 'framer-motion';
import { Clock, CircleCheck } from 'lucide-react';

function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Slot-based pacing: your day's budget is scheduled around meals. The next
// slot "unlocks" at its time — a soft gate, never a hard block.
export default function PacingCard({ pacing }) {
  const { used, cap, slots, nextSlot, unlocked, now } = pacing;
  const spent = used >= cap;

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 24, stiffness: 180, delay: 0.05 }}
    >
      <div className="spread">
        <div className="row" style={{ gap: 12 }}>
          {spent ? (
            <CircleCheck size={22} color="var(--green)" />
          ) : (
            <Clock size={22} color={unlocked ? 'var(--green)' : 'var(--accent-bright)'} />
          )}
          <div>
            {spent ? (
              <>
                <div style={{ fontWeight: 600 }}>Budget spent for today</div>
                <div className="small muted">Craving? Hit SOS below — ride it out.</div>
              </>
            ) : unlocked ? (
              <>
                <div style={{ fontWeight: 600, color: 'var(--green)' }}>
                  {nextSlot.label} — unlocked
                </div>
                <div className="small muted">Take it when you want it, not on reflex.</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 600 }}>
                  Next: {nextSlot.label.toLowerCase()}
                </div>
                <div className="small muted num">
                  unlocks in {fmtCountdown(nextSlot.at - now)} · {fmtTime(nextSlot.at)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 14, gap: 7, flexWrap: 'wrap' }}>
        {slots.map((s, i) => (
          <motion.div
            key={s.id + i}
            className={`slot-dot ${s.spent ? 'spent' : ''}`}
            title={`${s.label} · ${fmtTime(s.at)}`}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 16, stiffness: 260, delay: 0.1 + i * 0.04 }}
          />
        ))}
        <span className="small faint" style={{ marginLeft: 4 }}>
          {cap - Math.min(used, cap)} left today
        </span>
      </div>
    </motion.div>
  );
}
