'use strict';
/** Quotations — same line maths as invoices; convert to invoice on acceptance. */
const { toUnits4, splitVatInclusive, addVatExclusive } = require('../lib/money');
const { iso, today } = require('../lib/dates');
const { HttpError, notFound } = require('../lib/http');
const pg = require('./postingGroups.service');
const { computeLine, nextNumber } = require('./invoicing.service');

class QuoteError extends HttpError {
  constructor(status, message) { super(status, message); }
}

async function createQuotation(trx, {
  legalEntityId, customerId, quoteDate = null, validUntil = null,
  currency = 'USD', pricesIncludeVat = false, lines, notes = null, userId = null,
}) {
  const customer = await trx('customers').where({ id: customerId, is_deleted: false }).first();
  if (!customer) throw notFound('Customer not found');
  if (!lines || !lines.length) throw new QuoteError(400, 'A quotation needs at least one line');

  const number = await nextNumber(trx, legalEntityId, 'quotations', 'quote_number', 'QUO');
  const [quoteId] = await trx('quotations').insert({
    legal_entity_id: legalEntityId, customer_id: customerId, quote_number: number,
    quote_date: quoteDate || today(), valid_until: validUntil, currency,
    prices_include_vat: pricesIncludeVat, status: 'DRAFT', notes,
    created_by: userId, created_at: iso(), updated_at: iso(),
  });

  let subtotal = 0; let vatTotal = 0; let lineNo = 0;
  for (const l of lines) {
    const item = await trx('items').where({ id: l.item_id, is_deleted: false }).first();
    if (!item) throw notFound(`Item ${l.item_id} not found`);
    const vat = await pg.vatSetup(trx, customer, item);
    const includeVat = l.price_includes_vat != null ? l.price_includes_vat : pricesIncludeVat;
    const unitPrice = l.unit_price != null ? l.unit_price
      : (item.default_price_units4 != null ? Number(item.default_price_units4) / 10000 : 0);
    const money = computeLine({
      quantity: l.quantity, unitPrice, discountPercent: l.discount_percent || 0,
      vatRatePercent: vat.ratePercent, priceIncludesVat: includeVat,
    });
    lineNo += 1;
    await trx('quotation_lines').insert({
      quotation_id: quoteId, line_number: lineNo, item_id: item.id,
      description: l.description || item.name, quantity: l.quantity,
      unit_price_units4: toUnits4(unitPrice), discount_percent: l.discount_percent || 0,
      vat_rate_percent: vat.ratePercent, price_includes_vat: includeVat,
      line_net_cents: money.netCents, line_vat_cents: money.vatCents,
      line_total_cents: money.totalCents,
    });
    subtotal += money.netCents; vatTotal += money.vatCents;
  }
  await trx('quotations').where({ id: quoteId }).update({
    subtotal_cents: subtotal, vat_cents: vatTotal, total_cents: subtotal + vatTotal, updated_at: iso(),
  });
  return trx('quotations').where({ id: quoteId }).first();
}

module.exports = { QuoteError, createQuotation };
