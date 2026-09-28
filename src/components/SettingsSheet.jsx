import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardCopy, Check, Download, Sparkles, Flag } from 'lucide-react';
import { useApp } from '../state.jsx';
import { markdownSummary, fullBackup, todayKey, asOfDay, dayNumberFor } from '../store.js';
import { moneyStats } from '../money.js';
import { getKey, subscribe as subscribeKey } from '../sessionKey.js';
import { hasProxy, getDeviceToken, subscribe as subscribeToken, coachStatus } from '../proxyConfig.js';
import { getLastBackup, setLastBackup, subscribe as subscribeBackup } from '../lastBackup.js';
import PriceHelpSheet from './onboarding/PriceHelpSheet.jsx';
import SettingsRow from './settings/SettingsRow.jsx';
import CoachConnectSheet from './settings/CoachConnectSheet.jsx';
import AttemptsSheet from './settings/AttemptsSheet.jsx';

const fmtShort = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// The Coach row's title IS the connection state, and its subtitle is the one
// thing to do about it. coachStatus() decides; this only words it.
const COACH_COPY = {
  proxy: { title: 'Connected via your proxy', sub: 'Nothing to enter next time', dot: 'on' },
  key: { title: 'Key held for this session', sub: 'Cleared when the tab closes; your password manager refills it', dot: 'session' },
  none: { title: 'Not connected', sub: 'Add a key — or a device token if you run a proxy', dot: '' },
};

// One save rule for all five time fields: only a real HH:MM is written, and
// anything else (a cleared field) snaps back. A blank meal would otherwise be
// read by the store as noon (store.js slotMinutes) — a time nobody chose.
const HHMM = /^\d{2}:\d{2}$/;

// A label directly under a section header starts flush with it; the rest keep
// the form's usual breathing room.
const FLUSH = { marginTop: 0 };

