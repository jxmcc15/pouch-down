import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Download, ShieldAlert } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { freshStartRoot, preserveCorruptV2, sendRawStorage } from '../../root.js';
import { todayKey } from '../../store.js';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// What "Start fresh" will actually do, said plainly for each way we got here.
// `next` is the root it would begin from (see freshStartRoot). `rescueFailed`:
// the copy aside didn't land, so nothing is set aside — Start fresh writes over
// it, and the amber note under this says what to do about that.
function confirmCopy(problem, next, rescueFailed) {
  const keep = 'Download it first so you have a copy you can keep.';
  if (problem === 'migration-failed') {
    return `Your old history stays on this phone, untouched, but this version can't read it. ${keep}`;
  }
  if (rescueFailed) {
    const gone = 'gets written over when you start fresh.';
    if (next?.attempts.length) {
      return `Your first attempt comes back as a past attempt. Anything logged after it is in the part the app couldn't read — that ${gone}`;
    }
    if (next?.legacyV1 === 'unread') {
      return `What the app couldn't read ${gone} Your older history stays here, untouched.`;
    }
    return `What the app couldn't read ${gone}`;
  }
  const setAside = "is set aside on this phone, not deleted, but the app won't show it.";
  if (next?.attempts.length) {
    return `Your first attempt comes back as a past attempt. Anything logged after it is in the part the app couldn't read — that ${setAside} ${keep}`;
  }
  if (next?.legacyV1 === 'unread') {
    return `What the app couldn't read ${setAside} Your older history stays here too, untouched. ${keep}`;
  }
  return `What the app couldn't read ${setAside} ${keep}`;
}

// Shown when loadRoot() could not read what's stored. While it's up, nothing is
// saved (the save effect bails on `problem`), so the stored bytes stay put.
export default function RecoveryScreen() {
  const { problem, api } = useApp();
  const [sent, setSent] = useState(null); // 'shared' | 'copied' | 'downloaded'
  const [confirming, setConfirming] = useState(false);
  // The copy aside couldn't be made (full storage): the download is then the
  // only copy there will be, so Start fresh waits for it.
  const [rescueFailed, setRescueFailed] = useState(false);
  // Read once, only to word the confirm; Start fresh re-reads when tapped.
  const next = useMemo(() => {
    try {
      return freshStartRoot();
    } catch {
      return null;
    }
  }, []);

  const cause =
    problem === 'migration-failed'
      ? "The app couldn't move your old data into its new format."
      : "The app couldn't read what's saved on this phone.";

  const download = async () => {
    try {
      const how = await sendRawStorage(`pouch-down-storage-${todayKey()}`);
      if (how) setSent(how);
    } catch (err) {
      console.error('pouch-down: download failed', err);
    }
  };

  const startFresh = () => {
    // Copy the unreadable value aside before the next save writes over it.
    // v1 is untouched either way. false = the copy didn't land: stop, so the
    // confirm can stop saying it's set aside. Go on only once the user has
    // downloaded AND seen that their download is now the only copy.
    if (preserveCorruptV2() === false && !(rescueFailed && sent)) {
      setRescueFailed(true);
      return;
    }
    let root;
    try {
      root = freshStartRoot();
    } catch (err) {
      console.error('pouch-down: could not read storage to start fresh', err);
      return;
    }
    api.startFresh(root);
  };

  const sentLabel = {
    shared: 'Sent',
    copied: 'Copied — paste it into a file',
    downloaded: 'Saved to your files',
  }[sent];

  // No copy on the phone: say where the only one now is.
  const onlyCopy = {
    shared: 'the file you just sent is the only one.',
    copied: 'the text you just copied is the only one — paste it somewhere safe first.',
    downloaded: 'the file you just saved is the only one.',
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
          Everything saved on this phone, as raw text — enough to rebuild your
          history. Your API key is left out. Save it somewhere safe — Files,
          AirDrop, or email. If your browser won't share a file it lands on
          your clipboard instead.
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
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>Start a fresh attempt?</p>
              <p className="small muted" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
                {confirmCopy(problem, next, rescueFailed)}
              </p>
              {rescueFailed && (
                <p className="small" role="alert" style={{ margin: '10px 0 0', lineHeight: 1.5, color: 'var(--amber)' }}>
                  {onlyCopy
                    ? `This phone didn't have room to keep a copy, so ${onlyCopy} Start fresh anyway?`
                    : "This phone didn't have room to keep a copy. Download it first, then you can start fresh."}
                </p>
              )}
              <div className="row" style={{ gap: 10, marginTop: 14 }}>
                <motion.button
                  className="btn"
                  style={{ flex: 1, opacity: rescueFailed && !sent ? 0.45 : 1 }}
                  whileTap={{ scale: 0.96 }}
                  disabled={rescueFailed && !sent}
                  onClick={startFresh}
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
