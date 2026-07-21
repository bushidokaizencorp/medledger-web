'use strict';
/** 003 — HR and Payroll (Zimbabwe statutory). Money is integer cents. */

exports.up = async function up(knex) {
  // ---- HR ----------------------------------------------------------------
  await knex.schema.createTable('hr_departments', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.string('code', 20).notNullable();
    t.string('name', 150).notNullable();
    t.integer('cost_centre_id').references('id').inTable('cost_centres');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['legal_entity_id', 'code']);
  });

  await knex.schema.createTable('hr_job_grades', (t) => {
    t.increments('id').primary();
    t.string('code', 20).notNullable().unique();
    t.string('name', 100).notNullable();
    t.string('nec_council_code', 30);
    t.bigInteger('min_salary_cents');
    t.bigInteger('max_salary_cents');
    t.string('salary_currency', 3).notNullable().defaultTo('USD');
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('hr_employees', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.string('employee_number', 30).notNullable().index();
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.string('national_id', 30); // PII — encrypt at rest in production
    t.string('date_of_birth');
    t.string('work_email', 200);
    t.string('mobile_number', 30);
    t.string('nssa_number', 30);
    t.string('zimra_tax_number', 30);
    t.string('bank_name', 100);
    t.string('bank_account_number', 50);
    t.string('payment_method', 20).notNullable().defaultTo('BANK_TRANSFER');
    t.integer('department_id').references('id').inTable('hr_departments');
    t.integer('cost_centre_id').references('id').inTable('cost_centres');
    t.integer('job_grade_id').references('id').inTable('hr_job_grades');
    t.integer('manager_id').references('id').inTable('hr_employees');
    t.string('hire_date').notNullable();
    t.string('termination_date');
    t.string('employment_status', 20).notNullable().defaultTo('ACTIVE');
    t.boolean('is_deleted').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.unique(['legal_entity_id', 'employee_number']);
  });

  await knex.schema.createTable('hr_contracts', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable().references('id').inTable('hr_employees');
    t.string('contract_type', 30).notNullable();
    t.string('start_date').notNullable();
    t.string('end_date');
    t.integer('job_grade_id').references('id').inTable('hr_job_grades');
    t.string('nec_council_code', 30);
    t.bigInteger('basic_salary_cents').notNullable();
    t.string('salary_currency', 3).notNullable().defaultTo('USD');
    t.string('pay_frequency', 20).notNullable().defaultTo('MONTHLY');
    t.decimal('annual_leave_days', 6, 2).notNullable().defaultTo(22);
    t.boolean('is_current').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('hr_leave_types', (t) => {
    t.increments('id').primary();
    t.string('code', 20).notNullable().unique();
    t.string('name', 100).notNullable();
    t.boolean('is_paid').notNullable().defaultTo(true);
    t.decimal('default_days_per_year', 6, 2);
    t.string('accrual_method', 20).notNullable().defaultTo('MONTHLY');
    t.boolean('carry_over_allowed').notNullable().defaultTo(false);
    t.boolean('requires_document').notNullable().defaultTo(false);
    t.string('statutory_basis', 120);
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('hr_leave_balances', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable().references('id').inTable('hr_employees');
    t.integer('leave_type_id').notNullable().references('id').inTable('hr_leave_types');
    t.integer('leave_year').notNullable();
    t.decimal('opening_days', 6, 2).notNullable().defaultTo(0);
    t.decimal('accrued_days', 6, 2).notNullable().defaultTo(0);
    t.decimal('taken_days', 6, 2).notNullable().defaultTo(0);
    t.decimal('adjustment_days', 6, 2).notNullable().defaultTo(0);
    t.unique(['employee_id', 'leave_type_id', 'leave_year']);
  });

  await knex.schema.createTable('hr_leave_requests', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable().references('id').inTable('hr_employees');
    t.integer('leave_type_id').notNullable().references('id').inTable('hr_leave_types');
    t.string('start_date').notNullable();
    t.string('end_date').notNullable();
    t.decimal('days_requested', 6, 2).notNullable();
    t.string('reason', 400);
    t.string('status', 15).notNullable().defaultTo('PENDING'); // PENDING/APPROVED/REJECTED/CANCELLED
    t.integer('approved_by').references('id').inTable('hr_employees');
    t.string('approved_at');
    t.string('decision_note', 400);
    t.timestamps(true, true);
  });

  // ---- Payroll -----------------------------------------------------------
  await knex.schema.createTable('pay_nec_councils', (t) => {
    t.string('code', 30).primary();
    t.string('name', 200).notNullable();
    t.string('industry_sector', 100);
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('pay_components', (t) => {
    t.increments('id').primary();
    t.string('code', 30).notNullable().unique();
    t.string('name', 150).notNullable();
    t.string('component_type', 25).notNullable();
    t.string('category', 30);
    t.boolean('is_taxable').notNullable().defaultTo(true);
    t.boolean('is_nssable').notNullable().defaultTo(true);
    t.boolean('is_pensionable').notNullable().defaultTo(true);
    t.boolean('is_necable').notNullable().defaultTo(true);
    t.string('calculation_type', 20).notNullable().defaultTo('FIXED');
    t.bigInteger('default_amount_cents');
    t.decimal('default_percent', 9, 6);
    t.integer('expense_account_id').references('id').inTable('gl_accounts');
    t.integer('liability_account_id').references('id').inTable('gl_accounts');
    t.integer('display_order').notNullable().defaultTo(100);
    t.boolean('show_on_payslip').notNullable().defaultTo(true);
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('pay_employee_components', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable().references('id').inTable('hr_employees').index();
    t.integer('pay_component_id').notNullable().references('id').inTable('pay_components');
    t.bigInteger('amount_cents');
    t.decimal('percent', 9, 6);
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.string('effective_from').notNullable();
    t.string('effective_to');
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('pay_tax_tables', (t) => {
    t.increments('id').primary();
    t.string('code', 40).notNullable().index();
    t.string('name', 150).notNullable();
    t.string('currency', 3).notNullable();
    t.string('pay_frequency', 20).notNullable();
    t.string('effective_from').notNullable();
    t.string('effective_to');
    t.string('legislative_ref', 200);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['code', 'effective_from']);
  });

  await knex.schema.createTable('pay_tax_bands', (t) => {
    t.increments('id').primary();
    t.integer('tax_table_id').notNullable().references('id').inTable('pay_tax_tables');
    t.integer('band_order').notNullable();
    t.bigInteger('lower_bound_cents').notNullable();
    t.bigInteger('upper_bound_cents'); // null = open-ended
    t.decimal('rate_percent', 9, 6).notNullable();
    t.bigInteger('deductible_cents').notNullable().defaultTo(0);
    t.unique(['tax_table_id', 'band_order']);
  });

  await knex.schema.createTable('pay_statutory_rates', (t) => {
    t.increments('id').primary();
    t.string('code', 40).notNullable().index();
    t.string('name', 150).notNullable();
    t.string('currency', 3);
    t.string('basis_type', 30).notNullable();
    t.decimal('rate_percent', 9, 6);
    t.bigInteger('fixed_amount_cents');
    t.bigInteger('min_base_cents');
    t.bigInteger('max_base_cents');
    t.string('paid_by', 10).notNullable(); // EMPLOYEE/EMPLOYER
    t.string('nec_council_code', 30);
    t.string('effective_from').notNullable();
    t.string('effective_to');
    t.string('legislative_ref', 200);
    t.string('pay_component_code', 30);
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('pay_runs', (t) => {
    t.increments('id').primary();
    t.integer('legal_entity_id').notNullable().references('id').inTable('legal_entities');
    t.string('code', 30).notNullable();
    t.string('run_type', 20).notNullable().defaultTo('REGULAR');
    t.string('pay_frequency', 20).notNullable().defaultTo('MONTHLY');
    t.string('period_start').notNullable();
    t.string('period_end').notNullable();
    t.string('pay_date').notNullable();
    t.integer('fiscal_period_id').notNullable().references('id').inTable('fiscal_periods');
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.string('status', 15).notNullable().defaultTo('DRAFT');
    t.integer('employee_count').notNullable().defaultTo(0);
    t.bigInteger('total_gross_cents').notNullable().defaultTo(0);
    t.bigInteger('total_deductions_cents').notNullable().defaultTo(0);
    t.bigInteger('total_net_cents').notNullable().defaultTo(0);
    t.bigInteger('total_employer_cost_cents').notNullable().defaultTo(0);
    t.bigInteger('total_paye_cents').notNullable().defaultTo(0);
    t.string('calculated_at');
    t.integer('calculated_by').references('id').inTable('users');
    t.string('approved_at');
    t.integer('approved_by').references('id').inTable('users');
    t.string('posted_at');
    t.integer('posted_by').references('id').inTable('users');
    t.integer('journal_batch_id').references('id').inTable('gl_journal_batches');
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.unique(['legal_entity_id', 'code']);
  });

  await knex.schema.createTable('pay_payslips', (t) => {
    t.increments('id').primary();
    t.integer('run_id').notNullable().references('id').inTable('pay_runs');
    t.integer('employee_id').notNullable().references('id').inTable('hr_employees').index();
    t.integer('contract_id').references('id').inTable('hr_contracts');
    t.integer('cost_centre_id').references('id').inTable('cost_centres');
    t.integer('department_id').references('id').inTable('hr_departments');
    t.integer('tax_table_id').references('id').inTable('pay_tax_tables');
    t.string('nec_council_code', 30);
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.bigInteger('basic_pay_cents').notNullable().defaultTo(0);
    t.bigInteger('gross_pay_cents').notNullable().defaultTo(0);
    t.bigInteger('taxable_income_cents').notNullable().defaultTo(0);
    t.bigInteger('insurable_earnings_cents').notNullable().defaultTo(0);
    t.bigInteger('paye_cents').notNullable().defaultTo(0);
    t.bigInteger('aids_levy_cents').notNullable().defaultTo(0);
    t.bigInteger('total_deductions_cents').notNullable().defaultTo(0);
    t.bigInteger('total_employer_contrib_cents').notNullable().defaultTo(0);
    t.bigInteger('net_pay_cents').notNullable().defaultTo(0);
    t.string('payment_reference', 80);
    t.string('paid_at');
    t.unique(['run_id', 'employee_id']);
  });

  await knex.schema.createTable('pay_payslip_lines', (t) => {
    t.increments('id').primary();
    t.integer('payslip_id').notNullable().references('id').inTable('pay_payslips').index();
    t.integer('pay_component_id').references('id').inTable('pay_components');
    t.integer('statutory_rate_id').references('id').inTable('pay_statutory_rates');
    t.string('line_type', 25).notNullable();
    t.string('component_code', 30).notNullable();
    t.string('component_name', 150).notNullable();
    t.bigInteger('base_amount_cents');
    t.decimal('applied_percent', 9, 6);
    t.bigInteger('amount_cents').notNullable();
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.string('calculation_note', 400);
    t.integer('display_order').notNullable().defaultTo(100);
  });

  await knex.schema.createTable('gl_posting_rules', (t) => {
    t.increments('id').primary();
    t.string('name', 150).notNullable();
    t.string('source_module', 30).notNullable().defaultTo('PAYROLL');
    t.integer('legal_entity_id').references('id').inTable('legal_entities');
    t.string('component_code', 30).index();
    t.integer('debit_account_id').references('id').inTable('gl_accounts');
    t.integer('credit_account_id').references('id').inTable('gl_accounts');
    t.integer('priority').notNullable().defaultTo(100);
    t.string('effective_from').notNullable();
    t.string('effective_to');
    t.boolean('is_active').notNullable().defaultTo(true);
  });
};

exports.down = async function down(knex) {
  for (const tbl of [
    'gl_posting_rules', 'pay_payslip_lines', 'pay_payslips', 'pay_runs',
    'pay_statutory_rates', 'pay_tax_bands', 'pay_tax_tables',
    'pay_employee_components', 'pay_components', 'pay_nec_councils',
    'hr_leave_requests', 'hr_leave_balances', 'hr_leave_types',
    'hr_contracts', 'hr_employees', 'hr_job_grades', 'hr_departments',
  ]) {
    await knex.schema.dropTableIfExists(tbl);
  }
};
