'use strict';
/**
 * Inventory: batch/lot receipts and FEFO (First-Expiry-First-Out) allocation.
 *
 * Pharmaceutical stock must move by expiry, not arrival — you dispense the
 * batch that expires soonest so nothing dies on the shelf. Allocation walks
 * available batches in expiry order and never issues expired or recalled
 * stock. Every quantity change writes a stock_movements row.
 */
const { HttpError } = require('../lib/http');
const { iso, today } = require('../lib/dates');

class InventoryError extends HttpError {
  constructor(message) { super(422, message); }
}

/** Receive stock into a warehouse: creates/updates the batch and on-hand. */
async function receiveStock(trx, {
  warehouseId, itemId, batchNumber, expiryDate, manufactureDate = null,
  manufacturer = null, quantity, unitCostUnits4 = null, userId = null,
}) {
  if (Number(quantity) <= 0) throw new InventoryError('Receipt quantity must be positive');

  let batch = await trx('batch_lots').where({ item_id: itemId, batch_number: batchNumber }).first();
  if (!batch) {
    const [id] = await trx('batch_lots').insert({
      item_id: itemId, batch_number: batchNumber,
      manufacture_date: manufactureDate, expiry_date: expiryDate,
      manufacturer, cost_price_units4: unitCostUnits4, status: 'ACTIVE',
      created_at: iso(), updated_at: iso(),
    });
    batch = await trx('batch_lots').where({ id }).first();
  }

  const stock = await trx('inventory_stock').where({ warehouse_id: warehouseId, batch_lot_id: batch.id }).first();
  if (stock) {
    await trx('inventory_stock').where({ id: stock.id })
      .update({ quantity_on_hand: Number(stock.quantity_on_hand) + Number(quantity) });
  } else {
    await trx('inventory_stock').insert({
      warehouse_id: warehouseId, item_id: itemId, batch_lot_id: batch.id,
      quantity_on_hand: quantity, quantity_reserved: 0,
    });
  }

  await trx('stock_movements').insert({
    warehouse_id: warehouseId, item_id: itemId, batch_lot_id: batch.id,
    movement_type: 'RECEIPT', quantity, unit_cost_units4: unitCostUnits4,
    reference_table: 'batch_lots', reference_id: batch.id,
    created_by: userId, created_at: iso(),
  });
  return batch;
}

/**
 * Allocate `quantity` of an item from a warehouse by FEFO. Returns
 * [{ batchLotId, batchNumber, quantity, unitCostUnits4 }]. Throws if there
 * isn't enough sellable stock. Does not mutate — the caller issues.
 */
async function allocateFefo(trx, { warehouseId, itemId, quantity }) {
  const need = Number(quantity);
  if (need <= 0) throw new InventoryError('Quantity must be positive');

  const rows = await trx('inventory_stock as s')
    .join('batch_lots as b', 'b.id', 's.batch_lot_id')
    .where('s.warehouse_id', warehouseId)
    .andWhere('s.item_id', itemId)
    .andWhere('b.status', 'ACTIVE')
    .andWhere('b.expiry_date', '>=', today()) // never allocate expired stock
    .select('s.id as stock_id', 's.batch_lot_id', 's.quantity_on_hand',
      's.quantity_reserved', 'b.batch_number', 'b.expiry_date', 'b.cost_price_units4')
    .orderBy('b.expiry_date', 'asc'); // FEFO

  const plan = [];
  let remaining = need;
  for (const r of rows) {
    const available = Number(r.quantity_on_hand) - Number(r.quantity_reserved);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    plan.push({
      stockId: r.stock_id, batchLotId: r.batch_lot_id, batchNumber: r.batch_number,
      quantity: take, unitCostUnits4: r.cost_price_units4,
    });
    remaining -= take;
    if (remaining <= 0) break;
  }
  if (remaining > 0) {
    const have = need - remaining;
    throw new InventoryError(
      `Insufficient sellable stock for item ${itemId}: need ${need}, have ${have} (non-expired, active)`
    );
  }
  return plan;
}

/** Issue an allocation (reduce on-hand, log movements). */
async function issueAllocation(trx, { warehouseId, itemId, plan, refTable, refId, userId = null }) {
  for (const p of plan) {
    const stock = await trx('inventory_stock').where({ id: p.stockId }).first();
    await trx('inventory_stock').where({ id: p.stockId })
      .update({ quantity_on_hand: Number(stock.quantity_on_hand) - Number(p.quantity) });
    await trx('stock_movements').insert({
      warehouse_id: warehouseId, item_id: itemId, batch_lot_id: p.batchLotId,
      movement_type: 'ISSUE', quantity: -Number(p.quantity),
      unit_cost_units4: p.unitCostUnits4, reference_table: refTable, reference_id: refId,
      created_by: userId, created_at: iso(),
    });
  }
}

async function stockOnHand(trx, warehouseId, itemId) {
  const rows = await trx('inventory_stock as s')
    .join('batch_lots as b', 'b.id', 's.batch_lot_id')
    .where('s.warehouse_id', warehouseId)
    .andWhere('s.item_id', itemId)
    .select('b.batch_number', 'b.expiry_date', 'b.status',
      's.quantity_on_hand', 's.quantity_reserved')
    .orderBy('b.expiry_date');
  return rows;
}

module.exports = { InventoryError, receiveStock, allocateFefo, issueAllocation, stockOnHand };
