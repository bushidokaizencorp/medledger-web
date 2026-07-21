'use strict';
/** Sales: quotations, invoices, issue, fiscalise, payments. */
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { asyncHandler, notFound, audit } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/security');
const { fromCents, fromUnits4, toCents } = require('../lib/money');
const { iso, today } = require('../lib/dates');
const invoicing = require('./invoicing.service');
const quotations = require('./quotations.service');
const fiscal = require('./fiscalisation.service');
const trace = require('./traceability.service');

const router = express.Router();
router.use(requireAuth);

const lineSchema = z.object({
  item_id: z.number().int(),
  quantity: z.number().positive(),
  unit_price: z.union([z.string(), z.number()]).optional(),
  discount_percent: z.number().min(0).max(100).optional(),
  price_includes_vat: z.boolean().optional(),
  description: z.string().max(300).optional(),
});

function presentInvoice(inv) {
  return {
    ...inv,
    subtotal: fromCents(inv.subtotal_cents),
    vat: fromCents(inv.vat_cents),
    total: fromCents(inv.total_cents),
    amount_paid: fromCents(inv.amount_paid_cents),
  };
}

// ---- Quotations ----
router.post('/quotations', requireRole('SALES'),
  validate({ body: z.object({
    legal_entity_id: z.number().int(), customer_id: z.number().int(),
    quote_date: z.string().optional(), valid_until: z.string().optional(),
    currency: z.string().length(3).default('USD'),
    prices_include_vat: z.boolean().default(false),
    lines: z.array(lineSchema).min(1), notes: z.string().max(500).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const q = await db.transaction((trx) => quotations.createQuotation(trx, {
      legalEntityId: req.body.legal_entity_id, customerId: req.body.customer_id,
      quoteDate: req.body.quote_date, validUntil: req.body.valid_until,
      currency: req.body.currency, pricesIncludeVat: req.body.prices_include_vat,
      lines: req.body.lines, notes: req.body.notes, userId: req.user.id,
    }));
    res.status(201).json({ ...q, subtotal: fromCents(q.subtotal_cents), vat: fromCents(q.vat_cents), total: fromCents(q.total_cents) });
  }));

router.get('/quotations', asyncHandler(async (req, res) => {
  let q = db('quotations');
  if (req.query.legal_entity_id) q = q.where('legal_entity_id', req.query.legal_entity_id);
  const rows = await q.orderBy('id', 'desc');
  res.json(rows.map((r) => ({ ...r, total: fromCents(r.total_cents) })));
}));

// ---- Invoices ----
router.post('/invoices', requireRole('SALES'),
  validate({ body: z.object({
    legal_entity_id: z.number().int(), customer_id: z.number().int(),
    warehouse_id: z.number().int().optional(), invoice_date: z.string().optional(),
    currency: z.string().length(3).default('USD'),
    prices_include_vat: z.boolean().default(false),
    lines: z.array(lineSchema).min(1), notes: z.string().max(500).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const inv = await db.transaction((trx) => invoicing.createInvoice(trx, {
      legalEntityId: req.body.legal_entity_id, customerId: req.body.customer_id,
      warehouseId: req.body.warehouse_id || null, invoiceDate: req.body.invoice_date,
      currency: req.body.currency, pricesIncludeVat: req.body.prices_include_vat,
      lines: req.body.lines, notes: req.body.notes, userId: req.user.id,
    }));
    res.status(201).json(presentInvoice(inv));
  }));

router.get('/invoices', asyncHandler(async (req, res) => {
  let q = db('invoices');
  if (req.query.legal_entity_id) q = q.where('legal_entity_id', req.query.legal_entity_id);
  if (req.query.status) q = q.andWhere('status', req.query.status);
  const rows = await q.orderBy('id', 'desc');
  res.json(rows.map(presentInvoice));
}));

router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const inv = await db('invoices').where({ id: req.params.id }).first();
  if (!inv) throw notFound('Invoice not found');
  const lines = await db('invoice_lines').where({ invoice_id: inv.id }).orderBy('line_number');
  res.json({
    ...presentInvoice(inv),
    lines: lines.map((l) => ({
      ...l, unit_price: fromUnits4(l.unit_price_units4),
      line_net: fromCents(l.line_net_cents), line_vat: fromCents(l.line_vat_cents),
      line_total: fromCents(l.line_total_cents),
    })),
  });
}));

router.post('/invoices/:id/issue', requireRole('SALES', 'FINANCE'),
  asyncHandler(async (req, res) => {
    const inv = await db.transaction(async (trx) => {
      const issued = await invoicing.issueInvoice(trx, Number(req.params.id), req.user.id);
      // Traceability: dispensing events for stockable lines
      const lines = await trx('invoice_lines').where({ invoice_id: issued.id });
      for (const l of lines) {
        if (l.batch_lot_id) {
          await trace.recordEvent(trx, {
            legalEntityId: issued.legal_entity_id, bizStep: 'dispensing', disposition: 'dispensed',
            itemId: l.item_id, batchLotId: l.batch_lot_id, quantity: l.quantity,
            refTable: 'invoices', refId: issued.id, userId: req.user.id,
          });
        }
      }
      await audit(trx, { userId: req.user.id, action: 'ISSUE_INVOICE', entityType: 'Invoice', entityId: issued.id });
      return issued;
    });
    res.json(presentInvoice(inv));
  }));

router.post('/invoices/:id/fiscalise', requireRole('SALES', 'FINANCE'),
  asyncHandler(async (req, res) => {
    const inv = await db.transaction((trx) => fiscal.fiscaliseInvoice(trx, Number(req.params.id), req.user.id));
    res.json(presentInvoice(inv));
  }));

// ---- Payments ----
router.post('/payments', requireRole('FINANCE', 'SALES'),
  validate({ body: z.object({
    legal_entity_id: z.number().int(), customer_id: z.number().int(),
    invoice_id: z.number().int().optional(), payment_date: z.string().optional(),
    method: z.enum(['CASH', 'BANK', 'MOBILE', 'CARD']), currency: z.string().length(3).default('USD'),
    amount: z.union([z.string(), z.number()]), reference: z.string().max(80).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const result = await db.transaction(async (trx) => {
      const amountCents = toCents(b.amount);
      const [id] = await trx('payments').insert({
        legal_entity_id: b.legal_entity_id, customer_id: b.customer_id, invoice_id: b.invoice_id || null,
        payment_date: b.payment_date || today(), method: b.method, currency: b.currency,
        amount_cents: amountCents, reference: b.reference || null,
        created_by: req.user.id, created_at: iso(),
      });
      if (b.invoice_id) {
        const inv = await trx('invoices').where({ id: b.invoice_id }).first();
        const paid = Number(inv.amount_paid_cents) + amountCents;
        const status = paid >= Number(inv.total_cents) ? 'PAID' : 'PARTPAID';
        await trx('invoices').where({ id: inv.id }).update({ amount_paid_cents: paid, status, updated_at: iso() });
      }
      return trx('payments').where({ id }).first();
    });
    res.status(201).json({ ...result, amount: fromCents(result.amount_cents) });
  }));

module.exports = router;
