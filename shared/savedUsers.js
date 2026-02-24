// shared/savedUsers.js — persists a list of known riftbound.gg usernames / player names
// Used by: app (collection), give (trade matcher), match (match companion)

const KEY = 'rb_saved_users';
const MAX = 15;

/** Returns the saved list (most-recently-used first). */
export function getUsers() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

/**
 * Adds a name to the front of the saved list.
 * Deduplicates case-insensitively and caps at MAX entries.
 */
export function addUser(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  const list = getUsers().filter(u => u.toLowerCase() !== trimmed.toLowerCase());
  list.unshift(trimmed);
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

/** Removes an exact (case-insensitive) entry from the saved list. */
export function removeUser(name) {
  const low = (name || '').trim().toLowerCase();
  localStorage.setItem(KEY, JSON.stringify(getUsers().filter(u => u.toLowerCase() !== low)));
}
