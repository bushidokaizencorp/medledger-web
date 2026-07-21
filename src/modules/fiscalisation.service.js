'use strict';
/**
 * ZIMRA FDMS fiscalisation.
 *
 * Runs in one of two modes (config: FDMS_MODE):
 *   simulator — builds the exact canonical payload and records a submission
 *               with a deterministic receipt/verification code, so the whole
 *               flow is testable end-to-end with no external dependency.
 *   live      — POSTs to the configured FDMS endpoint with the device
 *               credentials. (Requires your ZIMRA device certificate; the
 *               transport is stubbed until those are supplied.)
 *
 * Either way, every attempt is persisted to fdms_submissions with the request
 * and response payloads, so nothing about a fiscalised invoice is unauditable.
 */
const crypto = require('crypto');
const { env } = require('../config/env');
const { iso } = require('../lib/dates');
const { fromCents } = require('../lib/money');
const { HttpError, notFound } = require('../lib/http');

class FiscalError extends HttpError {
  constructor(status, message) { super(status, message); }
}

/** Build the canonical FDMS receipt payload from an invoice. */
async function buildPayload(trx, invoice) {
  const entity = await trx('legal_entities').where({ id: invoice.legal_entity_id }).first();
  const customer = await trx('customers').where({ id: invoice.customer_id }).first();
  const lines = await trx('invoice_lines').where({ invoice_id: invoice.id }).orderBy('line_number');

  return {
    deviceId: env.FDMS_DEVICE_ID || 'SIMULATOR-DEVICE',
    seller: {
      name: entity.name,
      tin: entity.taxpayer_tin || null,
      vatNumber: entity.vat_number || null,
    },
    buyer: {
      name: customer.name,
      tin: customer.tin || null,
      vatNumber: customer.vat_number || null,
    },
    receipt: {
      invoiceNumber: invoice.invoice_number,
      date: invoice.invoice_date,
      currency: invoice.currency,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        net: fromCents(l.line_net_cents),
        vatRate: Number(l.vat_rate_percent),
        vat: fromCents(l.line_vat_cents),
        total: fromCents(l.line_total_cents),
      })),
      totals: {
        subtotal: fromCents(invoice.subtotal_cents),
        vat: fromCents(invoice.vat_cents),
        total: fromCents(invoice.total_cents),
      },
    },
  };
}

/** Deterministic simulator response — mimics an FDMS acceptance. */
function simulateResponse(payload) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(payload.receipt)).digest('hex');
  const receiptNumber = `FDMS-${hash.slice(0, 12).toUpperCase()}`;
  const verificationCode = hash.slice(12, 28).toUpperCase();
  const qrUrl = `https://fdms.zimra.co.zw/verify/${receiptNumber}?vc=${verificationCode}`;
  return { status: 'ACCEPTED', receiptNumber, verificationCode, qrUrl };
}

/** Fiscalise an ISSUED invoice. Idempotent-ish: refuses if already accepted. */
async function fiscaliseInvoice(trx, invoiceId, userId = null) {
  const invoice = await trx('invoices').where({ id: invoiceId }).first();
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status === 'DRAFT') throw new FiscalError(400, 'Issue the invoice before fiscalising');
  if (invoice.fiscal_status === 'ACCEPTED') throw new FiscalError(409, 'Invoice already fiscalised');

  const payload = await buildPayload(trx, invoice);
  const priorAttempts = await trx('fdms_submissions').where({ invoice_id: invoiceId }).count({ c: '*' }).first();

  let response; let status; let errorMessage = null;
  try {
    if (env.FDMS_MODE === 'live') {
      // Live transport requires the ZIMRA device certificate + endpoint.
      throw new FiscalError(501, 'FDMS live mode not configured (device credentials required)');
    }
    response = simulateResponse(payload);
    status = 'ACCEPTED';
  } catch (e) {
    status = 'ERROR';
    errorMessage = e.message;
    response = { status: 'ERROR', error: e.message };
  }

  await trx('fdms_submissions').insert({
    legal_entity_id: invoice.legal_entity_id, invoice_id: invoiceId,
    device_id: payload.deviceId, attempt: Number(priorAttempts.c) + 1, status,
    request_payload: JSON.stringify(payload), response_payload: JSON.stringify(response),
    receipt_number: response.receiptNumber || null,
    verification_code: response.verificationCode || null,
    qr_url: response.qrUrl || null,
    error_message: errorMessage, mode: env.FDMS_MODE,
    submitted_at: iso(), created_at: iso(),
  });

  if (status === 'ACCEPTED') {
    await trx('invoices').where({ id: invoiceId }).update({
      fiscal_status: 'ACCEPTED',
      fiscal_receipt_number: response.receiptNumber,
      fiscal_verification_code: response.verificationCode,
      fiscal_qr_url: response.qrUrl,
      updated_at: iso(),
    });
  } else {
    await trx('invoices').where({ id: invoiceId }).update({ fiscal_status: 'REJECTED', updated_at: iso() });
    throw new FiscalError(502, `Fiscalisation failed: ${errorMessage}`);
  }
  return trx('invoices').where({ id: invoiceId }).first();
}

module.exports = { FiscalError, buildPayload, simulateResponse, fiscaliseInvoice };
