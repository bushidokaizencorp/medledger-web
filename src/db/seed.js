'use strict';
/**
 * Seed reference data + a demo entity.
 *
 *   node src/db/seed.js            full seed (reference + demo company + users)
 *   node src/db/seed.js --minimal  reference data only
 *
 * Statutory figures (PAYE bands, NSSA, levies) carry the correct STRUCTURE but
 * the amounts are placeholders — marked VERIFY — pending confirmation against
 * the current Finance Act and ZIMRA tables before any real payroll.
 */
const db = require('../db');
const { hashPassword } = require('../lib/auth');
const { toCents, toUnits4 } = require('../lib/money');

const VERIFY = 'VERIFY against current Finance Act / ZIMRA tables before go-live';
const now = () => new Date().toISOString();

const ROLES = [
  ['ADMIN', 'Administrator', 'Full system access'],
  ['FINANCE', 'Finance', 'GL, posting, reporting'],
  ['HR', 'Human Resources', 'Employee and contract management'],
  ['PAYROLL', 'Payroll Officer', 'Calculate payroll runs'],
  ['APPROVER', 'Approver', 'Approve payroll and journals'],
  ['SALES', 'Sales', 'Quotations, invoices, customers'],
  ['WAREHOUSE', 'Warehouse', 'Inventory, receipts, dispatch'],
  ['VIEWER', 'Viewer', 'Read-only'],
];

const CURRENCIES = [
  ['USD', 'United States Dollar', '$'],
  ['ZWG', 'Zimbabwe Gold', 'ZiG'],
  ['ZAR', 'South African Rand', 'R'],
];

// code, name, type, subtype, normal_balance
const ACCOUNTS = [
  ['1000', 'Bank — USD', 'ASSET', 'CURRENT_ASSET', 'DR'],
  ['1100', 'Accounts Receivable', 'ASSET', 'CURRENT_ASSET', 'DR'],
  ['1200', 'Inventory', 'ASSET', 'CURRENT_ASSET', 'DR'],
  ['1400', 'Staff Loans Receivable', 'ASSET', 'CURRENT_ASSET', 'DR'],
  ['1510', 'Input VAT (Recoverable)', 'ASSET', 'TAX', 'DR'],
  ['2100', 'Accounts Payable', 'LIABILITY', 'CURRENT_LIABILITY', 'CR'],
  ['2200', 'Net Salaries Payable', 'LIABILITY', 'PAYROLL_LIABILITY', 'CR'],
  ['2210', 'PAYE Payable', 'LIABILITY', 'PAYROLL_LIABILITY', 'CR'],
  ['2215', 'AIDS Levy Payable', 'LIABILITY', 'PAYROLL_LIABILITY', 'CR'],
  ['2220', 'NSSA Payable', 'LIABILITY', 'PAYROLL_LIABILITY', 'CR'],
  ['2230', 'NEC Dues Payable', 'LIABILITY', 'PAYROLL_LIABILITY', 'CR'],
  ['2240', 'ZIMDEF / SDL Payable', 'LIABILITY', 'PAYROLL_LIABILITY', 'CR'],
  ['2250', 'Pension Payable', 'LIABILITY', 'PAYROLL_LIABILITY', 'CR'],
  ['2260', 'Medical Aid Payable', 'LIABILITY', 'PAYROLL_LIABILITY', 'CR'],
  ['2510', 'Output VAT (Payable)', 'LIABILITY', 'TAX', 'CR'],
  ['3000', 'Retained Earnings', 'EQUITY', 'EQUITY', 'CR'],
  ['4000', 'Sales Revenue', 'REVENUE', 'REVENUE', 'CR'],
  ['5000', 'Cost of Goods Sold', 'EXPENSE', 'COGS', 'DR'],
  ['5050', 'Inventory Adjustments', 'EXPENSE', 'COGS', 'DR'],
  ['6000', 'Salaries & Wages', 'EXPENSE', 'PAYROLL_EXPENSE', 'DR'],
  ['6010', 'Allowances', 'EXPENSE', 'PAYROLL_EXPENSE', 'DR'],
  ['6100', 'Employer NSSA Contributions', 'EXPENSE', 'PAYROLL_EXPENSE', 'DR'],
  ['6110', 'Employer NEC Dues', 'EXPENSE', 'PAYROLL_EXPENSE', 'DR'],
  ['6120', 'ZIMDEF Levy', 'EXPENSE', 'PAYROLL_EXPENSE', 'DR'],
  ['6130', 'Standards Development Levy', 'EXPENSE', 'PAYROLL_EXPENSE', 'DR'],
];

