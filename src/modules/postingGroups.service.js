'use strict';
/**
 * Account determination via posting groups (Business Central style).
 *
 * An invoice line needs three accounts:
 *   revenue  — from the item's inventory posting group
 *   COGS     — from the item's inventory posting group
 *   inventory— from the item's inventory posting group
 * plus VAT accounts + rate from the VAT setup at the intersection of the
 * customer's VAT business group and the item's VAT product group.
 * The customer's receivable comes from its customer posting group.
 *
 * Resolution prefers the posting group; if a master still carries a direct
 * account (legacy), that is used as a fallback so nothing silently drops.
 */
const { HttpError } = require('../lib/http');

class DeterminationError extends HttpError {
  constructor(message) { super(422, message); }
}

async function customerAccounts(trx, customer) {
  let receivable = null;
  if (customer.customer_posting_group_id) {
    const g = await trx('customer_posting_groups').where('id', customer.customer_posting_group_id).first();
    if (g) receivable = g.receivables_account_id;
  }
  if (!receivable && customer.receivable_account_id) receivable = customer.receivable_account_id;
  if (!receivable) {
    throw new DeterminationError(
      `Customer ${customer.code} has no receivables account — set a customer posting group`
    );
  }
  return { receivableAccountId: receivable };
}

async function itemAccounts(trx, item) {
  let revenue = null; let cogs = null; let inventory = null; let adjustment = null;
  if (item.inventory_posting_group_id) {
    const g = await trx('inventory_posting_groups').where('id', item.inventory_posting_group_id).first();
    if (g) {
      revenue = g.revenue_account_id;
      cogs = g.cogs_account_id;
      inventory = g.inventory_account_id;
      adjustment = g.adjustment_account_id;
    }
  }
  revenue = revenue || item.revenue_account_id;
  inventory = inventory || item.inventory_account_id;
  cogs = cogs || item.cogs_account_id;
  if (!revenue) {
    throw new DeterminationError(
      `Item ${item.sku} has no revenue account — set an inventory posting group`
    );
  }
  return { revenueAccountId: revenue, cogsAccountId: cogs, inventoryAccountId: inventory, adjustmentAccountId: adjustment };
}

/**
 * VAT determination. Returns { ratePercent, calcType, outputAccountId,
 * inputAccountId }. Falls back to the item's own vat_rate_percent /
 * vat_exempt if no posting-group setup is found.
 */
async function vatSetup(trx, customer, item) {
  if (customer.vat_business_group_id && item.vat_product_group_id) {
    const setup = await trx('vat_posting_setup')
      .where('vat_business_group_id', customer.vat_business_group_id)
      .andWhere('vat_product_group_id', item.vat_product_group_id)
      .andWhere('is_active', true)
      .first();
    if (setup) {
      return {
        ratePercent: Number(setup.vat_rate_percent),
        calcType: setup.vat_calculation_type,
        outputAccountId: setup.output_vat_account_id,
        inputAccountId: setup.input_vat_account_id,
      };
    }
  }
  // Fallback: item's own flags.
  return {
    ratePercent: item.vat_exempt ? 0 : Number(item.vat_rate_percent || 0),
    calcType: item.vat_exempt ? 'EXEMPT' : 'NORMAL',
    outputAccountId: null,
    inputAccountId: null,
  };
}

module.exports = { DeterminationError, customerAccounts, itemAccounts, vatSetup };
