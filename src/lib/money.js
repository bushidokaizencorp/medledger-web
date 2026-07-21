'use strict';
/**
 * Money and quantity handling — two fixed-point scales, both integer-based to
 * stay clear of IEEE-754 float error (0.1 + 0.2 !== 0.3 in JS).
 *
 *   AMOUNT scale  = 2 decimals ("cents").  Line totals, document totals, and
 *                   everything posted to the GL live here. What you COMMIT.
 *   UNIT scale    = 4 decimals ("units4"). Unit prices, unit costs, and
 *                   quantities live here. What you CALCULATE with.
 *
 * A line amount is computed at full precision from 4dp inputs, then rounded
 * ONCE to 2dp — matching the standard ERP rule (Dynamics' unit-amount rounding
 * 0.00001 / amount rounding 0.01): four decimals where you calculate, two where
 * you commit.
 */

const AMOUNT_SCALE = 100; // 2 dp
const UNIT_SCALE = 10000; // 4 dp

// ---- 2dp amounts (cents) --------------------------------------------------

function toCents(amount) {
  return toScaled(amount, AMOUNT_SCALE);
}
function fromCents(cents) {
  return fromScaled(cents, AMOUNT_SCALE);
}

// ---- 4dp unit values (units4) --------------------------------------------

function toUnits4(amount) {
  return toScaled(amount, UNIT_SCALE);
}
function fromUnits4(u) {
  return fromScaled(u, UNIT_SCALE);
}

// ---- shared scaling -------------------------------------------------------

function toScaled(amount, scale) {
  if (typeof amount === 'number') return roundHalfUp(amount * scale);
  const s = String(amount).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Not a valid amount: ${amount}`);
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const digits = String(scale).length - 1; // 2 or 4
  const fracPadded = (frac + '0'.repeat(digits)).slice(0, digits);
  // Guard against sub-scale precision being silently dropped.
  const value = Number(whole) * scale + Number(fracPadded || '0');
  return neg ? -value : value;
}

function fromScaled(scaled, scale) {
  const n = Math.trunc(Number(scaled));
  const neg = n < 0;
  const abs = Math.abs(n);
  const digits = String(scale).length - 1;
  const major = Math.floor(abs / scale);
  const minor = String(abs % scale).padStart(digits, '0');
  return `${neg ? '-' : ''}${major}.${minor}`;
}

// ---- arithmetic -----------------------------------------------------------

/** Half-up rounding that is symmetric for negatives (Math.round is not). */
function roundHalfUp(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Line net amount in CENTS from a 4dp quantity and a 4dp unit price.
 * qty4 and price4 are integers at UNIT_SCALE. The raw product is at
 * UNIT_SCALE^2; we divide back to 2dp and round once.
 */
function lineNetCents(qty4, unitPrice4) {
  const rawProduct = Number(qty4) * Number(unitPrice4); // scale = 1e8
  // Convert 1e8-scale to 1e2-scale (cents): divide by 1e6.
  return roundHalfUp(rawProduct / (UNIT_SCALE * UNIT_SCALE / AMOUNT_SCALE));
}

/** Apply a percentage to a cents amount, rounding half-up to the cent. */
function pctOfCents(cents, ratePercent) {
  return roundHalfUp((Number(cents) * Number(ratePercent)) / 100);
}

/**
 * Split a VAT-inclusive gross (cents) into net + vat (cents) at a rate.
 * net = round(gross / (1 + rate/100)); vat = gross - net.
 */
function splitVatInclusive(grossCents, ratePercent) {
  const g = Number(grossCents);
  const net = roundHalfUp(g / (1 + Number(ratePercent) / 100));
  return { netCents: net, vatCents: g - net };
}

/** Add VAT onto a net (cents): vat = round(net * rate/100). */
function addVatExclusive(netCents, ratePercent) {
  const vat = pctOfCents(netCents, ratePercent);
  return { netCents: Number(netCents), vatCents: vat };
}

function sumCents(list) {
  return list.reduce((acc, c) => acc + Number(c), 0);
}

module.exports = {
  AMOUNT_SCALE,
  UNIT_SCALE,
  toCents,
  fromCents,
  toUnits4,
  fromUnits4,
  lineNetCents,
  pctOfCents,
  splitVatInclusive,
  addVatExclusive,
  roundHalfUp,
  sumCents,
};
