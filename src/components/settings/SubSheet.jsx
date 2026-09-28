import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

// A sheet stacked on top of Settings: backdrop 52, sheet 53, like the trophy
// detail sheet over the case. Escape closes this one and stops there — the
// listener runs in the capture phase so it gets to the key before anything
// listening on the window underneath, and Settings stays put.
export default function SubSheet({ label, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        style={{ zIndex: 52 }} /* above Settings, so that dims too */
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet"
        style={{ zIndex: 53 }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        role="dialog"
        /* No aria-modal, like every other sheet here: focus is not trapped. */
        aria-label={label}
      >
        <div className="sheet-handle" />
        <div className="spread">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 16 }}>{label}</h3>
            {subtitle && (
              <p className="small faint" style={{ margin: '2px 0 0' }}>
                {subtitle}
              </p>
            )}
          </div>
          {/* A 44px target drawn as an 18px glyph; the negative margin keeps
              the header as tight as if only the glyph were there. */}
          <motion.button
            type="button"
            aria-label={`Close ${label.toLowerCase()}`}
            onClick={onClose}
            whileTap={{ scale: 0.92 }}
            className="row"
            style={{
              minWidth: 44,
              minHeight: 44,
              justifyContent: 'flex-end',
              padding: '0 0 0 12px',
              margin: '-11px -2px -11px 0',
              color: 'var(--fg-muted)',
            }}
          >
            <X size={18} />
          </motion.button>
        </div>
        {children}
        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }} onClick={onClose}>
          Done
        </button>
      </motion.div>
    </>
  );
}
