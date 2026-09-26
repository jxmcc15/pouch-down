import { Component, useState } from 'react';
import { bootCrashSeen, clearBootCrash, markBootCrash, sendRawStorage, startFreshFromCrash } from '../root.js';
import { todayKey } from '../store.js';

const SENT_LABEL = {
  shared: 'Sent',
  copied: 'Copied — paste it into a file',
  downloaded: 'Saved to your files',
};

// What's left when a render crashes. Plain markup on purpose: nothing here may
// lean on the app state or the animation stack that may be what broke — which
// is also why it can't reuse RecoveryScreen (that one reads the app context,
// and ErrorBoundary sits outside the provider). `repeat` means the previous boot
// crashed too, so reloading is not the way out any more.
export function CrashScreen({ repeat = false }) {
  const [sent, setSent] = useState(null); // 'shared' | 'copied' | 'downloaded'
  const [confirming, setConfirming] = useState(false);
  // The copy aside couldn't be made (full storage): the download is then the
  // only copy there will be, so Start fresh waits for it.
  const [rescueFailed, setRescueFailed] = useState(false);

  const download = async () => {
    try {
      const how = await sendRawStorage(`pouch-down-storage-${todayKey()}`);
      if (how) setSent(how);
    } catch (err) {
      console.error('pouch-down: download failed', err);
    }
  };

  const startFresh = () => {
    const out = startFreshFromCrash(undefined, undefined, { force: rescueFailed && !!sent });
    if (out === 'rescue-failed') {
      setRescueFailed(true);
      return;
    }
    if (out === 'started') window.location.reload();
    else console.error('pouch-down: could not start fresh — storage would not take it');
  };

  return (
    <div className="app-shell" style={{ paddingTop: 30, paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
      <h1 style={{ fontSize: 22, lineHeight: 1.35 }}>
        {repeat
          ? 'It happened again on the way in. Your log is still safe on this phone.'
          : 'Something broke on this screen. Your log is still safe on this phone.'}
      </h1>
      <p className="muted" style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.55 }}>
        {repeat
          ? "Reloading isn't getting past it, so something in what's stored is probably the problem. Download a copy first — nothing has been written or deleted."
          : "Reloading usually sorts it out. If it keeps happening, download what's stored so you have a copy off the phone."}
      </p>

      <button type="button" className="btn btn-accent" style={{ width: '100%', marginTop: 24 }} onClick={download}>
        {SENT_LABEL[sent] ?? "Download what's stored"}
      </button>
      <p className="small faint" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
        Everything saved on this phone, as raw text. Your API key is left out.
      </p>

      <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }} onClick={() => window.location.reload()}>
        Reload
      </button>

      {repeat && !confirming && (
        <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={() => setConfirming(true)}>
          Start fresh
        </button>
      )}

      {repeat && confirming && (
        <div className="card" style={{ marginTop: 16, borderColor: 'rgba(251, 191, 36, 0.35)' }}>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>Start a fresh attempt?</p>
          <p className="small muted" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
            What's stored now is set aside on this phone, not deleted, and your
            first attempt comes back from the original copy — which is never
            written to. Download what's stored first so you have a copy you can
            keep.
          </p>
          {rescueFailed && (
            <p className="small" role="alert" style={{ margin: '10px 0 0', lineHeight: 1.5, color: 'var(--amber)' }}>
              {sent
                ? 'This phone had no room to keep a copy, so the one you just saved is the only one. Start fresh anyway?'
                : "This phone had no room to keep a copy. Download it first, then you can start fresh."}
            </p>
          )}
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button
              type="button"
              className="btn"
              style={{ flex: 1, opacity: rescueFailed && !sent ? 0.45 : 1 }}
              disabled={rescueFailed && !sent}
              onClick={startFresh}
            >
              Yes, start fresh
            </button>
            <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Without this, one render crash is a white screen on every boot with no way
// out. Catches render errors, including a state updater that throws. A crash
// that comes from the stored data itself used to crash again the instant the
// user reloaded, forever: the marker is how the second boot knows to offer the
// way out instead of the same dead end.
export default class ErrorBoundary extends Component {
  // Read at construction, before this boot can write its own marker, so it
  // means "the previous boot crashed" and never "this one did".
  crashedBefore = bootCrashSeen();

  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    markBootCrash();
    console.error('pouch-down: render crashed', error, info?.componentStack);
  }

  // React commits the fallback too, so this runs either way — the marker is
  // cleared only when what mounted was the app, not the crash screen. This boot
  // got in, so a crash later in the session is a first crash, not a loop.
  componentDidMount() {
    if (this.state.crashed) return;
    this.crashedBefore = false;
    clearBootCrash();
  }

  render() {
    return this.state.crashed ? <CrashScreen repeat={this.crashedBefore} /> : this.props.children;
  }
}
