'use strict';
/** 002 — General Ledger: accounts, currencies, fiscal calendar, journals. */

exports.up = async function up(knex) {
  await knex.schema.createTable('currencies', (t) => {
    t.string('code', 3).primary();
    t.string('name', 60).notNullable();
    t.string('symbol', 10);
    t.integer('decimal_places').notNullable().defaultTo(2);
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('exchange_rates', (t) => {
    t.increments('id').primary();
    t.string('from_currency', 3).notNullable().references('code').inTable('currencies');
    t.string('to_currency', 3).notNullable().references('code').inTable('currencies');
    t.string('rate_date').notNullable();
    t.bigInteger('rate_micro').notNullable(); // rate * 1e6, integer
    t.string('source', 40).notNullable().defaultTo('MANUAL');
    t.unique(['from_currency', 'to_currency', 'rate_date', 'source']);
  });

  await knex.schema.createTable('gl_accounts', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').references('id').inTable('legal_entities'); // null = shared
    t.string('code', 20).notNullable().index();
    t.string('name', 200).notNullable();
    t.string('account_type', 20).notNullable(); // ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE
    t.string('account_subtype', 40);
    t.string('normal_balance', 2).notNullable(); // DR/CR
    t.integer('parent_account_id').references('id').inTable('gl_accounts');
    t.boolean('is_postable').notNullable().defaultTo(true);
    t.boolean('is_control_account').notNullable().defaultTo(false);
    t.boolean('requires_cost_centre').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('is_deleted').notNullable().defaultTo(false);
    t.unique(['code', 'legal_entity_id']);
  });

  await knex.schema.createTable('fiscal_years', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.string('code', 10).notNullable();
    t.string('start_date').notNullable();
    t.string('end_date').notNullable();
    t.string('status', 10).notNullable().defaultTo('OPEN');
    t.unique(['legal_entity_id', 'code']);
  });

  await knex.schema.createTable('fiscal_periods', (t) => {
    t.increments('id').primary();
    t.integer('fiscal_year_id').notNullable().references('id').inTable('fiscal_years');
    t.integer('period_number').notNullable();
    t.string('name', 30).notNullable();
    t.string('start_date').notNullable();
    t.string('end_date').notNullable();
    t.string('status', 12).notNullable().defaultTo('OPEN'); // OPEN/SOFT_CLOSED/CLOSED
    t.string('closed_at');
    t.unique(['fiscal_year_id', 'period_number']);
  });

  await knex.schema.createTable('gl_journal_batches', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.integer('fiscal_period_id').notNullable().references('id').inTable('fiscal_periods');
    t.string('batch_number', 30).notNullable().index();
    t.string('journal_date').notNullable();
    t.string('source_module', 30).notNullable();
    t.string('source_ref_table', 60);
    t.integer('source_ref_id');
    t.string('description', 400);
    t.string('status', 12).notNullable().defaultTo('DRAFT'); // DRAFT/POSTED/REVERSED
    t.boolean('is_reversal').notNullable().defaultTo(false);
    t.integer('reverses_batch_id').references('id').inTable('gl_journal_batches');
    t.string('posted_at');
    t.integer('posted_by').references('id').inTable('users');
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.unique(['legal_entity_id', 'batch_number']);
  });

  await knex.schema.createTable('gl_journal_lines', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').notNullable().references('id').inTable('gl_journal_batches');
    t.integer('line_number').notNullable();
    t.integer('account_id').notNullable().references('id').inTable('gl_accounts');
    t.integer('cost_centre_id').references('id').inTable('cost_centres');
    t.string('txn_currency', 3).notNullable();
    t.bigInteger('txn_debit_cents').notNullable().defaultTo(0);
    t.bigInteger('txn_credit_cents').notNullable().defaultTo(0);
    t.bigInteger('exchange_rate_micro').notNullable().defaultTo(1000000);
    t.bigInteger('func_debit_cents').notNullable().defaultTo(0);
    t.bigInteger('func_credit_cents').notNullable().defaultTo(0);
    t.string('memo', 400);
    t.integer('employee_id');
    t.unique(['batch_id', 'line_number']);
    t.index('account_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('gl_journal_lines');
  await knex.schema.dropTableIfExists('gl_journal_batches');
  await knex.schema.dropTableIfExists('fiscal_periods');
  await knex.schema.dropTableIfExists('fiscal_years');
  await knex.schema.dropTableIfExists('gl_accounts');
  await knex.schema.dropTableIfExists('exchange_rates');
  await knex.schema.dropTableIfExists('currencies');
};
