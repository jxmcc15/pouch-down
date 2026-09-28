// The one String() guard for display code. Stored data is validated by
// wellFormed before it reaches a component, so this is belt to those braces:
// a value that is not text renders as nothing rather than as "[object Object]"
// or a thrown "Objects are not valid as a React child" that takes the tab down.
export const asText = (v) =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
