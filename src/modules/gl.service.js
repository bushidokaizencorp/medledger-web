'use strict';
/**
 * General Ledger posting service. Ported from the tested Python reference.
 *
 * Invariants (the whole point of a ledger):
 *   - A batch cannot post unless functional debits === functional credits.
 *   - A batch cannot post into a CLOSED period.
 *   - Posted batches are immutable; corrections are reversal batches.
 *   - Every posting names its source, so any GL figure traces back.
 *
 * All amounts are integer CENTS.
 */
const { HttpError } = require('../lib/http');
const { iso } = require('../lib/dates');

class PostingError extends HttpError {
  constructor(message) { super(400, message); }
}

async function resolvePeriod(trx, legalEntityId, onDate) {
  const period = await trx('fiscal_periods as fp')
    .join('fiscal_years as fy', 'fy.id', 'fp.fiscal_year_id')
    .where('fy.legal_entity_id', legalEntityId)
    .andWhere('fp.start_date', '<=', onDate)
    .andWhere('fp.end_date', '>=', onDate)
    .select('fp.*')
    .first();
  if (!period) throw new PostingError(`No fiscal period covers ${onDate}`);
  return period;
}

async function accountByCode(trx, code, legalEntityId) {
  const acct = await trx('gl_accounts')
    .where('code', code)
    .andWhere((q) => q.where('legal_entity_id', legalEntityId).orWhereNull('legal_entity_id'))
    .andWhere('is_deleted', false)
    .orderBy('legal_entity_id', 'desc')
    .first();
  if (!acct) throw new PostingError(`GL account ${code} does not exist`);
  if (!acct.is_postable) throw new PostingError(`GL account ${code} is not postable`);
  return acct;
}

async function nextBatchNumber(trx, legalEntityId, prefix) {
  const row = await trx('gl_journal_batches')
    .where('legal_entity_id', legalEntityId)
    .andWhere('batch_number', 'like', `${prefix}%`)
    .count({ c: '*' })
    .first();
  return `${prefix}-${String(Number(row.c) + 1).padStart(5, '0')}`;
}

/**
 * Create a DRAFT batch. lines: [{ accountCode, debitCents, creditCents,
 * costCentreId, memo }]. Balance is checked at post time, not here.
 */
async function createBatch(trx, {
  legalEntityId, journalDate, sourceModule, lines, description,
  currency = 'USD', exchangeRateMicro = 1000000,
  sourceRefTable = null, sourceRefId = null, createdBy = null,
}) {
  if (!lines || !lines.length) throw new PostingError('A journal needs at least one line');
  const period = await resolvePeriod(trx, legalEntityId, journalDate);
  if (period.status === 'CLOSED') {
    throw new PostingError(`Period ${period.name} is CLOSED`);
  }

  const batchNumber = await nextBatchNumber(trx, legalEntityId, sourceModule.slice(0, 3).toUpperCase());
  const [batchId] = await trx('gl_journal_batches').insert({
    legal_entity_id: legalEntityId,
    fiscal_period_id: period.id,
    batch_number: batchNumber,
    journal_date: journalDate,
    source_module: sourceModule,
    source_ref_table: sourceRefTable,
    source_ref_id: sourceRefId,
    description,
    status: 'DRAFT',
    created_by: createdBy,
    created_at: iso(), updated_at: iso(),
  });

  let lineNo = 0;
  for (const l of lines) {
    const debit = Number(l.debitCents || 0);
    const credit = Number(l.creditCents || 0);
    if (debit > 0 && credit > 0) throw new PostingError(`Line has both debit and credit`);
    if (debit === 0 && credit === 0) continue; // skip zero lines
    const acct = await accountByCode(trx, l.accountCode, legalEntityId);
    if (acct.requires_cost_centre && !l.costCentreId) {
      throw new PostingError(`Account ${acct.code} requires a cost centre`);
    }
    lineNo += 1;
    await trx('gl_journal_lines').insert({
      batch_id: batchId,
      line_number: lineNo,
      account_id: acct.id,
      cost_centre_id: l.costCentreId || null,
      txn_currency: currency,
      txn_debit_cents: debit,
      txn_credit_cents: credit,
      exchange_rate_micro: exchangeRateMicro,
      func_debit_cents: Math.round((debit * exchangeRateMicro) / 1000000),
      func_credit_cents: Math.round((credit * exchangeRateMicro) / 1000000),
      memo: l.memo || null,
      employee_id: l.employeeId || null,
    });
  }
  return batchId;
}

