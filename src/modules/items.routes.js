'use strict';
/** Item catalogue: pharmaceutical products with GS1 + MCAZ attributes. */
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { asyncHandler, notFound, conflict, audit } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/security');
const { toUnits4, fromUnits4 } = require('../lib/money');
const { iso } = require('../lib/dates');

const router = express.Router();
router.use(requireAuth);

const itemBody = z.object({
  sku: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  item_type: z.enum(['MEDICINE', 'CONSUMABLE', 'SERVICE']).default('MEDICINE'),
  unit_of_measure: z.string().max(20).default('EACH'),
  generic_name: z.string().max(200).optional(),
  strength: z.string().max(60).optional(),
  dosage_form: z.string().max(60).optional(),
  atc_code: z.string().max(20).optional(),
  mcaz_registration_no: z.string().max(60).optional(),
  gtin: z.string().max(14).optional(),
  is_controlled_substance: z.boolean().default(false),
  controlled_schedule: z.string().max(20).optional(),
  requires_prescription: z.boolean().default(false),
  requires_cold_chain: z.boolean().default(false),
  default_price: z.union([z.string(), z.number()]).optional(), // 4dp
  price_currency: z.string().length(3).default('USD'),
  vat_rate_percent: z.number().default(15),
  vat_exempt: z.boolean().default(false),
  reorder_level: z.number().int().optional(),
  inventory_posting_group_id: z.number().int().optional(),
  vat_product_group_id: z.number().int().optional(),
});

function present(row) {
  return {
    ...row,
    default_price: row.default_price_units4 != null ? fromUnits4(row.default_price_units4) : null,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  let q = db('items').where('is_deleted', false);
  if (req.query.active === 'true') q = q.andWhere('is_active', true);
  if (req.query.search) {
    const s = `%${req.query.search}%`;
    q = q.andWhere((b) => b.where('name', 'like', s).orWhere('sku', 'like', s).orWhere('generic_name', 'like', s));
  }
  const rows = await q.orderBy('name');
  res.json(rows.map(present));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await db('items').where({ id: req.params.id, is_deleted: false }).first();
  if (!row) throw notFound('Item not found');
  res.json(present(row));
}));

router.post('/', requireRole('SALES', 'WAREHOUSE', 'FINANCE'), validate({ body: itemBody }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (await db('items').where({ sku: b.sku }).first()) throw conflict('SKU already exists');
    const insert = {
      ...b,
      default_price_units4: b.default_price != null ? toUnits4(b.default_price) : null,
      created_at: iso(), updated_at: iso(),
    };
    delete insert.default_price;
    await db.transaction(async (trx) => {
      const [id] = await trx('items').insert(insert);
      await audit(trx, { userId: req.user.id, action: 'CREATE_ITEM', entityType: 'Item', entityId: id, detail: b.sku });
      const row = await trx('items').where({ id }).first();
      res.status(201).json(present(row));
    });
  }));

router.patch('/:id', requireRole('SALES', 'WAREHOUSE', 'FINANCE'),
  asyncHandler(async (req, res) => {
    const item = await db('items').where({ id: req.params.id, is_deleted: false }).first();
    if (!item) throw notFound('Item not found');
    const patch = { ...req.body, updated_at: iso() };
    if (patch.default_price != null) {
      patch.default_price_units4 = toUnits4(patch.default_price);
      delete patch.default_price;
    }
    await db('items').where({ id: item.id }).update(patch);
    const row = await db('items').where({ id: item.id }).first();
    res.json(present(row));
  }));

module.exports = router;
