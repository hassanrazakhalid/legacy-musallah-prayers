/**
 * Options in the page address: `?tv` / `?mode=tv` (TV layout), `?at=19:05` (preview a time),
 * `?emulator` (dev only). They work before the hash (`/?tv`) or inside it (`/#/?tv`).
 *
 * The router rewrites the address on startup and drops anything before the hash, so this is read
 * once, when main.ts first imports it (before the app starts). keepLaunchParams() then moves them
 * into the hash route, where the router keeps them, so a refresh stays in TV mode.
 */
function read(): URLSearchParams {
  const params = new URLSearchParams(location.search);
  const hashQuery = location.hash.split('?')[1];
  if (hashQuery) new URLSearchParams(hashQuery).forEach((value, key) => params.set(key, value));
  return params;
}

export const launchParams = read();

/** `/?tv#/admin` → `/#/admin?tv=`. Call before bootstrapping. */
export function keepLaunchParams(): void {
  if (!location.search) return;
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const merged = new URLSearchParams(query);
  new URLSearchParams(location.search).forEach((value, key) => merged.set(key, value));
  history.replaceState(history.state, '', `${location.pathname}#${path || '/'}?${merged}`);
}
