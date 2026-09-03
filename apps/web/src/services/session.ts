/**
 * The in-memory session (decision D6).
 *
 * The access token lives here and nowhere else: never localStorage, never
 * sessionStorage, never IndexedDB, never a cookie we can read. A page reload
 * therefore starts with no token, and the session is restored from the httpOnly
 * refresh cookie, which JavaScript cannot see at all.
 *
 * This module deliberately holds no `fetch`: it is a leaf that both the API
 * client and the auth provider can depend on without a cycle.
 */
let accessToken: string | null = null;

const sessionEndedListeners = new Set<() => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

/**
 * Notified when the session ends for a reason the user did not ask for — in
 * practice, a refresh that failed. The provider uses it to drop back to the
 * signed-out state without every call site having to handle it.
 */
export function onSessionEnded(listener: () => void): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

export function notifySessionEnded(): void {
  for (const listener of [...sessionEndedListeners]) {
    listener();
  }
}

/** Test helper: forget the token and every listener. */
export function resetSession(): void {
  accessToken = null;
  sessionEndedListeners.clear();
}
