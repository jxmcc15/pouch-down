import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Download, ShieldAlert } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { KEY_V1, KEY_V2, preserveCorruptV2 } from '../../root.js';
import { todayKey } from '../../store.js';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Exactly what is in storage, as strings — no parsing, no repair, nothing
// dropped. Either key may be missing (null), which is itself worth knowing.
// Reading is the only thing this screen does to storage.
function rawStored() {
  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // storage can be blocked outright; say so rather than crash
    }
  };
  return JSON.stringify(
    {
      app: 'pouch-down',
      format: 'raw-storage',
      exportedAt: new Date().toISOString(),
      keys: { [KEY_V2]: read(KEY_V2), [KEY_V1]: read(KEY_V1) },
    },
    null,
    2
  );
}

// Shown when loadRoot() could not read what's stored. While it's up, nothing is
// saved (the save effect bails on `problem`), so the stored bytes stay put.
export default function RecoveryScreen() {
  const { problem, api } = useApp();
  const [sent, setSent] = useState(null); // 'shared' | 'copied' | 'downloaded'
  const [confirming, setConfirming] = useState(false);

  const cause =
    problem === 'migration-failed'
      ? "The app couldn't move your old data into its new format."
      : "The app couldn't read what's saved on this phone.";

  // Same route out as the Settings backup: share sheet first (installed iOS web
  // apps can't reliably download), then the clipboard, then a plain file.
  const download = async () => {
    const json = rawStored();
    const name = `pouch-down-storage-${todayKey()}`;
    const done = (how) => setSent(how);
    const file = [
      new File([json], `${name}.json`, { type: 'application/json' }),
      new File([json], `${name}.txt`, { type: 'text/plain' }),
    ].find((f) => navigator.canShare?.({ files: [f] }));
    if (file) {
      try {
        await navigator.share({ files: [file] });
        done('shared');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // share sheet dismissed
      }
    }
    try {
      await navigator.clipboard.writeText(json);
      done('copied');
      return;
    } catch {
      // clipboard can fail outside secure contexts — fall through to the file
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.json`;
    link.click();
    URL.revokeObjectURL(url);
    done('downloaded');
  };

  const sentLabel = {
    shared: 'Sent',
    copied: 'Copied — paste it into a file',
    downloaded: 'Saved to your files',
  }[sent];

  return (
    <div className="app-shell">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        style={{ paddingTop: 30, paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}
      >
        <div className="row" style={{ gap: 10 }}>
          <ShieldAlert size={24} aria-hidden="true" style={{ color: 'var(--amber)' }} />
          <h1 style={{ fontSize: 24 }}>Your data is still here</h1>
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.55 }}>{cause}</p>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.55 }}>
          Nothing has been overwritten and nothing has been deleted. What you
          logged is still in this phone's storage, exactly as it was — the app
          hasn't written a single thing since it opened.
        </p>

        <motion.button
          className="btn btn-accent"
          style={{ width: '100%', marginTop: 24 }}
          whileTap={{ scale: 0.98 }}
          onClick={download}
        >
          {sent ? <Check size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
          {sentLabel ?? "Download what's stored"}
        </motion.button>
        <p className="small faint" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
          The raw text of both storage keys — everything needed to rebuild your
          history. AirDrop it to your Mac or save it to Files. If your browser
          won't share a file it lands on your clipboard instead.
        </p>

        <AnimatePresence mode="wait">
          {!confirming ? (
            <motion.button
              key="ask"
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 26 }}
              whileTap={{ scale: 0.98 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirming(true)}
            >
              Start fresh
            </motion.button>
          ) : (
            <motion.div
              key="confirm"
              className="card"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={spring}
              style={{ marginTop: 26, borderColor: 'rgba(251, 191, 36, 0.35)' }}
            >
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>Start fresh?</p>
              <p className="small muted" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
                You'll set up a new plan from scratch. Once the app starts saving
                again it writes over the copy it couldn't read, so download that
                first if you want to keep it.
              </p>
              <div className="row" style={{ gap: 10, marginTop: 14 }}>
                <motion.button
                  className="btn"
                  style={{ flex: 1 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    // Copy the unreadable value aside before the next save
                    // writes over it. v1 is untouched either way.
                    preserveCorruptV2();
                    api.startFresh();
                  }}
                >
                  Yes, start fresh
                </motion.button>
                <motion.button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setConfirming(false)}
                >
                  Not yet
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
