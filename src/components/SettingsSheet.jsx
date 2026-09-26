import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardCopy, Check, Download, Sparkles, History } from 'lucide-react';
import { useApp } from '../state.jsx';
import { markdownSummary, fullBackup, todayKey, isLogged, dateForDayNumber } from '../store.js';
import { moneyStats } from '../money.js';
import { getKey, setKey, subscribe } from '../sessionKey.js';
import { hasProxy, getDeviceToken, setDeviceToken, subscribe as subscribeToken } from '../proxyConfig.js';
import PriceHelpSheet from './onboarding/PriceHelpSheet.jsx';

const fmtShort = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const loggedDaysIn = (attempt) => {
  let n = 0;
  for (let i = 1; i <= attempt.plan.totalDays; i++) {
    if (isLogged(attempt, dateForDayNumber(attempt, i))) n++;
  }
  return n;
};

export default function SettingsSheet({ onClose }) {
  const { state, root, api, readOnly } = useApp();
  const s = state.settings;
  // The key is held by sessionKey.js, not by the root — so the field follows
  // the session, including a key another sheet or a reload put there.
  const [apiKey, setApiKey] = useState(getKey);
  useEffect(() => subscribe(setApiKey), []);
  // The device token is the other way in: it lives on this device, so it follows
  // the stored value the same way the key follows the session.
  const [deviceToken, setTokenField] = useState(getDeviceToken);
  useEffect(() => subscribeToken(setTokenField), []);
  const proxyOn = hasProxy();
  const connected = Boolean(deviceToken.trim());
  const [copied, setCopied] = useState(false);
  const [backedUp, setBackedUp] = useState(null); // 'shared' | 'copied'
  const [priceHelp, setPriceHelp] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // Numeric inputs hold a draft while typing so the field can sit empty
  // mid-edit; only valid numbers commit, and blur reverts to the last good one.
  const [drafts, setDrafts] = useState({});

  const past = root.attempts.filter((a) => a.id !== state.id && a.status === 'archived');
  // Attempts copy has to be true in every state: viewing a past attempt (with
  // or without an active one to go back to), or on the active attempt with or
  // without earlier ones.
  const exitTo = root.activeAttemptId ? 'get back to your current attempt' : 'start a new one';
  const attemptsNote = readOnly
    ? past.length > 0
      ? `You're viewing a past attempt, read-only. Open another below, or exit at the top to ${exitTo}.`
      : `You're viewing a past attempt, read-only. Exit at the top to ${exitTo}.`
    : past.length > 0
      ? 'Nothing is ever deleted. Open one to look back at it.'
      : 'This is your first attempt. Past ones show up here once you start a new one.';

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

  const setMeal = (meal, value) =>
    api.updateSettings({ mealTimes: { ...s.mealTimes, [meal]: value } });

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
        confirm('shared');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // share sheet dismissed
      }
    }
    try {
      await navigator.clipboard.writeText(json);
      confirm('copied');
    } catch {
      // clipboard can fail outside secure contexts; the button just won't confirm
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
        aria-label="Settings"
      >
        <div className="sheet-handle" />
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>Settings</h3>
        <p className="small faint" style={{ margin: 0 }}>
          Your log stays on this phone unless you ask the coach.
        </p>

        {/* Two columns for the same reason as setup: three time inputs don't
            fit a 390px phone, and dinner was clipped at the right edge. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {['breakfast', 'lunch', 'dinner'].map((meal) => (
            <div key={meal} style={{ minWidth: 0 }}>
              <label htmlFor={`meal-${meal}`}>{meal}</label>
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

        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="cost">cost per tin ($)</label>
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
            <label htmlFor="ppt">pouches per tin</label>
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

        {/* Two ways the coach can reach Claude, and only the real ones show. A
            proxy holds the key for you, so this device just needs a token
            pasted once. With no proxy configured the key is the only path —
            which is the state the app is in until one is deployed, and there is
            nothing to choose between, so the section heading stays away. */}
        {proxyOn && (
          <>
            <label>Coach connection</label>
            <p className="small muted" style={{ margin: 0 }}>
              The coach goes through your own proxy, so no API key has to live on
              this phone.
            </p>
            {connected && (
              <div className="row small" style={{ gap: 6, marginTop: 8, color: 'var(--green)' }}>
                <Check size={15} />
                <span>This device is connected — nothing to enter next time.</span>
              </div>
            )}
            <label htmlFor="device-token">Device token</label>
            <input
              id="device-token"
              name="pouch-down-device-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              placeholder="paste it once"
              disabled={readOnly}
              value={deviceToken}
              onChange={(e) => setDeviceToken(e.target.value)}
            />
            <p className="small faint" style={{ margin: '6px 0 0' }}>
              Entered once per device, not once per session — it stays on this
              phone.{' '}
              {connected
                ? 'Paste a different one to replace it, or clear the field to disconnect this device.'
                : 'It only says this phone is allowed to ask; you can swap it for a new one any time.'}
            </p>
          </>
        )}

        {/* A plain password field, named and marked up the way iOS expects, so
            a password manager can offer the key instead of you typing it. */}
        <label htmlFor="apikey">
          {proxyOn ? 'Or use my own key on this device instead' : 'Claude API key (for the coach)'}
        </label>
        <input
          id="apikey"
          name="anthropic-api-key"
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          autoCapitalize="none"
          placeholder="sk-ant-…"
          disabled={readOnly}
          value={apiKey}
          onChange={(e) => setKey(e.target.value)}
        />
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Kept for this session only, never saved on this phone — your password
          manager can fill it back in. Get one at console.anthropic.com → API
          keys.
        </p>


        <label>Attempts</label>
        <p className="small muted" style={{ margin: 0 }}>
          {attemptsNote}
        </p>
        {past.map((a) => (
          <motion.button
            key={a.id}
            className="btn"
            style={{ width: '100%', marginTop: 8, justifyContent: 'flex-start', minHeight: 52 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              api.viewAttempt(a.id);
              onClose();
            }}
          >
            <History size={16} />
            <span style={{ textAlign: 'left' }}>
              Attempt {a.id.slice(1)}
              <span className="small faint" style={{ display: 'block', fontWeight: 400 }}>
                {fmtShort(a.plan.startDate)} – {fmtShort(a.plan.quitDate)} ·{' '}
                {loggedDaysIn(a)} of {a.plan.totalDays} days logged
              </span>
            </span>
          </motion.button>
        ))}

        {!readOnly && (
          confirmEnd ? (
            <motion.div
              className="card"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ marginTop: 12 }}
            >
              <p className="small" style={{ margin: 0 }}>
                Your history stays, read-only. You can't reopen this attempt.
                Next, you'll set up a new plan.
              </p>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={() => {
                    api.archiveActive();
                    onClose();
                  }}
                >
                  End attempt
                </button>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmEnd(false)}>
                  Keep going
                </button>
              </div>
            </motion.div>
          ) : (
            <button
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => setConfirmEnd(true)}
            >
              End this attempt and start over
            </button>
          )
        )}

        <label>Export</label>
        <motion.button className="btn" style={{ width: '100%' }} whileTap={{ scale: 0.98 }} onClick={copyExport}>
          {copied ? <Check size={17} color="var(--green)" /> : <ClipboardCopy size={17} />}
          {copied ? 'Copied — paste anywhere' : 'Copy full log as Markdown'}
        </motion.button>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Plain Markdown — paste it into your notes app or a Claude chat for a
          weekly review.
        </p>

        <motion.button className="btn" style={{ width: '100%', marginTop: 12 }} whileTap={{ scale: 0.98 }} onClick={downloadBackup}>
          {backedUp ? <Check size={17} color="var(--green)" /> : <Download size={17} />}
          {backedUp === 'shared' ? 'Backup sent' : backedUp === 'copied' ? 'Copied — paste into a file' : 'Download full backup'}
        </motion.button>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Every log, trigger, and check-in as one JSON file. Save it somewhere
          safe — Files, AirDrop, or email. Your API key is left out.
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
      </AnimatePresence>
    </>
  );
}