async function seedReference(trx) {
  for (const [code, name, description] of ROLES) {
    const exists = await trx('roles').where({ code }).first();
    if (!exists) await trx('roles').insert({ code, name, description });
  }
  for (const [code, name, symbol] of CURRENCIES) {
    const exists = await trx('currencies').where({ code }).first();
    if (!exists) await trx('currencies').insert({ code, name, symbol });
  }
  for (const [code, name, account_type, account_subtype, normal_balance] of ACCOUNTS) {
    const exists = await trx('gl_accounts').where({ code, legal_entity_id: null }).first();
    if (!exists) {
      await trx('gl_accounts').insert({
        code, name, account_type, account_subtype, normal_balance,
        is_postable: true,
      });
    }
  }
}

async function acctId(trx, code) {
  const a = await trx('gl_accounts').where({ code }).first();
  return a ? a.id : null;
}

async function seedPostingGroups(trx) {
  // Customer posting group -> receivables
  if (!(await trx('customer_posting_groups').where({ code: 'LOCAL' }).first())) {
    await trx('customer_posting_groups').insert({
      code: 'LOCAL', name: 'Local Customers',
      receivables_account_id: await acctId(trx, '1100'),
    });
  }
  // Inventory posting group -> inventory/COGS/revenue
  if (!(await trx('inventory_posting_groups').where({ code: 'MEDS' }).first())) {
    await trx('inventory_posting_groups').insert({
      code: 'MEDS', name: 'Medicines',
      inventory_account_id: await acctId(trx, '1200'),
      cogs_account_id: await acctId(trx, '5000'),
      revenue_account_id: await acctId(trx, '4000'),
      adjustment_account_id: await acctId(trx, '5050'),
    });
  }
  // VAT business / product groups
  for (const [code, name] of [['LOCAL', 'Local'], ['EXPORT', 'Export'], ['GOVT', 'Government']]) {
    if (!(await trx('vat_business_groups').where({ code }).first())) {
      await trx('vat_business_groups').insert({ code, name });
    }
  }
  for (const [code, name] of [['STD', 'Standard-rated'], ['ZERO', 'Zero-rated'], ['EXEMPT', 'Exempt']]) {
    if (!(await trx('vat_product_groups').where({ code }).first())) {
      await trx('vat_product_groups').insert({ code, name });
    }
  }
  // VAT setup matrix: LOCAL x STD = 15%, LOCAL x ZERO = 0, LOCAL x EXEMPT = exempt
  const localBiz = await trx('vat_business_groups').where({ code: 'LOCAL' }).first();
  const outVat = await acctId(trx, '2510');
  const inVat = await acctId(trx, '1510');
  const setup = [
    ['STD', 15, 'NORMAL'],
    ['ZERO', 0, 'ZERO'],
    ['EXEMPT', 0, 'EXEMPT'],
  ];
  for (const [prodCode, rate, calc] of setup) {
    const prod = await trx('vat_product_groups').where({ code: prodCode }).first();
    const exists = await trx('vat_posting_setup')
      .where({ vat_business_group_id: localBiz.id, vat_product_group_id: prod.id })
      .first();
    if (!exists) {
      await trx('vat_posting_setup').insert({
        vat_business_group_id: localBiz.id,
        vat_product_group_id: prod.id,
        vat_rate_percent: rate,
        vat_calculation_type: calc,
        output_vat_account_id: outVat,
        input_vat_account_id: inVat,
        effective_from: '2026-01-01',
      });
    }
  }
}

async function seedFiscalCalendar(trx, entityId, year) {
  const existing = await trx('fiscal_years').where({ legal_entity_id: entityId, code: `FY${year}` }).first();
  if (existing) return;
  const [{ id: fyId }] = await trx('fiscal_years').insert({
    legal_entity_id: entityId, code: `FY${year}`,
    start_date: `${year}-01-01`, end_date: `${year}-12-31`, status: 'OPEN',
  }).returning('id');
  for (let m = 1; m <= 12; m += 1) {
    const start = new Date(Date.UTC(year, m - 1, 1));
    const end = new Date(Date.UTC(year, m, 0));
    await trx('fiscal_periods').insert({
      fiscal_year_id: fyId, period_number: m,
      name: start.toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10), status: 'OPEN',
    });
  }
}