// Six sections, top to bottom: Routine, Money, Coach, Attempt, Your data,
// About. The two rarely-touched ones (Coach, Attempt) are a single row each
// that opens its own sheet; everything touched often is one tap away here.
// `open` lets a caller land on a sub-sheet directly ('coach' from the coach's
// own "Open Settings" button).
export default function SettingsSheet({ onClose, open = null }) {
  const { state, root, api, readOnly } = useApp();
  const s = state.settings;
  const [sub, setSub] = useState(open); // null | 'coach' | 'attempts'
  // Watched, not read once: the row has to change the moment a key or token
  // lands in the Coach connection sheet above it.
  const [apiKey, setApiKey] = useState(getKey);
  useEffect(() => subscribeKey(setApiKey), []);
  const [deviceToken, setToken] = useState(getDeviceToken);
  useEffect(() => subscribeToken(setToken), []);
  const [lastBackup, setLast] = useState(getLastBackup);
  useEffect(() => subscribeBackup(setLast), []);
  // Trimmed the same way pickTransport trims, so the row never says
  // "connected" for a field holding only whitespace.
  const status = coachStatus({
    proxyOn: hasProxy(),
    hasToken: Boolean(deviceToken.trim()),
    hasKey: Boolean(apiKey.trim()),
  });
  const coach = COACH_COPY[status];
  const [copied, setCopied] = useState(false);
  const [backedUp, setBackedUp] = useState(null); // 'shared' | 'copied'
  const [priceHelp, setPriceHelp] = useState(false);
  // Numeric inputs hold a draft while typing so the field can sit empty
  // mid-edit; only valid numbers commit, and blur reverts to the last good one.
  const [drafts, setDrafts] = useState({});

  // The Attempt row reads the attempt as of its own day — today while live,
  // its end once archived — so a past attempt never reads as ongoing.
  const n = state.id.slice(1);
  const asOfN = dayNumberFor(state, asOfDay(state));
  const total = state.plan.totalDays;
  const pastCount = root.attempts.filter((a) => a.id !== state.id && a.status === 'archived').length;
  const attemptTitle = readOnly
    ? `Viewing Attempt ${n} · read-only`
    : `Attempt ${n} · ${asOfN >= 1 ? `day ${Math.min(asOfN, total)} of ${total}` : `starts ${fmtShort(state.plan.startDate)}`}`;
  const attemptSub = readOnly
    ? 'Exit at the top to leave the viewer'
    : pastCount
      ? `${pastCount} past attempt${pastCount === 1 ? '' : 's'}`
      : 'Your first attempt';

  // Every settings write goes to the active attempt, so while a past attempt is
  // open the api no-ops. Disable rather than let a tap do nothing silently.
  const numberField = (key, min) => ({
    disabled: readOnly,
    value: drafts[key] ?? s[key],
    onChange: (e) => {
      const raw = e.target.value;
      setDrafts((d) => ({ ...d, [key]: raw }));
      const num = Number(raw);
      if (raw !== '' && Number.isFinite(num) && num >= min) api.updateSettings({ [key]: num });
    },
    onBlur: () => setDrafts(({ [key]: _, ...rest }) => rest),
  });

  const setMeal = (meal, value) => {
    if (HHMM.test(value)) api.updateSettings({ mealTimes: { ...s.mealTimes, [meal]: value } });
  };

  const setTime = (key, value) => {
    if (HHMM.test(value)) api.updateSettings({ [key]: value });
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(markdownSummary(state, state.plan.totalDays, moneyStats(state).kept));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard can fail outside secure contexts; the button just won't confirm
    }
  };

  // Installed iOS web apps can't reliably download files, so the backup goes
  // out through the share sheet (AirDrop / Save to Files). Browsers that won't
  // share a .json get a .txt; browsers that won't share files get the clipboard.
  // The last-backup day is recorded only where a backup really left the app —
  // a dismissed share sheet or a failed copy records nothing.
  const downloadBackup = async () => {
    const json = fullBackup(root);
    const name = `pouch-down-backup-${todayKey()}`;
    const file = [
      new File([json], `${name}.json`, { type: 'application/json' }),
      new File([json], `${name}.txt`, { type: 'text/plain' }),
    ].find((f) => navigator.canShare?.({ files: [f] }));
    const confirm = (how) => {
      setBackedUp(how);
      setTimeout(() => setBackedUp(null), 2500);
    };
    if (file) {
      try {
        await navigator.share({ files: [file] });
        setLastBackup(todayKey());
        confirm('shared');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // share sheet dismissed
      }
    }
    try {
      await navigator.clipboard.writeText(json);
      setLastBackup(todayKey());
      confirm('copied');
    } catch {
      // clipboard can fail outside secure contexts; the button just won't confirm
    }
  };

  const lastBackupLine = !lastBackup
    ? 'No backup from this phone yet.'
    : lastBackup === todayKey()
      ? 'Last backup from this phone: today.'
      : `Last backup from this phone: ${fmtShort(lastBackup)}.`;

  // Both of the Attempts sheet's actions (open a past attempt, end this one)
  // leave Settings entirely, so it closes the whole stack.
  const closeAll = () => {
    setSub(null);
    onClose();
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
        aria-label="Settings"
      >
        <div className="sheet-handle" />
        <h3 style={{ fontSize: 16, marginBottom: 0 }}>Settings</h3>

        <div className="section-head">Routine</div>
        {/* Two columns for the same reason as setup: three time inputs don't
            fit a 390px phone, and dinner was clipped at the right edge. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {['breakfast', 'lunch', 'dinner'].map((meal, i) => (
            <div key={meal} style={{ minWidth: 0 }}>
              <label htmlFor={`meal-${meal}`} style={i < 2 ? FLUSH : undefined}>{meal}</label>
              <input
                id={`meal-${meal}`}
                type="time"
                disabled={readOnly}
                value={s.mealTimes[meal]}
                onChange={(e) => setMeal(meal, e.target.value)}
              />
            </div>
          ))}
        </div>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Slot times follow your meals — pouch slots unlock 15 minutes after.
        </p>

        {/* Wake and sleep are read when a plan is built, not live — the helper
            says so, so moving them never looks like it did nothing. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {[
            ['wake', 'wakeTime'],
            ['sleep', 'sleepTime'],
          ].map(([id, key]) => (
            <div key={id} style={{ minWidth: 0 }}>
              <label htmlFor={id}>{id}</label>
              <input
                id={id}
                type="time"
                disabled={readOnly}
                value={s[key] ?? ''}
                onChange={(e) => setTime(key, e.target.value)}
                aria-describedby="wake-sleep-help"
              />
            </div>
          ))}
        </div>
        <p id="wake-sleep-help" className="small faint" style={{ margin: '6px 0 0' }}>
          Used when a plan is built — sleep sets where the evening pouches land,
          and your next attempt starts from these. Your current plan's slots
          don't move.
        </p>

        <div className="section-head">Money</div>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="cost" style={FLUSH}>cost per tin ($)</label>
            <input
              id="cost"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              {...numberField('costPerTin', 0)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="ppt" style={FLUSH}>pouches per tin</label>
            <input
              id="ppt"
              type="number"
              inputMode="numeric"
              min="1"
              {...numberField('pouchesPerTin', 1)}
            />
          </div>
        </div>
        {!readOnly && (
          <button
            className="btn btn-ghost small"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => setPriceHelp(true)}
          >
            <Sparkles size={15} />
            Not sure? Work it out
          </button>
        )}

        <div className="section-head">Coach</div>
        <SettingsRow
          ariaLabel="Coach connection"
          icon={<span className={`status-dot ${coach.dot}`} aria-hidden="true" />}
          title={coach.title}
          subtitle={readOnly ? 'Read-only here — exit the viewer to change it.' : coach.sub}
          onClick={() => setSub('coach')}
        />

        <div className="section-head">Attempt</div>
        <SettingsRow
          ariaLabel="Attempts"
          icon={<Flag size={16} color="var(--accent-bright)" aria-hidden="true" />}
          title={attemptTitle}
          subtitle={attemptSub}
          onClick={() => setSub('attempts')}
        />

        <div className="section-head">Your data</div>
        <motion.button className="btn" style={{ width: '100%' }} whileTap={{ scale: 0.98 }} onClick={downloadBackup}>
          {backedUp ? <Check size={17} color="var(--green)" /> : <Download size={17} />}
          {backedUp === 'shared' ? 'Backup sent' : backedUp === 'copied' ? 'Copied — paste into a file' : 'Download full backup'}
        </motion.button>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Every log, trigger, and check-in as one JSON file. Save it somewhere
          safe — Files, AirDrop, or email. Your API key is left out.{' '}
          <span className="muted">{lastBackupLine}</span>
        </p>
        <motion.button
          className="btn btn-ghost"
          style={{ width: '100%', marginTop: 12 }}
          whileTap={{ scale: 0.98 }}
          onClick={copyExport}
        >
          {copied ? <Check size={17} color="var(--green)" /> : <ClipboardCopy size={17} />}
          {copied ? 'Copied — paste anywhere' : 'Copy full log as Markdown'}
        </motion.button>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Plain Markdown — paste it into your notes app or a Claude chat for a
          weekly review.
        </p>

        <div className="section-head">About</div>
        <p className="small faint" style={{ margin: 0 }}>
          Pouch Down · <span className="num">build {import.meta.env.VITE_BUILD ?? 'dev'}</span>
          <br />
          Your log stays on this phone unless you ask the coach.
        </p>

        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }} onClick={onClose}>
          Done
        </button>
      </motion.div>

      <AnimatePresence>
        {priceHelp && (
          <PriceHelpSheet
            key="price-help"
            onClose={() => setPriceHelp(false)}
            onUse={({ pricePerTin, pouchesPerTin }) =>
              api.updateSettings({ costPerTin: pricePerTin, pouchesPerTin })
            }
          />
        )}
        {sub === 'coach' && <CoachConnectSheet key="coach" onClose={() => setSub(null)} />}
        {sub === 'attempts' && <AttemptsSheet key="attempts" onClose={closeAll} />}
      </AnimatePresence>
    </>
  );
}
