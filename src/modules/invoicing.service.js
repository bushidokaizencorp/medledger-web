'use strict';
/**
 * Invoicing — the revenue engine.
 *
 * Creating an invoice:
 *   1. Resolve VAT rate + accounts for each line via the posting-group matrix
 *      (customer VAT business group x item VAT product group).
 *   2. Compute line net/vat/total honouring VAT-inclusive vs exclusive pricing,
 *      at 4dp inputs rounded once to 2dp.
 *   3. Roll up document subtotal / VAT / total.
 *
 * Issuing an invoice:
 *   4. FEFO-allocate and issue stock for each stockable line.
 *   5. Post the GL journal:
 *        DR Accounts Receivable (gross)
 *          CR Revenue (net, per item posting group)
 *          CR Output VAT (per VAT setup)
 *        DR COGS / CR Inventory (at batch cost)
 *   6. Leave the invoice ISSUED and ready for fiscalisation.
 *
 * Prescription control: a prescription-only item cannot be sold to a customer
 * with no MCAZ licence on file.
 */
const {
  toUnits4, toCents, fromCents, lineNetCents, pctOfCents,
  splitVatInclusive, addVatExclusive, roundHalfUp,
} = require('../lib/money');
const { iso, today } = require('../lib/dates');
const { HttpError, badRequest, notFound } = require('../lib/http');
const gl = require('./gl.service');
const pg = require('./postingGroups.service');
const inv = require('./inventory.service');

class InvoiceError extends HttpError {
  constructor(status, message) { super(status, message); }
}

async function nextNumber(trx, legalEntityId, table, col, prefix) {
  const row = await trx(table).where('legal_entity_id', legalEntityId)
    .andWhere(col, 'like', `${prefix}%`).count({ c: '*' }).first();
  return `${prefix}-${String(Number(row.c) + 1).padStart(6, '0')}`;
}

/**
 * Compute a single line's money. Returns integer cents fields.
 * unitPrice is 4dp; discount reduces the unit price; VAT inclusive/exclusive
 * decides how net and VAT split.
 */
function computeLine({ quantity, unitPrice, discountPercent, vatRatePercent, priceIncludesVat }) {
  const qty4 = toUnits4(quantity);
  let unit4 = toUnits4(unitPrice);
  if (discountPercent && Number(discountPercent) > 0) {
    unit4 = roundHalfUp(unit4 * (1 - Number(discountPercent) / 100));
  }
  const grossOrNetCents = lineNetCents(qty4, unit4); // qty x unit at 2dp

  let netCents; let vatCents;
  if (priceIncludesVat) {
    ({ netCents, vatCents } = splitVatInclusive(grossOrNetCents, vatRatePercent));
  } else {
    ({ netCents, vatCents } = addVatExclusive(grossOrNetCents, vatRatePercent));
  }
  return { netCents, vatCents, totalCents: netCents + vatCents };
}

async function createInvoice(trx, {
  legalEntityId, customerId, warehouseId = null, invoiceDate = null,
  currency = 'USD', pricesIncludeVat = false, lines, notes = null, userId = null,
  quotationId = null,
}) {
  const customer = await trx('customers').where({ id: customerId, is_deleted: false }).first();
  if (!customer) throw notFound('Customer not found');
  if (!lines || !lines.length) throw new InvoiceError(400, 'An invoice needs at least one line');

  const invDate = invoiceDate || today();
  const number = await nextNumber(trx, legalEntityId, 'invoices', 'invoice_number', 'INV');

  const [invoiceId] = await trx('invoices').insert({
    legal_entity_id: legalEntityId, customer_id: customerId, warehouse_id: warehouseId,
    invoice_number: number, invoice_date: invDate,
    currency, prices_include_vat: pricesIncludeVat, status: 'DRAFT',
    quotation_id: quotationId, created_by: userId, created_at: iso(), updated_at: iso(),
  });

  let subtotal = 0; let vatTotal = 0; let lineNo = 0;
  for (const l of lines) {
    const item = await trx('items').where({ id: l.item_id, is_deleted: false }).first();
    if (!item) throw notFound(`Item ${l.item_id} not found`);

    // Prescription control.
    if (item.requires_prescription && !customer.mcaz_licence_no) {
      throw new InvoiceError(422,
        `Item ${item.sku} is prescription-only and ${customer.code} has no MCAZ licence on file`);
    }

    const vat = await pg.vatSetup(trx, customer, item);
    const includeVat = l.price_includes_vat != null ? l.price_includes_vat : pricesIncludeVat;
    const unitPrice = l.unit_price != null ? l.unit_price
      : (item.default_price_units4 != null ? Number(item.default_price_units4) / 10000 : 0);

    const money = computeLine({
      quantity: l.quantity, unitPrice, discountPercent: l.discount_percent || 0,
      vatRatePercent: vat.ratePercent, priceIncludesVat: includeVat,
    });

    lineNo += 1;
    await trx('invoice_lines').insert({
      invoice_id: invoiceId, line_number: lineNo, item_id: item.id,
      description: l.description || item.name,
      quantity: l.quantity, unit_price_units4: toUnits4(unitPrice),
      discount_percent: l.discount_percent || 0, vat_rate_percent: vat.ratePercent,
      vat_exempt: vat.calcType === 'EXEMPT', price_includes_vat: includeVat,
      line_net_cents: money.netCents, line_vat_cents: money.vatCents,
      line_total_cents: money.totalCents,
    });
    subtotal += money.netCents;
    vatTotal += money.vatCents;
  }

  await trx('invoices').where({ id: invoiceId }).update({
    subtotal_cents: subtotal, vat_cents: vatTotal, total_cents: subtotal + vatTotal, updated_at: iso(),
  });
  return trx('invoices').where({ id: invoiceId }).first();
}

