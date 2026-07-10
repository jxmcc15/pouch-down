import { useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ClipboardCopy, Check } from 'lucide-react';
import { useApp } from '../state.jsx';
import { markdownSummary } from '../store.js';
import { TOTAL_DAYS } from '../plan.js';

const SHORTCUT_URL = 'https://jxmcc15.github.io/pouch-down/?checkin=hours:[Duration]';

export default function SettingsSheet({ onClose }) {
  const { state, api } = useApp();
  const s = state.settings;
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  // Numeric inputs hold a draft while typing so the field can sit empty
  // mid-edit; only valid numbers commit, and blur reverts to the last good one.
  const [drafts, setDrafts] = useState({});

  const numberField = (key, min) => ({
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

  const copyShortcutUrl = async () => {
    try {
      await navigator.clipboard.writeText(SHORTCUT_URL);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // clipboard can fail outside secure contexts; the button just won't confirm
    }
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(markdownSummary(state, TOTAL_DAYS));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
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
          Everything stays on this device.
        </p>

        <div className="row" style={{ gap: 10 }}>
          {['breakfast', 'lunch', 'dinner'].map((meal) => (
            <div key={meal} style={{ flex: 1 }}>
              <label htmlFor={`meal-${meal}`}>{meal}</label>
              <input
                id={`meal-${meal}`}
                type="time"
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

        <label htmlFor="apikey">Claude API key (for the coach)</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            id="apikey"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            placeholder="sk-ant-…"
            value={s.apiKey}
            onChange={(e) => api.updateSettings({ apiKey: e.target.value })}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-ghost"
            style={{ minWidth: 52, padding: 0 }}
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Stored only in this phone's browser storage. Get one at
          console.anthropic.com → API keys.
        </p>

        <label>Apple Watch / Health import</label>
        <p className="small muted" style={{ margin: 0 }}>
          iOS doesn't let web apps read HealthKit — but a Shortcut can send
          last night's sleep here every morning:
        </p>
        <ol className="small muted" style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Shortcuts app → Automation → New → Time of Day, daily 8:30 AM</li>
          <li>Add action: <em>Find Health Samples</em> where Type is Sleep</li>
          <li>Add action: <em>Calculate Statistics</em> → Duration in hours</li>
          <li>Add action: <em>Open URL</em> with:</li>
        </ol>
        <div
          className="small num"
          style={{
            marginTop: 8,
            padding: '8px 10px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'rgba(255,255,255,0.04)',
            wordBreak: 'break-all',
            color: 'var(--fg-muted)',
          }}
        >
          {SHORTCUT_URL}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="btn btn-ghost small" style={{ flex: 1 }} onClick={copyShortcutUrl}>
            {copiedUrl ? <Check size={15} color="var(--green)" /> : <ClipboardCopy size={15} />}
            {copiedUrl ? 'Copied' : 'Copy URL template'}
          </button>
          <a
            className="btn btn-ghost small"
            style={{ flex: 1, textDecoration: 'none' }}
            href="?checkin=hours:7.4,workout:1,quality:4"
          >
            Simulate import
          </a>
        </div>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Replace [Duration] with the Shortcut's duration variable. Simulate
          runs a fake 7.4h import locally so you can see it land.
        </p>

        <label>Export</label>
        <motion.button className="btn" style={{ width: '100%' }} whileTap={{ scale: 0.98 }} onClick={copyExport}>
          {copied ? <Check size={17} color="var(--green)" /> : <ClipboardCopy size={17} />}
          {copied ? 'Copied — paste anywhere' : 'Copy full log as Markdown'}
        </motion.button>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Formatted for Obsidian — paste into your vault or a Claude chat for a
          weekly review.
        </p>

        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }} onClick={onClose}>
          Done
        </button>
      </motion.div>
    </>
  );
}
