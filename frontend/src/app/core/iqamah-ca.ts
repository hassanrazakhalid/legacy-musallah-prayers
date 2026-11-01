/** Raw day records from iqamah.ca's data scripts, keyed by ISO date: { fajr: "6:57 AM", ... }. */
export type RawSchedule = Record<string, Record<string, string>>;

export interface IqamahCaFiles {
  /** SALAH_SCHEDULE — adhan times (fajr, sunrise, zuhr, asr, maghrib, isha). */
  salah: RawSchedule | null;
  /** IQAMAH_SCHEDULE — iqamah times; may be relative, e.g. "Sunset+ 10 min", "Isha+ 30 min". */
  iqamah: RawSchedule | null;
}

const LOAD_TIMEOUT_MS = 10_000;

/**
 * Loads iqamah.ca's schedule scripts (`const SALAH_SCHEDULE = {...}` / `const IQAMAH_SCHEDULE = {...}`).
 * The site sends no CORS headers, so the files can't be fetched; instead they run as scripts in a
 * sandboxed iframe (opaque origin, no access to this page) that posts the two objects back.
 * A fresh iframe each time lets a refresh re-run the `const` declarations.
 */
export function loadIqamahCa(salahUrl: string, iqamahUrl: string): Promise<IqamahCaFiles> {
  const bust = (url: string) => {
    const u = new URL(url, document.baseURI);
    u.searchParams.set('v', String(Date.now()));
    return u.href;
  };
  const tag = `iqamah-ca-${Math.random().toString(36).slice(2)}`;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.display = 'none';
  iframe.srcdoc =
    `<script src="${bust(salahUrl)}"></script>` +
    `<script src="${bust(iqamahUrl)}"></script>` +
    `<script>parent.postMessage({ tag: ${JSON.stringify(tag)},` +
    ` salah: typeof SALAH_SCHEDULE === 'object' ? SALAH_SCHEDULE : null,` +
    ` iqamah: typeof IQAMAH_SCHEDULE === 'object' ? IQAMAH_SCHEDULE : null }, '*');</script>`;

  return new Promise<IqamahCaFiles>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || e.data?.tag !== tag) return;
      done();
      resolve({ salah: asSchedule(e.data.salah), iqamah: asSchedule(e.data.iqamah) });
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`${salahUrl}: timed out`));
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
