import { useId } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

// One row of Settings that opens somewhere: a title that IS the state, a
// subtitle that names the one thing to do about it, a chevron. 56px tall.
// The accessible name stays the short ariaLabel (what the row is); the title
// and subtitle are read as its description, so the status is spoken too.
export default function SettingsRow({ icon = null, title, subtitle, onClick, ariaLabel }) {
  const descId = useId();
  return (
    <motion.button
      type="button"
      className="settings-row"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-describedby={descId}
      whileTap={{ scale: 0.98 }}
    >
      {icon}
      <span id={descId} style={{ minWidth: 0 }}>
        <span className="title" style={{ display: 'block' }}>{title}</span>
        {subtitle && <span className="sub" style={{ display: 'block' }}>{subtitle}</span>}
      </span>
      <ChevronRight size={18} className="chev" aria-hidden="true" />
    </motion.button>
  );
}
