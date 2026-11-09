/**
 * src/dates.js computes the calendar date that jtrek writes into the store and into `work.json`.
 *
 * Every date jtrek writes is the local date of the machine it runs on, in the form `YYYY-MM-DD`.
 * A session writes dates into notes and prose files from the local date, because that is the date
 * `date` prints and the one the owner reads on their calendar. jtrek used to write the UTC date
 * instead. On a machine far from UTC, a row checked in shortly after local midnight then carried a
 * `ts` one day earlier than the date its own note gave for the same event. `R-000198` records that
 * defect and the owner's choice of the local date.
 */

/** Returns the local calendar date of `now` as `YYYY-MM-DD`. */
export function localDate(now = new Date()) {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
