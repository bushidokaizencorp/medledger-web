'use strict';
/**
 * 006 — Posting groups (Dynamics/Business Central style).
 *
 * Instead of hard-wiring each master record to its GL accounts, documents
 * resolve accounts through a matrix:
 *
 *   customer_posting_groups  -> receivables account (who owes)
 *   inventory_posting_groups -> inventory / COGS / revenue accounts (what)
 *   vat_posting_groups       -> VAT bus. group x VAT product group -> VAT accounts + rate
 *
 * A customer carries a customer posting group and a VAT business posting group.
 * An item carries an inventory posting group and a VAT product posting group.
 * The VAT setup row at the intersection of (business, product) group gives the
 * rate and the input/output VAT accounts. This is what lets you re-map the
 * whole chart by editing setup rather than touching every master record.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('customer_posting_groups', (t) => {
    t.increments('id').primary();
    t.string('code', 20).notNullable().unique();
    t.string('name', 100).notNullable();
    t.integer('receivables_account_id').references('id').inTable('gl_accounts');
    t.integer('payment_disc_account_id').references('id').inTable('gl_accounts');
    t.integer('rounding_account_id').references('id').inTable('gl_accounts');
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('inventory_posting_groups', (t) => {
    t.increments('id').primary();
    t.string('code', 20).notNullable().unique();
    t.string('name', 100).notNullable();
    t.integer('inventory_account_id').references('id').inTable('gl_accounts');
    t.integer('cogs_account_id').references('id').inTable('gl_accounts');
    t.integer('revenue_account_id').references('id').inTable('gl_accounts');
    t.integer('adjustment_account_id').references('id').inTable('gl_accounts');
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  // The two axes of VAT determination.
  await knex.schema.createTable('vat_business_groups', (t) => {
    t.increments('id').primary();
    t.string('code', 20).notNullable().unique();
    t.string('name', 100).notNullable(); // e.g. LOCAL, EXPORT, GOVT
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('vat_product_groups', (t) => {
    t.increments('id').primary();
    t.string('code', 20).notNullable().unique();
    t.string('name', 100).notNullable(); // e.g. STANDARD, ZERO, EXEMPT
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  // The intersection: rate + accounts for a (business, product) pairing.
  await knex.schema.createTable('vat_posting_setup', (t) => {
    t.increments('id').primary();
    t.integer('vat_business_group_id').notNullable()
      .references('id').inTable('vat_business_groups');
    t.integer('vat_product_group_id').notNullable()
      .references('id').inTable('vat_product_groups');
    t.decimal('vat_rate_percent', 9, 6).notNullable().defaultTo(0);
    t.string('vat_calculation_type', 20).notNullable().defaultTo('NORMAL'); // NORMAL/ZERO/EXEMPT/REVERSE
    t.integer('output_vat_account_id').references('id').inTable('gl_accounts'); // sales VAT payable
    t.integer('input_vat_account_id').references('id').inTable('gl_accounts'); // purchase VAT recoverable
    t.string('effective_from');
    t.string('effective_to');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['vat_business_group_id', 'vat_product_group_id']);
  });

  // Attach the groups to the masters. Nullable so existing account-per-master
  // columns keep working during transition; resolution prefers the group.
  await knex.schema.alterTable('items', (t) => {
    t.integer('inventory_posting_group_id').references('id').inTable('inventory_posting_groups');
    t.integer('vat_product_group_id').references('id').inTable('vat_product_groups');
  });

  await knex.schema.alterTable('customers', (t) => {
    t.integer('customer_posting_group_id').references('id').inTable('customer_posting_groups');
    t.integer('vat_business_group_id').references('id').inTable('vat_business_groups');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('customers', (t) => {
    t.dropColumn('customer_posting_group_id');
    t.dropColumn('vat_business_group_id');
  });
  await knex.schema.alterTable('items', (t) => {
    t.dropColumn('inventory_posting_group_id');
    t.dropColumn('vat_product_group_id');
  });
  for (const tbl of [
    'vat_posting_setup', 'vat_product_groups', 'vat_business_groups',
    'inventory_posting_groups', 'customer_posting_groups',
  ]) {
    await knex.schema.dropTableIfExists(tbl);
  }
};
