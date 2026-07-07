import { useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ClipboardCopy, Check } from 'lucide-react';
import { useApp } from '../state.jsx';
import { markdownSummary } from '../store.js';

export default function SettingsSheet({ onClose }) {
  const { state, api } = useApp();
  const s = state.settings;
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const setMeal = (meal, value) =>
    api.updateSettings({ mealTimes: { ...s.mealTimes, [meal]: value } });

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(markdownSummary(state, 30));
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
              value={s.costPerTin}
              onChange={(e) => api.updateSettings({ costPerTin: Number(e.target.value) || 0 })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="ppt">pouches per tin</label>
            <input
              id="ppt"
              type="number"
              inputMode="numeric"
              min="1"
              value={s.pouchesPerTin}
              onChange={(e) => api.updateSettings({ pouchesPerTin: Number(e.target.value) || 15 })}
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
