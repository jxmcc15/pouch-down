// Free-text → price, so nobody has to do gas-station arithmetic in their head.
// It never blocks manual entry: every failure ends with "enter it by hand",
// and the sheet closes without touching anything unless you tap Use these.
//
// Props are fixed: `onClose` dismisses, `onUse` receives the confirmed numbers
// `{ pricePerTin, pouchesPerTin }` and is the only way values escape. Use these
// calls `onUse` and then `onClose` — consumers can treat the sheet as gone.
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, Check, RotateCcw } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { priceFromText } from '../../priceHelp.js';

const EXAMPLE = 'e.g. 5-pack at the gas station for $23.99 plus tax';

// The model's own sentence is the only message shown verbatim. It lands here
// as a plain string and is rendered as a React text child, so it is escaped
// like any other text — never HTML.
function errorCopy(err) {
  const code = String(err?.message ?? '');
  if (code === 'no-key') return 'Add a Claude API key in Settings to use this — or just type the price in.';
  if (code.startsWith('unclear:')) return code.slice('unclear:'.length);
  return "Couldn't work that out — enter it by hand.";
}

export default function PriceHelpSheet({ onClose, onUse }) {
  const { device } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const workItOut = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await priceFromText(text.trim(), device.apiKey));
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  const useThese = () => {
    onUse?.({ pricePerTin: result.pricePerTin, pouchesPerTin: result.pouchesPerTin });
    onClose?.();
  };

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        role="dialog"
        aria-label="Work out the price"
      >
        <div className="sheet-handle" />
        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
          <Sparkles size={18} color="var(--accent-bright)" />
          <h3 style={{ fontSize: 16 }}>Work out the price</h3>
        </div>
        <p className="small faint" style={{ margin: 0 }}>
          Describe how you buy them and the coach does the math. You can always
          type the numbers in yourself instead.
        </p>

        <label htmlFor="price-help-text">Tell me how you buy them</label>
        <textarea
          id="price-help-text"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          style={{ minHeight: 88, resize: 'vertical', lineHeight: 1.5 }}
        />

        <motion.button
          className="btn btn-accent"
          style={{ width: '100%', marginTop: 12 }}
          whileTap={{ scale: 0.98 }}
          onClick={workItOut}
          disabled={busy || !text.trim()}
        >
          {busy ? (
            <motion.span
              style={{ display: 'inline-flex' }}
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 size={17} />
            </motion.span>
          ) : (
            <Sparkles size={17} />
          )}
          {busy ? 'Working it out…' : 'Work it out'}
        </motion.button>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="small"
              style={{ color: 'var(--red)', padding: '10px 2px 0' }}
              role="alert"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {result && (
            <motion.div
              className="card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{ marginTop: 14 }}
            >
              <div className="row" style={{ gap: 18 }}>
                <div>
                  <div className="small muted">per tin</div>
                  <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>
                    ${result.pricePerTin.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="small muted">pouches per tin</div>
                  <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>
                    {result.pouchesPerTin}
                  </div>
                </div>
              </div>
              {result.explanation && (
                <p className="small muted" style={{ margin: '10px 0 0' }}>
                  {result.explanation}
                </p>
              )}
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <motion.button
                  className="btn btn-accent"
                  style={{ flex: 1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={useThese}
                >
                  <Check size={17} />
                  Use these
                </motion.button>
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setResult(null);
                    setError(null);
                  }}
                >
                  <RotateCcw size={16} />
                  Try again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }} onClick={onClose}>
          Cancel
        </button>
      </motion.div>
    </>
  );
}
