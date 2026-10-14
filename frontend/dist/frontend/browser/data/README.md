# Prayer time data

The website loads these files every time it opens, and screens that stay open (like the TV) reload them every 6 hours. Edit them here on GitHub and every screen updates; there's no need to rebuild the site.

All times are local Calgary clock time (Alberta Time, UTC−6 year-round from Nov 1, 2026).

## `ICSC_Iqamah_Schedule_fullyear2026_2027.csv`

One row per day with that day's **iqamah** times.

| Column | Example | Notes |
|---|---|---|
| `Date` | `2026-10-04` | Required, `YYYY-MM-DD` |
| `Fajr`, `Zuhr`, `Asr`, `Isha` | `6:50 AM` | `h:mm AM/PM` (24-hour `18:45` also works) |
| `Maghrib` | `Sunset+ 10 min` | Minutes after the calculated sunset, or a fixed time like `7:25 PM` |

Other columns (`Day`, `Day of the Week`) are ignored. For next year, add the new file name to `iqamahSchedules` in `prayer-config.json`; you can list several files.

Dates missing from every schedule show calculated times with a "not in the published schedule" note.

## `jumuah.csv`

One row per Jumu'ah. Add or remove rows freely.

| Column | Example | Notes |
|---|---|---|
| `Name` | `1st Jumu'ah` | |
| `Khutbah` | `12:45 PM` | Optional |
| `Iqamah` | `1:00 PM` | Required |
| `Location` | `ICSC Legacy Musallah` | Optional. If every row has the same location, it's shown once under the tiles |

## `prayer-config.json`

- `adhanMinutesBeforeIqamah`: adhan = iqamah minus these minutes, per prayer and for Jumu'ah. With `"maghrib": 10` and `Sunset+ 10 min`, the Maghrib adhan is at sunset.
- `iqamahSchedules`: which schedule CSV files to load.
- `jumuahFile`: which Jumu'ah file to load.
- `masjid`: the name shown in the header, and the location and time zone used for sunrise, sunset and the sky.

## Safety check

The site flags an iqamah in orange when it falls before that prayer can begin (Fajr, Zuhr, Asr) or when Fajr's is after sunrise. If you see orange times, check the CSV.
