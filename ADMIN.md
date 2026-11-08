# Admin page and Firebase

Prayer and Jumu'ah times are edited at **`<site>/#/admin`**
(https://hassanrazakhalid.github.io/legacy-musallah-prayers/#/admin) and stored in Firestore
(project `legacy-musallah`). Every screen, including the TV, picks up a save within a few seconds.

If Firestore has no times yet, or can't be reached, the display uses the CSV files in
`frontend/public/data/` as before.

## One-time setup (Firebase console)

1. **Firestore:** Build → Firestore Database → *Create database* (production mode; pick a region near Calgary, e.g. `northamerica-northeast1`).
2. **Security rules:** from the repo root run `firebase deploy --only firestore:rules`
   (or paste `firestore.rules` into Firestore → Rules and *Publish*).
   Until they're deployed, Firestore's default rules block everything and the display stays on the CSV files.
3. **Sign-in:** Build → Authentication → *Get started* → Sign-in method → enable **Email/Password**.
   Under Settings → User actions, turn **off** "Enable create (sign-up)", so only accounts you add can exist.
4. **Authorized domain:** Authentication → Settings → Authorized domains → add `hassanrazakhalid.github.io`.
5. **First admin:**
   - Authentication → Users → *Add user* (email + password). Copy the new **User UID**.
   - Firestore → *Start collection* `users` → Document ID = that UID, fields:
     `email` (string), `name` (string), `role` (string) = `admin`.
6. Open `#/admin`, sign in, press **Fill from current files** on each tab, check the times, **Save**.

To add another admin, repeat step 5. To remove one, delete their `users` document (or the account).
The app can't change `users`; only the console can.

## Data

| Collection | Document | Fields |
|---|---|---|
| `prayers` | `fajr`, `dhuhr`, `asr`, `maghrib`, `isha` | `current: {adhan, iqamah}`, `next: {adhan, iqamah, effectiveDate} \| null`, `adjustments: [{date, minutes}]`, `order`, `name`, `updatedAt`, `updatedBy` |
| `jumuah` | auto id, one per Jumu'ah | `order`, `name`, `adhan`, `khutbah` (or null), `iqamah`, `location`, `updatedAt`, `updatedBy` |
| `users` | the account's Auth UID | `email`, `name`, `role` (`admin` may edit) |

Times are 24-hour `HH:mm` strings in Calgary time; dates are `YYYY-MM-DD`. Anyone can read
`prayers` and `jumuah`; only admins can write them, and the rules reject malformed times.

## How "next week" works

- The display shows **this week's** times, and the last column shows next week's iqamah (highlighted when it differs).
- On the **effective date** (defaults to the coming Sunday) the display switches to next week's times by itself.
- After that, the admin page shows those times as *this week*, with empty next-week cells. Enter the
  following week and Save. **Promote next week → this week** does the same move early.
- A prayer with empty next-week cells keeps its current times.

## ± minute columns

- **+ Add date** adds a column at the end. Pick a date and type minutes per prayer, e.g. `+10` or `-15`
  (blank = no change). From that date, that prayer's adhan **and** iqamah move by those minutes and stay moved.
- Columns add up: +10 on the 20th and -5 on the 27th means +10 from the 20th and +5 from the 27th.
- Next week's times are used exactly as entered: only ± dates on or after next week's start shift them.
- The small time under each box is the resulting iqamah on that date.
- **No cron job.** Every screen works out each day's times from these dates on its own, so a change
  dated Friday shows on Friday without anything running on a server. When you open the admin page after a
  date has passed, that change is shown as part of "this week" and its column disappears.

## Developing against the emulators

```bash
# repo root: needs firebase-tools 13 with Java 11, or the latest firebase-tools with Java 21+
npx firebase-tools@13 emulators:start --only firestore,auth --project demo-legacy
cd frontend && npx ng serve
# open http://localhost:4200/?emulator  and  http://localhost:4200/?emulator#/admin
```

`?emulator` only works under `ng serve`. Create a test user in the Auth emulator and its `users` doc
in the Firestore emulator (e.g. with the REST API and `Authorization: Bearer owner`).
