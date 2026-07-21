'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler, notFound } = require('../lib/http');
const { requireAuth, requireRole } = require('../middleware/security');
const { fromCents } = require('../lib/money');
const gl = require('./gl.service');

const router = express.Router();
router.use(requireAuth);

router.get('/accounts', asyncHandler(async (req, res) => {
  res.json(await db('gl_accounts').where('is_deleted', false).orderBy('code'));
}));

router.get('/trial-balance', requireRole('FINANCE', 'VIEWER'), asyncHandler(async (req, res) => {
  const { legal_entity_id, as_of } = req.query;
  if (!legal_entity_id) throw notFound('legal_entity_id required');
  const rows = await gl.trialBalance(db, Number(legal_entity_id), as_of || null);
  const out = rows.map((r) => ({
    ...r, debit: fromCents(r.debit_cents), credit: fromCents(r.credit_cents),
    balance: fromCents(r.balance_cents),
  }));
  const totalDr = rows.reduce((a, r) => a + r.debit_cents, 0);
  const totalCr = rows.reduce((a, r) => a + r.credit_cents, 0);
  res.json({ rows: out, totals: { debit: fromCents(totalDr), credit: fromCents(totalCr), balanced: totalDr === totalCr } });
}));

router.get('/journals', requireRole('FINANCE', 'VIEWER'), asyncHandler(async (req, res) => {
  let q = db('gl_journal_batches');
  if (req.query.legal_entity_id) q = q.where('legal_entity_id', req.query.legal_entity_id);
  res.json(await q.orderBy('id', 'desc').limit(200));
}));

module.exports = router;
