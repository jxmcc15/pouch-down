import { Component, useState } from 'react';
import { sendRawStorage } from '../root.js';
import { todayKey } from '../store.js';

const SENT_LABEL = {
  shared: 'Sent',
  copied: 'Copied — paste it into a file',
  downloaded: 'Saved to your files',
};

// What's left when a render crashes. Plain markup on purpose: nothing here may
// lean on the app state or the animation stack that may be what broke. It only
// ever reads storage (for the download), so the log stays exactly as it was.
export function CrashScreen() {
  const [sent, setSent] = useState(null); // 'shared' | 'copied' | 'downloaded'

  const download = async () => {
    try {
      const how = await sendRawStorage(`pouch-down-storage-${todayKey()}`);
      if (how) setSent(how);
    } catch (err) {
      console.error('pouch-down: download failed', err);
    }
  };

  return (
    <div className="app-shell" style={{ paddingTop: 30, paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
      <h1 style={{ fontSize: 22, lineHeight: 1.35 }}>
        Something broke on this screen. Your log is still safe on this phone.
      </h1>
      <p className="muted" style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.55 }}>
        Reloading usually sorts it out. If it keeps happening, download what's
        stored so you have a copy off the phone.
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
    </div>
  );
}

// Without this, one render crash is a white screen on every boot with no way
// out. Catches render errors, including a state updater that throws.
export default class ErrorBoundary extends Component {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    console.error('pouch-down: render crashed', error, info?.componentStack);
  }

  render() {
    return this.state.crashed ? <CrashScreen /> : this.props.children;
  }
}
