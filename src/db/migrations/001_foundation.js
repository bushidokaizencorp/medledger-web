'use strict';
/**
 * 001 — Foundation: identity, organisation, audit.
 *
 * Written in Knex's portable schema builder so the same migration runs on
 * SQLite (dev/test) and SQL Server (prod). Timestamps are stored as ISO-8601
 * strings for cross-dialect consistency. Money is integer cents (see lib/money).
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('roles', (t) => {
    t.increments('id').primary();
    t.string('code', 40).notNullable().unique();
    t.string('name', 100).notNullable();
    t.string('description', 300);
  });

  await knex.schema.createTable('legal_entities', (t) => {
    t.increments('id').primary();
    t.string('code', 20).notNullable().unique();
    t.string('name', 200).notNullable();
    t.integer('parent_entity_id').references('id').inTable('legal_entities');
    t.string('registration_number', 50);
    t.string('taxpayer_tin', 50); // ZIMRA BP number
    t.string('vat_number', 50);
    t.string('functional_currency', 3).notNullable().defaultTo('USD');
    t.string('nec_council_code', 30);
    t.boolean('is_consolidating').notNullable().defaultTo(true);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('email', 200).notNullable().unique();
    t.string('full_name', 200).notNullable();
    t.string('password_hash', 255).notNullable();
    t.integer('role_id').notNullable().references('id').inTable('roles');
    t.integer('legal_entity_id').references('id').inTable('legal_entities');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('is_deleted').notNullable().defaultTo(false);
    t.integer('failed_login_count').notNullable().defaultTo(0);
    t.string('locked_until'); // ISO timestamp; set after repeated failures
    t.string('last_login_at');
    t.timestamps(true, true);
  });

  // Refresh-token registry so individual sessions can be revoked.
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.increments('id').primary();
    t.string('jti', 64).notNullable().unique();
    t.integer('user_id').notNullable().references('id').inTable('users');
    t.string('expires_at').notNullable();
    t.boolean('revoked').notNullable().defaultTo(false);
    t.string('created_at').notNullable();
  });

  await knex.schema.createTable('audit_log', (t) => {
    t.increments('id').primary();
    t.string('at').notNullable().index();
    t.integer('user_id').references('id').inTable('users');
    t.string('action', 60).notNullable().index();
    t.string('entity_type', 60).notNullable();
    t.string('entity_id', 60);
    t.text('detail');
  });

  await knex.schema.createTable('cost_centres', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.string('code', 20).notNullable();
    t.string('name', 150).notNullable();
    t.integer('parent_cost_centre_id').references('id').inTable('cost_centres');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['legal_entity_id', 'code']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('cost_centres');
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('legal_entities');
  await knex.schema.dropTableIfExists('roles');
};
