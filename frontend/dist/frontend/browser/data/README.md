# Prayer time data

The website loads these files every time it opens, and screens that stay open (like the TV) reload them every 6 hours. Edit them here on GitHub and every screen updates; there's no need to rebuild the site.

All times are local Calgary clock time (Alberta Time, UTC−6 year-round from Nov 1, 2026).

The time zone in `prayer-config.json` is `Etc/GMT+6`, which means a fixed UTC−6; the sign is inverted in these zone names. Don't change it to `America/Edmonton`. Browsers with older time-zone data still move that zone back an hour on Nov 1, which would put every countdown an hour late.

## Daily adhan and iqamah: iqamah.ca

The daily times are loaded straight from iqamah.ca every time the site opens:

- `salahschedule.js` (`SALAH_SCHEDULE`): **adhan** times for Fajr, Sunrise, Zuhr, Asr, Maghrib and Isha.
- `schedule.js` (`IQAMAH_SCHEDULE`): **iqamah** times. Relative values like `Sunset+ 10 min`, `Fajr+ 10 min` or `Isha+ 30 min` are added to that prayer's adhan.

When iqamah.ca updates its files (for example, for next year), the site picks the changes up automatically. `iqamah.ca/` holds a snapshot of both files, used only when iqamah.ca can't be reached; refresh it by downloading the two files again.

Dates missing from the schedule show calculated times with a "not in the published schedule" note.

## `jumuah.csv`

One row per Jumu'ah. Add or remove rows freely.

| Column | Example | Notes |
|---|---|---|
| `Name` | `1st Jumu'ah` | |
| `Khutbah` | `12:45 PM` | Optional |
| `Iqamah` | `1:00 PM` | Required |
| `Location` | `ICSC Legacy Musallah` | Optional. If every row has the same location, it's shown once under the tiles |

## `prayer-config.json`

- `adhanMinutesBeforeIqamah.jumuah`: Jumu'ah adhan = iqamah minus these minutes.
- `salahScheduleUrl`, `iqamahScheduleUrl`: where the adhan and iqamah schedules are loaded from.
- `jumuahFile`: which Jumu'ah file to load.
- `masjid`: the name shown in the header, and the location and time zone used for sunrise, sunset and the sky (keep `Etc/GMT+6`, see above).

## Safety check

The site flags an iqamah in orange when it falls before that prayer's adhan, or when Fajr's is after sunrise.
