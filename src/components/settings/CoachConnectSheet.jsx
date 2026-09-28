import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { getKey, setKey, subscribe } from '../../sessionKey.js';
import { hasProxy, getDeviceToken, setDeviceToken, subscribe as subscribeToken } from '../../proxyConfig.js';
import SubSheet from './SubSheet.jsx';

// How the coach reaches Claude. Rarely touched, so it lives behind one row in
// Settings; the fields themselves are the ones Settings always had.
export default function CoachConnectSheet({ onClose }) {
  const { readOnly } = useApp();
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

  return (
    <SubSheet label="Coach connection" subtitle="How the coach reaches Claude" onClose={onClose}>
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
    </SubSheet>
  );
}
