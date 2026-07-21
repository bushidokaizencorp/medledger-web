'use strict';
/** Date helpers — ISO strings everywhere for cross-dialect storage. */
const iso = (d = new Date()) => new Date(d).toISOString();
const today = () => new Date().toISOString().slice(0, 10);
function daysBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.round(ms / 86400000);
}
module.exports = { iso, today, daysBetween };
