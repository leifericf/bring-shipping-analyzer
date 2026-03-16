// Pure formatting and pricing helpers.
// No side effects, no I/O, no external state.

/**
 * Round up to the next "nice" price ending in 9 (e.g. 59, 79, 149, 999).
 * @param {number} value
 * @returns {number}
 */
export function nicePrice(value) {
  return Math.ceil((value - 9) / 10) * 10 + 9;
}

/**
 * Compute the customer-facing domestic price (incl. road toll + VAT, rounded to nice price).
 * @param {number} rateNok - Base rate ex VAT
 * @param {number} roadToll - Average road toll
 * @param {number} vatMultiplier - e.g. 1.25
 * @returns {number}
 */
export function domesticCustomerPrice(rateNok, roadToll, vatMultiplier) {
  return nicePrice(Math.ceil((rateNok + roadToll) * vatMultiplier));
}

/**
 * Compute the customer-facing international price (rounded to nice price, no VAT).
 * @param {number} rateNok - Base rate
 * @returns {number}
 */
export function intlCustomerPrice(rateNok) {
  return nicePrice(Math.ceil(rateNok));
}

/**
 * Format a number as NOK with 2 decimal places.
 * @param {number} value
 * @returns {string}
 */
export function fmtNok(value) {
  return value.toFixed(2) + ' kr';
}

/**
 * Format a weight in grams as a human-readable string.
 * @param {number|string} grams
 * @returns {string}
 */
export function fmtWeight(grams) {
  const g = parseInt(grams, 10);
  return g >= 1000 ? `${g / 1000} kg` : `${g}g`;
}

/**
 * Format a run status for display (replace underscores with spaces).
 * @param {string} status
 * @returns {string}
 */
export function fmtStatus(status) {
  return status.replace(/_/g, ' ');
}

/**
 * Format an international zone's country codes as a label.
 * @param {{ codes: string[] }} zone
 * @param {object} countryNames - Code -> name map
 * @returns {string}
 */
export function fmtZoneLabel(zone, countryNames) {
  return zone.codes.map(c => countryNames[c]).filter(Boolean).join(', ');
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
export function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Format a SQLite datetime string for display.
 * @param {string} sqliteDateStr
 * @param {object} [opts]
 * @returns {string}
 */
export function fmtDate(sqliteDateStr, opts = {}) {
  const defaults = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Date(sqliteDateStr + 'Z').toLocaleDateString('en-GB', { ...defaults, ...opts });
}

/**
 * Format a Date as a Bring shipping date object { year, month, day }.
 * @param {Date} date
 * @returns {{ year: string, month: string, day: string }}
 */
export function formatShippingDate(date) {
  return {
    year: date.getFullYear().toString(),
    month: (date.getMonth() + 1).toString().padStart(2, '0'),
    day: date.getDate().toString().padStart(2, '0'),
  };
}

/**
 * Compute a date range from a reference date and a lookback in days.
 * @param {Date} now - Reference date
 * @param {number} lookbackDays - Number of days to look back
 * @returns {{ fromDate: Date, toDate: Date }}
 */
export function computeDateRange(now, lookbackDays) {
  const toDate = new Date(now);
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - lookbackDays);
  return { fromDate, toDate };
}
