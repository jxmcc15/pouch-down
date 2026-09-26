import { useEffect, useState } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { Sparkles, Settings, TriangleAlert } from 'lucide-react';
import { AppStateProvider, useApp } from './state.jsx';
import Aurora from './components/Aurora.jsx';
import BottomNav from './components/BottomNav.jsx';
import TodayView from './components/TodayView.jsx';
import CalendarView from './components/CalendarView.jsx';
import StatsView from './components/StatsView.jsx';
import PlanView from './components/PlanView.jsx';
import CoachSheet from './components/CoachSheet.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';
import FixDaySheet from './components/FixDaySheet.jsx';
import { TrophyCaseSheet } from './components/awards/TrophyCase.jsx';
import AwardUnlock from './components/awards/AwardUnlock.jsx';
import ReadOnlyBanner from './components/ReadOnlyBanner.jsx';
import FrontDoor from './components/onboarding/FrontDoor.jsx';
import RecoveryScreen from './components/onboarding/RecoveryScreen.jsx';
import SetupFlow from './components/onboarding/SetupFlow.jsx';

const VIEWS = { today: TodayView, calendar: CalendarView, stats: StatsView, plan: PlanView };

// There used to be a `?checkin=` deep link here, so an iOS Shortcut could open
// the app with a morning check-in in the URL. It is gone: James logs check-ins
// in the app, and nothing written into the address bar should be able to append
// an event. Check-ins already stored with `source: 'shortcut'` are read and
// scored exactly as before — history is append-only.

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
export function AppContent() {
  const { root, state, readOnly, problem } = useApp();
  const [tab, setTab] = useState('today');
  const [sheet, setSheet] = useState(null); // null | 'coach' | 'settings' | 'trophies' | { kind: 'fix', day }
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
            {/* Hidden in the viewer, like SOS and the check-in: the coach talks
                about today, and a past attempt has no today. */}
            {!readOnly && (
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => setSheet('coach')}
                aria-label="AI coach"
                style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-bright)' }}
              >
                <Sparkles size={21} />
              </motion.button>
            )}
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
              <View
                openSettings={() => setSheet('settings')}
                openTrophies={() => setSheet('trophies')}
                onFixDay={(day) => setSheet({ kind: 'fix', day })}
              />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <BottomNav tab={tab} onChange={setTab} />

      <AnimatePresence>
        {sheet === 'coach' && !readOnly && (
          <CoachSheet
            key="coach"
            onClose={() => setSheet(null)}
            openSettings={() => setSheet('settings')}
          />
        )}
        {sheet === 'settings' && (
          <SettingsSheet key="settings" onClose={() => setSheet(null)} />
        )}
        {sheet?.kind === 'fix' && !readOnly && (
          <FixDaySheet key="fix" day={sheet.day} onClose={() => setSheet(null)} />
        )}
        {sheet === 'trophies' && (
          <TrophyCaseSheet key="trophies" onClose={() => setSheet(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AppStateProvider>
        <Aurora />
        <AppContent />
        {/* Top level, beside the save toast, rather than inside a tab: an
            unlock is owed to you wherever you happen to be standing when it
            lands. It bails on its own when there is no attempt, when storage is
            unreadable, and — the one that matters — whenever a past attempt is
            being viewed read-only. */}
        <AwardUnlock />
        <SaveErrorToast />
      </AppStateProvider>
    </MotionConfig>
  );
}
