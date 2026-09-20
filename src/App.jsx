import { useEffect, useState } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { Sparkles, Settings, TriangleAlert } from 'lucide-react';
import { AppStateProvider, useApp } from './state.jsx';
import { dayKeyFor, todayKey } from './store.js';
import Aurora from './components/Aurora.jsx';
import BottomNav from './components/BottomNav.jsx';
import TodayView from './components/TodayView.jsx';
import CalendarView from './components/CalendarView.jsx';
import StatsView from './components/StatsView.jsx';
import PlanView from './components/PlanView.jsx';
import CoachSheet from './components/CoachSheet.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';
import ReadOnlyBanner from './components/ReadOnlyBanner.jsx';
import FrontDoor from './components/onboarding/FrontDoor.jsx';
import RecoveryScreen from './components/onboarding/RecoveryScreen.jsx';
import SetupFlow from './components/onboarding/SetupFlow.jsx';

const VIEWS = { today: TodayView, calendar: CalendarView, stats: StatsView, plan: PlanView };

// iOS Shortcut bridge: ?checkin=hours:7.4,workout:1,quality:4,score:82
// (all fields optional). Appends one shortcut check-in for today, then strips
// the param from the URL. Coexists with ?static; re-opens are idempotent.
function CheckinDeepLink() {
  const { state, api } = useApp();
  useEffect(() => {
    if (!state) return; // no active attempt yet — nothing to stamp a check-in onto
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('checkin');
    if (raw == null) return;
    const strip = () => {
      params.delete('checkin');
      const qs = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    };
    const today = todayKey();
    const already = state.events.some(
      (e) => e.type === 'checkin' && e.source === 'shortcut' && dayKeyFor(e.ts) === today
    );
    if (!already) {
      const data = {};
      for (const part of raw.split(',')) {
        const [k, v] = part.split(':');
        const num = Number(v);
        if (!Number.isFinite(num)) continue;
        if (k === 'hours') data.sleepHours = Math.min(14, Math.max(0, num));
        else if (k === 'quality') data.sleepQuality = Math.min(5, Math.max(1, Math.round(num)));
        else if (k === 'score') data.sleepScore = Math.min(100, Math.max(0, Math.round(num)));
        else if (k === 'workout') data.workout = num !== 0;
      }
      if (Object.keys(data).length) api.logCheckin({ ...data, source: 'shortcut' });
    }
    strip();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// A failed localStorage write is otherwise completely silent. Deliberately not
// dismissible and never auto-dismissed: it stands until a save succeeds, which
// clears `saveError` on its own. Announced, not interactive — it takes no focus
// and swallows no taps.
function SaveErrorToast() {
  const { saveError } = useApp();
  return (
    <AnimatePresence>
      {saveError && (
        <motion.div
          key="save-error"
          className="card"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: 'spring', damping: 24, stiffness: 180 }}
          style={{
            position: 'fixed',
            left: 16,
            right: 16,
            bottom: 'calc(env(safe-area-inset-bottom) + 92px)',
            zIndex: 45,
            maxWidth: 448,
            margin: '0 auto',
            padding: '12px 14px',
            pointerEvents: 'none',
            background: 'rgba(10, 10, 12, 0.92)',
            borderColor: 'rgba(251, 191, 36, 0.4)',
          }}
        >
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <TriangleAlert
              size={17}
              aria-hidden="true"
              style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }}
            />
            <p className="small" style={{ margin: 0, lineHeight: 1.45 }}>{saveError}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// The boot router. Nothing below the `state` guard may assume an attempt
// exists: unreadable storage gets the recovery screen, a first run goes
// straight into setup, and an empty-handed return visit gets the Front door.
function AppContent() {
  const { root, state, readOnly, problem } = useApp();
  const [tab, setTab] = useState('today');
  const [sheet, setSheet] = useState(null); // null | 'coach' | 'settings'
  const [setupOpen, setSetupOpen] = useState(false);

  // Setup is a route, not a sheet. Leaving it open would skip the Front door
  // the next time an attempt ends, so the attempt it created closes it.
  const hasAttempt = !!state;
  useEffect(() => {
    if (hasAttempt) setSetupOpen(false);
  }, [hasAttempt]);

  if (problem) return <RecoveryScreen />;
  if (!state) {
    // No attempts at all means there is nowhere to go back to — setup directly.
    const first = root.attempts.length === 0;
    if (first || setupOpen) return <SetupFlow first={first} onExit={() => setSetupOpen(false)} />;
    return <FrontDoor onStart={() => setSetupOpen(true)} />;
  }

  const View = VIEWS[tab];

  return (
    <>
      {readOnly && <ReadOnlyBanner />}
      <div className="app-shell">
        <header className="spread" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <div
              aria-hidden="true"
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: 'linear-gradient(135deg, var(--accent), #43389f)',
                boxShadow: '0 0 14px var(--accent-glow)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 800,
                color: '#fff',
              }}
            >
              ↓
            </div>
            <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>Pouch Down</span>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setSheet('coach')}
              aria-label="AI coach"
              style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-bright)' }}
            >
              <Sparkles size={21} />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setSheet('settings')}
              aria-label="Settings"
              style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}
            >
              <Settings size={21} />
            </motion.button>
          </div>
        </header>

        <main className="view-scroll">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', damping: 26, stiffness: 240 }}
            >
              <View openSettings={() => setSheet('settings')} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <BottomNav tab={tab} onChange={setTab} />

      <AnimatePresence>
        {sheet === 'coach' && (
          <CoachSheet
            key="coach"
            onClose={() => setSheet(null)}
            openSettings={() => setSheet('settings')}
          />
        )}
        {sheet === 'settings' && (
          <SettingsSheet key="settings" onClose={() => setSheet(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AppStateProvider>
        <CheckinDeepLink />
        <Aurora />
        <AppContent />
        <SaveErrorToast />
      </AppStateProvider>
    </MotionConfig>
  );
}
