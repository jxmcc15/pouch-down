import { motion } from 'framer-motion';
import { Sun, CalendarDays, ChartLine, Map } from 'lucide-react';

const TABS = [
  { id: 'today', label: 'Today', Icon: Sun },
  { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { id: 'stats', label: 'Stats', Icon: ChartLine },
  { id: 'plan', label: 'Plan', Icon: Map },
];

export default function BottomNav({ tab, onChange }) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      <div className="bottom-nav-inner">
        {TABS.map(({ id, label, Icon }) => (
          <motion.button
            key={id}
            className={`nav-item ${tab === id ? 'active' : ''}`}
            onClick={() => onChange(id)}
            whileTap={{ scale: 0.94 }}
            aria-label={label}
            aria-current={tab === id ? 'page' : undefined}
          >
            {tab === id && (
              <motion.span
                className="nav-pill"
                layoutId="nav-pill"
                transition={{ type: 'spring', damping: 26, stiffness: 300 }}
              />
            )}
            <Icon size={20} strokeWidth={tab === id ? 2.2 : 1.8} />
            {label}
          </motion.button>
        ))}
      </div>
    </nav>
  );
}
