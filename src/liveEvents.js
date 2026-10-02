// The live list: the events that count. A pouch named by a `void` event is
// dropped; everything else passes — including the void itself, which no reader
// scores. This is the ONE place a mistake stops counting. Every reader that
// computes a number walks `liveEvents` (or `eventsForDay`, which filters it);
// the raw list is for drawing struck rows and for the write guards, nothing
// else. Memoized on the events array: every append makes a new one, like
// `reasonsOf` in store.js, so a screen with sixty rows filters once.

const liveIndex = new WeakMap();

function indexOf(state) {
  let idx = liveIndex.get(state.events);
  if (!idx) {
    const voided = new Set();
    for (const e of state.events) {
      if (e.type === 'void' && typeof e.target === 'string') voided.add(e.target);
    }
    // Only a pouch can be voided. A stored void naming a resisted or a check-in
    // (hostile data; the api never writes one) changes nothing.
    const live = state.events.filter((e) => !(e.type === 'pouch' && voided.has(e.id)));
    idx = { voided, live };
    liveIndex.set(state.events, idx);
  }
  return idx;
}

export function liveEvents(state) {
  return indexOf(state).live;
}

// For the screens that draw a struck row: is this pouch named by a void?
export function isVoided(state, ev) {
  return ev.type === 'pouch' && indexOf(state).voided.has(ev.id);
}

// The three facts a pouch row draws besides its verdict. Strict equality on
// purpose: `late: 'yes'` or `timeKnown: 0` in stored data is neither.
export function pouchFlags(state, ev) {
  return { voided: isVoided(state, ev), late: ev.late === true, untimed: ev.timeKnown === false };
}
