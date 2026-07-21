'use strict';
/** Customers — with MCAZ licence capture (needed to buy prescription items). */
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { asyncHandler, notFound, conflict, badRequest, audit } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/security');
const { toCents, fromCents } = require('../lib/money');
const { iso } = require('../lib/dates');

const router = express.Router();
router.use(requireAuth);

const customerBody = z.object({
  legal_entity_id: z.number().int(),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  customer_type: z.enum(['BUSINESS', 'INDIVIDUAL', 'GOVT']).default('BUSINESS'),
  tin: z.string().max(50).optional(),
  vat_number: z.string().max(50).optional(),
  mcaz_licence_no: z.string().max(60).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(100).optional(),
  credit_limit: z.union([z.string(), z.number()]).default(0),
  payment_terms_days: z.number().int().default(0),
  customer_posting_group_id: z.number().int().optional(),
  vat_business_group_id: z.number().int().optional(),
});

const present = (r) => ({ ...r, credit_limit: fromCents(r.credit_limit_cents) });

router.get('/', asyncHandler(async (req, res) => {
  let q = db('customers').where('is_deleted', false);
  if (req.query.legal_entity_id) q = q.andWhere('legal_entity_id', req.query.legal_entity_id);
  if (req.query.search) {
    const s = `%${req.query.search}%`;
    q = q.andWhere((b) => b.where('name', 'like', s).orWhere('code', 'like', s));
  }
  res.json((await q.orderBy('name')).map(present));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await db('customers').where({ id: req.params.id, is_deleted: false }).first();
  if (!row) throw notFound('Customer not found');
  res.json(present(row));
}));

router.post('/', requireRole('SALES', 'FINANCE'), validate({ body: customerBody }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const dup = await db('customers').where({ legal_entity_id: b.legal_entity_id, code: b.code }).first();
    if (dup) throw conflict('Customer code already exists');
    const insert = { ...b, credit_limit_cents: toCents(b.credit_limit), created_at: iso(), updated_at: iso() };
    delete insert.credit_limit;
    await db.transaction(async (trx) => {
      const [id] = await trx('customers').insert(insert);
      await audit(trx, { userId: req.user.id, action: 'CREATE_CUSTOMER', entityType: 'Customer', entityId: id, detail: b.code });
      res.status(201).json(present(await trx('customers').where({ id }).first()));
    });
  }));

module.exports = router;
