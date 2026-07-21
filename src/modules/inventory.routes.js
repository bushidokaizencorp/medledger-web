'use strict';
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { asyncHandler, notFound, conflict } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/security');
const { toUnits4 } = require('../lib/money');
const { iso } = require('../lib/dates');
const inv = require('./inventory.service');
const trace = require('./traceability.service');

const router = express.Router();
router.use(requireAuth);

router.get('/warehouses', asyncHandler(async (req, res) => {
  let q = db('warehouses').where('is_active', true);
  if (req.query.legal_entity_id) q = q.andWhere('legal_entity_id', req.query.legal_entity_id);
  res.json(await q.orderBy('name'));
}));

router.post('/warehouses', requireRole('WAREHOUSE', 'FINANCE'),
  validate({ body: z.object({
    legal_entity_id: z.number().int(), code: z.string().max(20), name: z.string().max(150),
    address: z.string().max(300).optional(), gln: z.string().max(13).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (await db('warehouses').where({ legal_entity_id: b.legal_entity_id, code: b.code }).first()) {
      throw conflict('Warehouse code exists');
    }
    const [id] = await db('warehouses').insert(b);
    res.status(201).json(await db('warehouses').where({ id }).first());
  }));

const receiptBody = z.object({
  warehouse_id: z.number().int(),
  item_id: z.number().int(),
  batch_number: z.string().max(60),
  expiry_date: z.string(),
  manufacture_date: z.string().optional(),
  manufacturer: z.string().max(200).optional(),
  quantity: z.number().positive(),
  unit_cost: z.union([z.string(), z.number()]).optional(),
});

router.post('/receipts', requireRole('WAREHOUSE', 'FINANCE'), validate({ body: receiptBody }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const item = await db('items').where({ id: b.item_id, is_deleted: false }).first();
    if (!item) throw notFound('Item not found');
    const result = await db.transaction(async (trx) => {
      const batch = await inv.receiveStock(trx, {
        warehouseId: b.warehouse_id, itemId: b.item_id, batchNumber: b.batch_number,
        expiryDate: b.expiry_date, manufactureDate: b.manufacture_date,
        manufacturer: b.manufacturer, quantity: b.quantity,
        unitCostUnits4: b.unit_cost != null ? toUnits4(b.unit_cost) : null, userId: req.user.id,
      });
      // Traceability: commissioning event
      const wh = await trx('warehouses').where({ id: b.warehouse_id }).first();
      await trace.recordEvent(trx, {
        legalEntityId: wh.legal_entity_id, bizStep: 'commissioning', disposition: 'active',
        itemId: b.item_id, batchLotId: batch.id,
        epc: item.gtin ? `urn:epc:id:sgtin:${item.gtin}.${b.batch_number}` : null,
        quantity: b.quantity, refTable: 'batch_lots', refId: batch.id, userId: req.user.id,
      });
      return batch;
    });
    res.status(201).json(result);
  }));

router.get('/stock', asyncHandler(async (req, res) => {
  const { warehouse_id, item_id } = req.query;
  if (!warehouse_id || !item_id) throw notFound('warehouse_id and item_id required');
  res.json(await inv.stockOnHand(db, warehouse_id, item_id));
}));

module.exports = router;
