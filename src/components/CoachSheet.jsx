import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, SendHorizontal } from 'lucide-react';
import { useApp } from '../state.jsx';
import { askCoach } from '../coach.js';

const QUICK = ['I want one right now', 'How am I doing?', 'Remind me why'];

export default function CoachSheet({ onClose, openSettings }) {
  const { state } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const hasKey = Boolean(state.settings.apiKey?.trim());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text) => {
    if (!text.trim() || busy) return;
    setError(null);
    const next = [...messages, { role: 'user', text: text.trim() }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const reply = await askCoach(state, next);
      setMessages((m) => [...m, { role: 'assistant', text: reply }]);
    } catch (e) {
      if (e.message === 'bad-key') setError('That API key was rejected — double-check it in Settings.');
      else if (e.message === 'no-key') setError('Add your API key in Settings first.');
      else setError(`Couldn't reach the coach: ${e.message}`);
      setMessages(messages); // roll back the optimistic user message
      setInput(text);
    } finally {
      setBusy(false);
    }
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
        aria-label="AI coach"
        style={{ display: 'flex', flexDirection: 'column', height: '78dvh' }}
      >
        <div className="sheet-handle" />
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <Sparkles size={18} color="var(--accent-bright)" />
          <h3 style={{ fontSize: 16 }}>Coach</h3>
          <span className="small faint">knows your plan & your log</span>
        </div>

        {!hasKey ? (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <Sparkles size={22} color="var(--accent-bright)" />
            <p className="muted small" style={{ margin: '10px 0 16px' }}>
              The coach runs on your own Claude API key — it lives only on this
              phone and costs pennies a day. Add it once in Settings.
            </p>
            <button className="btn btn-accent" onClick={openSettings}>
              Open Settings
            </button>
          </div>
        ) : (
          <>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
              {messages.length === 0 && (
                <p className="small muted" style={{ textAlign: 'center', margin: 'auto 20px' }}>
                  Chats are fresh each time — the coach already knows today's
                  numbers, your stage, and your triggers.
                </p>
              )}
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: 16,
                    fontSize: 15,
                    userSelect: 'text',
                    WebkitUserSelect: 'text',
                    background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-strong)',
                    border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                    color: m.role === 'user' ? '#fff' : 'var(--fg)',
                  }}
                >
                  {m.text}
                </motion.div>
              ))}
              {busy && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="row small muted"
                  style={{ gap: 6, padding: '4px 8px' }}
                >
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                      style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--fg-muted)' }}
                    />
                  ))}
                </motion.div>
              )}
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="small"
                  style={{ color: 'var(--red)', padding: '6px 2px' }}
                  role="alert"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {messages.length === 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {QUICK.map((q) => (
                  <button key={q} className="chip" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            <form
              className="row"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Talk to your coach…"
                aria-label="Message the coach"
                style={{ flex: 1 }}
              />
              <motion.button
                type="submit"
                className="btn btn-accent"
                style={{ minWidth: 52, padding: 0 }}
                whileTap={{ scale: 0.94 }}
                disabled={busy || !input.trim()}
                aria-label="Send"
              >
                <SendHorizontal size={19} />
              </motion.button>
            </form>
          </>
        )}
      </motion.div>
    </>
  );
}
