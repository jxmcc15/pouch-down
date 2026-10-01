// The trigger chips and the note, as one controlled block. ReasonEditor (why a
// pouch happened) and AddPouchCard (why a remembered pouch happened) both draw
// it, so the two can never drift apart.
import { motion } from 'framer-motion';
import { TRIGGERS } from '../triggers.js';

const NOTE_MAX = 140;
const chipStyle = { minHeight: 36, padding: '6px 13px', fontSize: 13 };

export default function ReasonFields({ picked, note, onToggle, onNote }) {
  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {TRIGGERS.map((t) => (
          <motion.button
            key={t}
            type="button"
            className={`chip ${picked.includes(t) ? 'selected' : ''}`}
            aria-pressed={picked.includes(t)}
            style={chipStyle}
            whileTap={{ scale: 0.94 }}
            onClick={() => onToggle(t)}
          >
            {t}
          </motion.button>
        ))}
      </div>
      <input
        type="text"
        aria-label="Note"
        placeholder="anything else?"
        maxLength={NOTE_MAX}
        value={note}
        onChange={(e) => onNote(e.target.value)}
        style={{ width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--fg)', fontSize: 16 }}
      />
    </>
  );
}