/**
 * Issue a DRAFT invoice: dispense stock (FEFO), post the GL, set ISSUED.
 */
async function issueInvoice(trx, invoiceId, userId = null) {
  const invoice = await trx('invoices').where({ id: invoiceId }).first();
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status !== 'DRAFT') throw new InvoiceError(400, `Invoice is ${invoice.status}, not DRAFT`);

  const customer = await trx('customers').where({ id: invoice.customer_id }).first();
  const lines = await trx('invoice_lines').where({ invoice_id: invoiceId }).orderBy('line_number');
  const { receivableAccountId } = await pg.customerAccounts(trx, customer);
  const receivable = await trx('gl_accounts').where({ id: receivableAccountId }).first();

  // Build the GL journal.
  const glLines = [];
  // DR receivable (gross)
  glLines.push({ accountCode: receivable.code, debitCents: invoice.total_cents, memo: `Invoice ${invoice.invoice_number}` });

  let cogsTotal = 0; let inventoryByAcct = {};
  const revenueByAcct = {}; const vatByAcct = {};

  for (const line of lines) {
    const item = await trx('items').where({ id: line.item_id }).first();
    const accts = await pg.itemAccounts(trx, item);
    const vat = await pg.vatSetup(trx, customer, item);

    // Revenue (net) grouped by revenue account
    const revAcct = await trx('gl_accounts').where({ id: accts.revenueAccountId }).first();
    revenueByAcct[revAcct.code] = (revenueByAcct[revAcct.code] || 0) + Number(line.line_net_cents);

    // Output VAT grouped by account (fallback to 2510 if setup gave none)
    if (Number(line.line_vat_cents) > 0) {
      let vatAcctCode = '2510';
      if (vat.outputAccountId) {
        const va = await trx('gl_accounts').where({ id: vat.outputAccountId }).first();
        vatAcctCode = va.code;
      }
      vatByAcct[vatAcctCode] = (vatByAcct[vatAcctCode] || 0) + Number(line.line_vat_cents);
    }

    // Stock dispatch (FEFO) + COGS, only for stockable items with a warehouse
    if (item.item_type !== 'SERVICE' && invoice.warehouse_id) {
      const plan = await inv.allocateFefo(trx, {
        warehouseId: invoice.warehouse_id, itemId: item.id, quantity: line.quantity,
      });
      await inv.issueAllocation(trx, {
        warehouseId: invoice.warehouse_id, itemId: item.id, plan,
        refTable: 'invoices', refId: invoiceId, userId,
      });
      // record which batch fulfilled the line (first batch; simplification)
      if (plan.length) {
        await trx('invoice_lines').where({ id: line.id }).update({ batch_lot_id: plan[0].batchLotId });
      }
      // COGS at batch cost
      let lineCogs = 0;
      for (const p of plan) {
        const unitCost = p.unitCostUnits4 != null ? Number(p.unitCostUnits4) : 0;
        lineCogs += roundHalfUp((Number(p.quantity) * unitCost) / 100); // units4*qty -> cents
      }
      if (lineCogs > 0 && accts.cogsAccountId && accts.inventoryAccountId) {
        cogsTotal += lineCogs;
        const invAcct = await trx('gl_accounts').where({ id: accts.inventoryAccountId }).first();
        inventoryByAcct[invAcct.code] = (inventoryByAcct[invAcct.code] || 0) + lineCogs;
      }
    }
  }

  for (const [code, cents] of Object.entries(revenueByAcct)) {
    glLines.push({ accountCode: code, creditCents: cents, memo: `Invoice ${invoice.invoice_number} revenue` });
  }
  for (const [code, cents] of Object.entries(vatByAcct)) {
    glLines.push({ accountCode: code, creditCents: cents, memo: `Invoice ${invoice.invoice_number} output VAT` });
  }
  // COGS / inventory (cost side)
  if (cogsTotal > 0) {
    glLines.push({ accountCode: '5000', debitCents: cogsTotal, memo: `Invoice ${invoice.invoice_number} COGS` });
    for (const [code, cents] of Object.entries(inventoryByAcct)) {
      glLines.push({ accountCode: code, creditCents: cents, memo: `Invoice ${invoice.invoice_number} stock out` });
    }
  }

  const batchId = await gl.createBatch(trx, {
    legalEntityId: invoice.legal_entity_id, journalDate: invoice.invoice_date,
    sourceModule: 'SALES', lines: glLines,
    description: `Sales invoice ${invoice.invoice_number}`,
    currency: invoice.currency, sourceRefTable: 'invoices', sourceRefId: invoiceId,
    createdBy: userId,
  });
  await gl.postBatch(trx, batchId, userId);

  await trx('invoices').where({ id: invoiceId }).update({
    status: 'ISSUED', gl_journal_batch_id: batchId, updated_at: iso(),
  });
  return trx('invoices').where({ id: invoiceId }).first();
}

module.exports = { InvoiceError, computeLine, createInvoice, issueInvoice, nextNumber };
