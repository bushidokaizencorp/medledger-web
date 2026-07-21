'use strict';
/**
 * 004 — Pharmaceutical trading: catalogue, batch/lot tracking, inventory,
 * customers, quotations, invoices. This is the core MedLedger domain that the
 * fiscalisation and traceability layers sit on top of.
 */

exports.up = async function up(knex) {
  // ---- Catalogue ---------------------------------------------------------
  await knex.schema.createTable('items', (t) => {
    t.increments('id').primary();
    t.string('sku', 40).notNullable().unique();
    t.string('name', 200).notNullable();
    t.string('description', 500);
    t.string('item_type', 20).notNullable().defaultTo('MEDICINE'); // MEDICINE/CONSUMABLE/SERVICE
    t.string('unit_of_measure', 20).notNullable().defaultTo('EACH');

    // Pharmaceutical attributes
    t.string('generic_name', 200);
    t.string('strength', 60);
    t.string('dosage_form', 60); // tablet, capsule, injection...
    t.string('atc_code', 20); // WHO Anatomical Therapeutic Chemical
    t.string('mcaz_registration_no', 60); // MCAZ product registration
    t.boolean('is_controlled_substance').notNullable().defaultTo(false);
    t.string('controlled_schedule', 20); // e.g. Schedule 8
    t.boolean('requires_prescription').notNullable().defaultTo(false);
    t.boolean('requires_cold_chain').notNullable().defaultTo(false);

    // GS1 identifiers for traceability
    t.string('gtin', 14); // Global Trade Item Number

    // Commercial
    t.bigInteger('default_price_units4'); // unit price at 4dp
    t.string('price_currency', 3).notNullable().defaultTo('USD');
    t.decimal('vat_rate_percent', 9, 6).notNullable().defaultTo(15);
    t.boolean('vat_exempt').notNullable().defaultTo(false);
    t.integer('revenue_account_id').references('id').inTable('gl_accounts');
    t.integer('inventory_account_id').references('id').inTable('gl_accounts');
    t.integer('cogs_account_id').references('id').inTable('gl_accounts');
    t.integer('reorder_level');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('is_deleted').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  // ---- Warehouses --------------------------------------------------------
  await knex.schema.createTable('warehouses', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.string('code', 20).notNullable();
    t.string('name', 150).notNullable();
    t.string('address', 300);
    t.string('gln', 13); // GS1 Global Location Number
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['legal_entity_id', 'code']);
  });

  // ---- Batch / lot tracking ---------------------------------------------
  await knex.schema.createTable('batch_lots', (t) => {
    t.increments('id').primary();
    t.integer('item_id').notNullable().references('id').inTable('items').index();
    t.string('batch_number', 60).notNullable();
    t.string('manufacture_date');
    t.string('expiry_date').notNullable().index();
    t.string('manufacturer', 200);
    t.string('country_of_origin', 100);
    t.string('serial_number', 100); // for serialised (aggregation) traceability
    t.bigInteger('cost_price_units4'); // unit cost at 4dp
    t.string('status', 20).notNullable().defaultTo('ACTIVE'); // ACTIVE/QUARANTINE/RECALLED/EXPIRED
    t.timestamps(true, true);
    t.unique(['item_id', 'batch_number']);
  });

  // ---- Inventory: on-hand per batch per warehouse ------------------------
  await knex.schema.createTable('inventory_stock', (t) => {
    t.increments('id').primary();
    t.integer('warehouse_id').notNullable().references('id').inTable('warehouses');
    t.integer('item_id').notNullable().references('id').inTable('items');
    t.integer('batch_lot_id').notNullable().references('id').inTable('batch_lots');
    t.decimal('quantity_on_hand', 18, 4).notNullable().defaultTo(0);
    t.decimal('quantity_reserved', 18, 4).notNullable().defaultTo(0);
    t.unique(['warehouse_id', 'batch_lot_id']);
  });

  // ---- Stock movements: the audit trail of every quantity change ---------
  await knex.schema.createTable('stock_movements', (t) => {
    t.increments('id').primary();
    t.integer('warehouse_id').notNullable().references('id').inTable('warehouses');
    t.integer('item_id').notNullable().references('id').inTable('items');
    t.integer('batch_lot_id').notNullable().references('id').inTable('batch_lots');
    t.string('movement_type', 20).notNullable(); // RECEIPT/ISSUE/ADJUSTMENT/TRANSFER/RETURN
    t.decimal('quantity', 18, 4).notNullable(); // signed: + in, - out
    t.bigInteger('unit_cost_units4'); // unit cost at 4dp
    t.string('reference_table', 40);
    t.integer('reference_id');
    t.string('note', 300);
    t.integer('created_by').references('id').inTable('users');
    t.string('created_at').notNullable().index();
  });

  // ---- Customers ---------------------------------------------------------
  await knex.schema.createTable('customers', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.string('code', 30).notNullable();
    t.string('name', 200).notNullable();
    t.string('customer_type', 20).notNullable().defaultTo('BUSINESS'); // BUSINESS/INDIVIDUAL/GOVT
    t.string('tin', 50); // ZIMRA taxpayer number
    t.string('vat_number', 50);
    t.string('mcaz_licence_no', 60); // pharmacy/wholesaler licence — required to buy Rx
    t.string('email', 200);
    t.string('phone', 40);
    t.string('address', 300);
    t.string('city', 100);
    t.bigInteger('credit_limit_cents').notNullable().defaultTo(0);
    t.integer('payment_terms_days').notNullable().defaultTo(0);
    t.integer('receivable_account_id').references('id').inTable('gl_accounts');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('is_deleted').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.unique(['legal_entity_id', 'code']);
  });

  // ---- Quotations --------------------------------------------------------
  await knex.schema.createTable('quotations', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.integer('customer_id').notNullable().references('id').inTable('customers');
    t.string('quote_number', 30).notNullable();
    t.string('quote_date').notNullable();
    t.string('valid_until');
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.boolean('prices_include_vat').notNullable().defaultTo(false); // document default
    t.string('status', 15).notNullable().defaultTo('DRAFT'); // DRAFT/SENT/ACCEPTED/DECLINED/EXPIRED/CONVERTED
    t.bigInteger('subtotal_cents').notNullable().defaultTo(0);
    t.bigInteger('vat_cents').notNullable().defaultTo(0);
    t.bigInteger('total_cents').notNullable().defaultTo(0);
    t.string('notes', 500);
    t.integer('converted_invoice_id');
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.unique(['legal_entity_id', 'quote_number']);
  });

  await knex.schema.createTable('quotation_lines', (t) => {
    t.increments('id').primary();
    t.integer('quotation_id').notNullable().references('id').inTable('quotations').index();
    t.integer('line_number').notNullable();
    t.integer('item_id').notNullable().references('id').inTable('items');
    t.string('description', 300);
    t.decimal('quantity', 18, 4).notNullable();
    t.bigInteger('unit_price_units4').notNullable(); // 4dp
    t.decimal('discount_percent', 9, 6).notNullable().defaultTo(0);
    t.decimal('vat_rate_percent', 9, 6).notNullable().defaultTo(15);
    t.boolean('price_includes_vat').notNullable().defaultTo(false);
    t.bigInteger('line_net_cents').notNullable();
    t.bigInteger('line_vat_cents').notNullable();
    t.bigInteger('line_total_cents').notNullable();
    t.unique(['quotation_id', 'line_number']);
  });

  // ---- Invoices ----------------------------------------------------------
  await knex.schema.createTable('invoices', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.integer('customer_id').notNullable().references('id').inTable('customers');
    t.integer('warehouse_id').references('id').inTable('warehouses');
    t.string('invoice_number', 30).notNullable();
    t.string('invoice_date').notNullable();
    t.string('due_date');
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.bigInteger('exchange_rate_micro').notNullable().defaultTo(1000000);
    t.boolean('prices_include_vat').notNullable().defaultTo(false); // document default
    t.string('status', 15).notNullable().defaultTo('DRAFT'); // DRAFT/ISSUED/PAID/PARTPAID/CANCELLED/CREDITED
    t.bigInteger('subtotal_cents').notNullable().defaultTo(0);
    t.bigInteger('vat_cents').notNullable().defaultTo(0);
    t.bigInteger('total_cents').notNullable().defaultTo(0);
    t.bigInteger('amount_paid_cents').notNullable().defaultTo(0);
    t.string('notes', 500);

    // Fiscalisation linkage (ZIMRA FDMS)
    t.string('fiscal_status', 20).notNullable().defaultTo('NOT_SUBMITTED'); // NOT_SUBMITTED/QUEUED/SUBMITTED/ACCEPTED/REJECTED
    t.string('fiscal_receipt_number', 60);
    t.string('fiscal_verification_code', 100);
    t.string('fiscal_qr_url', 300);

    t.integer('gl_journal_batch_id').references('id').inTable('gl_journal_batches');
    t.integer('quotation_id').references('id').inTable('quotations');
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.unique(['legal_entity_id', 'invoice_number']);
  });

  await knex.schema.createTable('invoice_lines', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices').index();
    t.integer('line_number').notNullable();
    t.integer('item_id').notNullable().references('id').inTable('items');
    t.integer('batch_lot_id').references('id').inTable('batch_lots'); // which batch was dispensed
    t.string('description', 300);
    t.decimal('quantity', 18, 4).notNullable();
    t.bigInteger('unit_price_units4').notNullable(); // 4dp
    t.decimal('discount_percent', 9, 6).notNullable().defaultTo(0);
    t.decimal('vat_rate_percent', 9, 6).notNullable().defaultTo(15);
    t.boolean('vat_exempt').notNullable().defaultTo(false);
    t.boolean('price_includes_vat').notNullable().defaultTo(false);
    t.bigInteger('line_net_cents').notNullable();
    t.bigInteger('line_vat_cents').notNullable();
    t.bigInteger('line_total_cents').notNullable();
    t.unique(['invoice_id', 'line_number']);
  });

  await knex.schema.createTable('payments', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.integer('customer_id').notNullable().references('id').inTable('customers');
    t.integer('invoice_id').references('id').inTable('invoices');
    t.string('payment_date').notNullable();
    t.string('method', 20).notNullable(); // CASH/BANK/MOBILE/CARD
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.bigInteger('amount_cents').notNullable();
    t.string('reference', 80);
    t.integer('gl_journal_batch_id').references('id').inTable('gl_journal_batches');
    t.integer('created_by').references('id').inTable('users');
    t.string('created_at').notNullable();
  });
};

exports.down = async function down(knex) {
  for (const tbl of [
    'payments', 'invoice_lines', 'invoices', 'quotation_lines', 'quotations',
    'customers', 'stock_movements', 'inventory_stock', 'batch_lots',
    'warehouses', 'items',
  ]) {
    await knex.schema.dropTableIfExists(tbl);
  }
};
