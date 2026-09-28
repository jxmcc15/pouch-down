import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

// One row of Settings that opens somewhere: a title that IS the state, a
// subtitle that names the one thing to do about it, a chevron. 56px tall.
export default function SettingsRow({ icon = null, title, subtitle, onClick, ariaLabel }) {
  return (
    <motion.button
      type="button"
      className="settings-row"
      onClick={onClick}
      aria-label={ariaLabel}
      whileTap={{ scale: 0.98 }}
    >
      {icon}
      <span style={{ minWidth: 0 }}>
        <span className="title" style={{ display: 'block' }}>{title}</span>
        {subtitle && <span className="sub" style={{ display: 'block' }}>{subtitle}</span>}
      </span>
      <ChevronRight size={18} className="chev" aria-hidden="true" />
    </motion.button>
  );
}