async function seedDemo(trx) {
  let entity = await trx('legal_entities').where({ code: 'BKC' }).first();
  if (!entity) {
    const [{ id }] = await trx('legal_entities').insert({
      code: 'BKC', name: 'Bushido Kaizen Corporation (Pvt) Ltd',
      functional_currency: 'USD', nec_council_code: 'NEC_COMMERCE',
      taxpayer_tin: '2002506594', vat_number: null,
      created_at: now(), updated_at: now(),
    }).returning('id');
    entity = { id };
  }

  await seedFiscalCalendar(trx, entity.id, 2026);

  // A warehouse
  let warehouse = await trx('warehouses').where({ legal_entity_id: entity.id, code: 'MAIN' }).first();
  if (!warehouse) {
    const [{ id }] = await trx('warehouses').insert({
      legal_entity_id: entity.id, code: 'MAIN', name: 'Harare Main Warehouse',
      address: 'Harare, Zimbabwe', gln: '6001234000001',
    }).returning('id');
    warehouse = { id };
  }

  // Posting groups resolved to their ids
  const invGroup = await trx('inventory_posting_groups').where({ code: 'MEDS' }).first();
  const custGroup = await trx('customer_posting_groups').where({ code: 'LOCAL' }).first();
  const vatBiz = await trx('vat_business_groups').where({ code: 'LOCAL' }).first();
  const vatStd = await trx('vat_product_groups').where({ code: 'STD' }).first();

  // A couple of demo items
  const demoItems = [
    { sku: 'MED-PARA-500', name: 'Paracetamol 500mg Tablets', generic_name: 'Paracetamol',
      strength: '500mg', dosage_form: 'Tablet', unit_of_measure: 'TABLET',
      default_price_units4: toUnits4('0.0500'), requires_prescription: false,
      gtin: '06001234000018', mcaz_registration_no: 'MCAZ-2024-0001' },
    { sku: 'MED-AMOX-250', name: 'Amoxicillin 250mg Capsules', generic_name: 'Amoxicillin',
      strength: '250mg', dosage_form: 'Capsule', unit_of_measure: 'CAPSULE',
      default_price_units4: toUnits4('0.1500'), requires_prescription: true,
      gtin: '06001234000025', mcaz_registration_no: 'MCAZ-2024-0002' },
  ];
  for (const it of demoItems) {
    if (await trx('items').where({ sku: it.sku }).first()) continue;
    const [{ id }] = await trx('items').insert({
      ...it, item_type: 'MEDICINE', vat_rate_percent: 15, price_currency: 'USD',
      inventory_posting_group_id: invGroup ? invGroup.id : null,
      vat_product_group_id: vatStd ? vatStd.id : null,
      is_active: true, created_at: now(), updated_at: now(),
    }).returning('id');
    // Receive opening stock
    const [{ id: batchId }] = await trx('batch_lots').insert({
      item_id: id, batch_number: `B${it.sku.slice(-3)}2026`,
      expiry_date: '2028-12-31', manufacturer: 'Demo Pharma Ltd',
      cost_price_units4: toUnits4('0.0200'), status: 'ACTIVE',
      created_at: now(), updated_at: now(),
    }).returning('id');
    await trx('inventory_stock').insert({
      warehouse_id: warehouse.id, item_id: id, batch_lot_id: batchId,
      quantity_on_hand: 10000, quantity_reserved: 0,
    });
  }

  // A demo customer (with MCAZ licence so it can buy Rx items)
  if (!(await trx('customers').where({ legal_entity_id: entity.id, code: 'CUST001' }).first())) {
    await trx('customers').insert({
      legal_entity_id: entity.id, code: 'CUST001', name: 'City Pharmacy (Pvt) Ltd',
      customer_type: 'BUSINESS', tin: '2000987654', mcaz_licence_no: 'MCAZ-PH-0042',
      email: 'accounts@citypharmacy.co.zw', city: 'Harare',
      customer_posting_group_id: custGroup ? custGroup.id : null,
      vat_business_group_id: vatBiz ? vatBiz.id : null,
      credit_limit_cents: toCents('5000.00'), payment_terms_days: 30,
      created_at: now(), updated_at: now(),
    });
  }

  const users = [
    ['admin@bushidokaizen.co.zw', 'System Administrator', 'ADMIN'],
    ['finance@bushidokaizen.co.zw', 'Finance Officer', 'FINANCE'],
    ['hr@bushidokaizen.co.zw', 'HR Officer', 'HR'],
    ['payroll@bushidokaizen.co.zw', 'Payroll Officer', 'PAYROLL'],
    ['approver@bushidokaizen.co.zw', 'Payroll Approver', 'APPROVER'],
    ['sales@bushidokaizen.co.zw', 'Sales Officer', 'SALES'],
  ];
  const passwordHash = await hashPassword('ChangeMe123!');
  for (const [email, full_name, roleCode] of users) {
    if (await trx('users').where({ email }).first()) continue;
    const role = await trx('roles').where({ code: roleCode }).first();
    await trx('users').insert({
      email, full_name, password_hash: passwordHash,
      role_id: role.id, legal_entity_id: entity.id,
      created_at: now(), updated_at: now(),
    });
  }
}

async function main() {
  const minimal = process.argv.includes('--minimal');
  await db.transaction(async (trx) => {
    await seedReference(trx);
    await seedPostingGroups(trx);
    if (!minimal) await seedDemo(trx);
  });
  // eslint-disable-next-line no-console
  console.log('Seed complete.');
  if (!minimal) {
    // eslint-disable-next-line no-console
    console.log('\n  Login: admin@bushidokaizen.co.zw / ChangeMe123!');
    console.log('  Also:  finance@ / hr@ / payroll@ / approver@ / sales@  (same password)');
  }
  // eslint-disable-next-line no-console
  console.log(`\n  ${VERIFY}`);
  await db.destroy();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
