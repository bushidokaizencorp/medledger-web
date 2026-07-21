'use strict';
/**
 * 005 — Compliance layer: ZIMRA FDMS fiscalisation, MCAZ/EPCIS traceability,
 * and statutory return generation.
 *
 * These tables record the full submission lifecycle to the regulators so that
 * every fiscalised invoice and every traceability event is auditable and
 * replayable. Actual transmission runs through an adapter that is in
 * "simulator" mode until real credentials are configured.
 */

exports.up = async function up(knex) {
  // ---- ZIMRA FDMS submissions -------------------------------------------
  await knex.schema.createTable('fdms_submissions', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.integer('invoice_id').notNullable().references('id').inTable('invoices').index();
    t.string('device_id', 60);
    t.integer('attempt').notNullable().defaultTo(1);
    t.string('status', 20).notNullable().defaultTo('QUEUED'); // QUEUED/SENT/ACCEPTED/REJECTED/ERROR
    t.text('request_payload'); // canonical JSON sent to FDMS
    t.text('response_payload'); // raw FDMS response
    t.string('receipt_number', 60);
    t.string('verification_code', 100);
    t.string('qr_url', 300);
    t.string('error_code', 40);
    t.string('error_message', 400);
    t.string('mode', 12).notNullable().defaultTo('simulator'); // simulator/live
    t.string('submitted_at');
    t.string('created_at').notNullable();
  });

  // ---- MCAZ / EPCIS traceability events ----------------------------------
  // EPCIS 2.0 event catalogue: commissioning, shipping, receiving, dispensing,
  // decommissioning (expiry), and recall.
  await knex.schema.createTable('traceability_events', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.string('event_type', 30).notNullable(); // OBJECT/AGGREGATION/TRANSACTION/TRANSFORMATION
    t.string('biz_step', 60).notNullable(); // commissioning, shipping, receiving, dispensing, decommissioning
    t.string('disposition', 60); // active, in_transit, dispensed, recalled, expired
    t.integer('item_id').references('id').inTable('items');
    t.integer('batch_lot_id').references('id').inTable('batch_lots').index();
    t.string('epc', 120); // GS1 EPC / SGTIN
    t.decimal('quantity', 18, 4);
    t.string('reference_table', 40);
    t.integer('reference_id');
    t.string('event_time').notNullable();
    t.text('epcis_payload'); // full EPCIS 2.0 JSON
    t.string('submission_status', 20).notNullable().defaultTo('PENDING'); // PENDING/SENT/ACKED/ERROR
    t.string('mode', 12).notNullable().defaultTo('simulator');
    t.string('submitted_at');
    t.integer('created_by').references('id').inTable('users');
    t.string('created_at').notNullable();
  });

  // ---- Product recalls ---------------------------------------------------
  await knex.schema.createTable('recalls', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.integer('item_id').notNullable().references('id').inTable('items');
    t.integer('batch_lot_id').references('id').inTable('batch_lots');
    t.string('recall_reference', 60).notNullable();
    t.string('severity', 20).notNullable().defaultTo('CLASS_II'); // CLASS_I/II/III
    t.string('reason', 500).notNullable();
    t.string('status', 20).notNullable().defaultTo('OPEN'); // OPEN/IN_PROGRESS/CLOSED
    t.string('initiated_date').notNullable();
    t.string('closed_date');
    t.integer('created_by').references('id').inTable('users');
    t.string('created_at').notNullable();
  });

  // ---- Statutory returns (P2/P6 PAYE, NSSA schedules) --------------------
  await knex.schema.createTable('statutory_returns', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.string('return_type', 20).notNullable(); // PAYE_P2/PAYE_P6/NSSA_P4/NEC
    t.string('period_label', 30).notNullable(); // e.g. 2026-07 or 2026
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.integer('payroll_run_id').references('id').inTable('pay_runs');
    t.string('status', 15).notNullable().defaultTo('DRAFT'); // DRAFT/FINALISED/SUBMITTED
    t.bigInteger('total_amount_cents').notNullable().defaultTo(0);
    t.integer('employee_count').notNullable().defaultTo(0);
    t.text('detail_json'); // generated line detail
    t.string('generated_at');
    t.integer('generated_by').references('id').inTable('users');
    t.string('created_at').notNullable();
    t.unique(['legal_entity_id', 'return_type', 'period_label']);
  });
};

exports.down = async function down(knex) {
  for (const tbl of [
    'statutory_returns', 'recalls', 'traceability_events', 'fdms_submissions',
  ]) {
    await knex.schema.dropTableIfExists(tbl);
  }
};
