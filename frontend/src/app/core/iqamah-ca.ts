/** Raw day records from an iqamah.ca data script, keyed by ISO date: { sunrise: "8:27 AM", ... }. */
export type RawSchedule = Record<string, Record<string, string>>;

const LOAD_TIMEOUT_MS = 10_000;

/**
 * Loads an iqamah.ca data script (e.g. salahschedule.js: `const SALAH_SCHEDULE = {...}`) and returns
 * the object it declares. The site sends no CORS headers, so the file can't be fetched; instead it
 * runs as a script in a sandboxed iframe (opaque origin, no access to this page) that posts the
 * object back. A fresh iframe each time lets a refresh re-run the `const` declaration.
 */
export function loadScheduleScript(url: string, globalName: string): Promise<RawSchedule | null> {
  const src = new URL(url, document.baseURI);
  src.searchParams.set('v', String(Date.now()));
  const tag = `iqamah-ca-${Math.random().toString(36).slice(2)}`;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.display = 'none';
  iframe.srcdoc =
    `<script src="${src.href}"></script>` +
    `<script>parent.postMessage({ tag: ${JSON.stringify(tag)},` +
    ` data: typeof ${globalName} === 'object' ? ${globalName} : null }, '*');</script>`;

  return new Promise<RawSchedule | null>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || e.data?.tag !== tag) return;
      done();
      resolve(asSchedule(e.data.data));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`${url}: timed out`));
    }, LOAD_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
  });
}

/** Keeps only well-formed entries: ISO date → { key: string }. */
function asSchedule(value: unknown): RawSchedule | null {
  if (!value || typeof value !== 'object') return null;
  const out: RawSchedule = {};
  for (const [date, day] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || typeof day !== 'object') continue;
    out[date] = Object.fromEntries(
      Object.entries(day as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
  }
  return Object.keys(out).length ? out : null;
}