async function batchTotals(trx, batchId) {
  const rows = await trx('gl_journal_lines').where('batch_id', batchId)
    .select('func_debit_cents', 'func_credit_cents');
  const debit = rows.reduce((a, r) => a + Number(r.func_debit_cents), 0);
  const credit = rows.reduce((a, r) => a + Number(r.func_credit_cents), 0);
  return { debit, credit, balanced: debit === credit, lineCount: rows.length };
}

async function postBatch(trx, batchId, userId = null) {
  const batch = await trx('gl_journal_batches').where('id', batchId).first();
  if (!batch) throw new PostingError('Batch not found');
  if (batch.status !== 'DRAFT') throw new PostingError(`Batch ${batch.batch_number} is ${batch.status}, not DRAFT`);

  const totals = await batchTotals(trx, batchId);
  if (totals.lineCount === 0) throw new PostingError('Batch has no lines');
  if (!totals.balanced) {
    throw new PostingError(
      `Batch ${batch.batch_number} out of balance: debits ${totals.debit} vs credits ${totals.credit}`
    );
  }
  const period = await trx('fiscal_periods').where('id', batch.fiscal_period_id).first();
  if (period.status === 'CLOSED') throw new PostingError(`Period ${period.name} is CLOSED`);

  await trx('gl_journal_batches').where('id', batchId).update({
    status: 'POSTED', posted_at: iso(), posted_by: userId, updated_at: iso(),
  });
  return batch;
}

async function reverseBatch(trx, batchId, onDate, userId = null) {
  const batch = await trx('gl_journal_batches').where('id', batchId).first();
  if (!batch || batch.status !== 'POSTED') throw new PostingError('Only a POSTED batch can be reversed');
  const lines = await trx('gl_journal_lines as jl')
    .join('gl_accounts as a', 'a.id', 'jl.account_id')
    .where('jl.batch_id', batchId)
    .select('jl.*', 'a.code as account_code');

  const mirror = lines.map((l) => ({
    accountCode: l.account_code,
    debitCents: l.txn_credit_cents,
    creditCents: l.txn_debit_cents,
    costCentreId: l.cost_centre_id,
    memo: `Reversal of ${batch.batch_number} line ${l.line_number}`,
  }));

  const revId = await createBatch(trx, {
    legalEntityId: batch.legal_entity_id,
    journalDate: onDate,
    sourceModule: batch.source_module,
    lines: mirror,
    description: `Reversal of ${batch.batch_number}`,
    currency: lines[0].txn_currency,
    createdBy: userId,
  });
  await trx('gl_journal_batches').where('id', revId).update({
    is_reversal: true, reverses_batch_id: batchId,
  });
  await postBatch(trx, revId, userId);
  await trx('gl_journal_batches').where('id', batchId).update({ status: 'REVERSED', updated_at: iso() });
  return revId;
}

async function trialBalance(trx, legalEntityId, asOf = null) {
  let q = trx('gl_journal_lines as jl')
    .join('gl_accounts as a', 'a.id', 'jl.account_id')
    .join('gl_journal_batches as b', 'b.id', 'jl.batch_id')
    .where('b.legal_entity_id', legalEntityId)
    .andWhere('b.status', 'POSTED');
  if (asOf) q = q.andWhere('b.journal_date', '<=', asOf);
  const rows = await q
    .groupBy('a.code', 'a.name', 'a.account_type')
    .select('a.code as account_code', 'a.name as account_name', 'a.account_type')
    .sum({ debit: 'jl.func_debit_cents' })
    .sum({ credit: 'jl.func_credit_cents' })
    .orderBy('a.code');
  return rows.map((r) => ({
    account_code: r.account_code,
    account_name: r.account_name,
    account_type: r.account_type,
    debit_cents: Number(r.debit || 0),
    credit_cents: Number(r.credit || 0),
    balance_cents: Number(r.debit || 0) - Number(r.credit || 0),
  }));
}

module.exports = {
  PostingError, resolvePeriod, accountByCode, createBatch,
  batchTotals, postBatch, reverseBatch, trialBalance,
};
