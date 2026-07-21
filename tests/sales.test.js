import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

let app, salesH, finH, ctx = {};
beforeAll(async () => {
  app = (await import('../src/app.js')).createApp();
  const login = async (email) => {
    const r = await request(app).post('/api/auth/login').send({ email, password: 'ChangeMe123!' });
    return { Authorization: `Bearer ${r.body.access_token}` };
  };
  salesH = await login('sales@bushidokaizen.co.zw');
  finH = await login('finance@bushidokaizen.co.zw');
  const items = (await request(app).get('/api/items').set(salesH)).body;
  ctx.para = items.find((i) => i.sku === 'MED-PARA-500');
  ctx.amox = items.find((i) => i.sku === 'MED-AMOX-250');
  ctx.cust = (await request(app).get('/api/customers?legal_entity_id=1').set(salesH)).body[0];
  ctx.wh = (await request(app).get('/api/inventory/warehouses?legal_entity_id=1').set(salesH)).body[0];
});

describe('invoicing → GL → fiscalisation', () => {
  it('creates an invoice with VAT resolved via posting groups', async () => {
    const r = await request(app).post('/api/sales/invoices').set(salesH).send({
      legal_entity_id: 1, customer_id: ctx.cust.id, warehouse_id: ctx.wh.id,
      prices_include_vat: false,
      lines: [{ item_id: ctx.para.id, quantity: 200 }, { item_id: ctx.amox.id, quantity: 100 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.subtotal).toBe('25.00'); // 200*0.05 + 100*0.15
    expect(r.body.vat).toBe('3.75'); // 15%
    expect(r.body.total).toBe('28.75');
    ctx.invoiceId = r.body.id;
  });

  it('handles VAT-inclusive pricing', async () => {
    const r = await request(app).post('/api/sales/invoices').set(salesH).send({
      legal_entity_id: 1, customer_id: ctx.cust.id, warehouse_id: ctx.wh.id,
      prices_include_vat: true,
      lines: [{ item_id: ctx.para.id, quantity: 100, unit_price: 1.15 }], // 115.00 incl
    });
    expect(r.status).toBe(201);
    expect(r.body.subtotal).toBe('100.00');
    expect(r.body.vat).toBe('15.00');
    expect(r.body.total).toBe('115.00');
  });

  it('blocks a prescription item for a customer with no MCAZ licence', async () => {
    await request(app).post('/api/customers').set(salesH).send({
      legal_entity_id: 1, code: 'NOLIC2', name: 'No Licence Shop',
      customer_posting_group_id: 1, vat_business_group_id: 1,
    });
    const nolic = (await request(app).get('/api/customers?legal_entity_id=1').set(salesH)).body
      .find((c) => c.code === 'NOLIC2');
    const r = await request(app).post('/api/sales/invoices').set(salesH).send({
      legal_entity_id: 1, customer_id: nolic.id, warehouse_id: ctx.wh.id,
      lines: [{ item_id: ctx.amox.id, quantity: 5 }],
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/prescription-only/);
  });

  it('issues the invoice, posting a balanced GL journal', async () => {
    const r = await request(app).post(`/api/sales/invoices/${ctx.invoiceId}/issue`).set(salesH);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ISSUED');
    expect(r.body.gl_journal_batch_id).toBeTruthy();
  });

  it('fiscalises the issued invoice (FDMS simulator)', async () => {
    const r = await request(app).post(`/api/sales/invoices/${ctx.invoiceId}/fiscalise`).set(salesH);
    expect(r.status).toBe(200);
    expect(r.body.fiscal_status).toBe('ACCEPTED');
    expect(r.body.fiscal_receipt_number).toMatch(/^FDMS-/);
  });

  it('refuses to fiscalise twice', async () => {
    const r = await request(app).post(`/api/sales/invoices/${ctx.invoiceId}/fiscalise`).set(salesH);
    expect(r.status).toBe(409);
  });

  it('produces a balanced trial balance', async () => {
    const r = await request(app).get('/api/gl/trial-balance?legal_entity_id=1').set(finH);
    expect(r.status).toBe(200);
    expect(r.body.totals.balanced).toBe(true);
  });

  it('dispenses stock by FEFO (reduces on-hand)', async () => {
    const stock = (await request(app)
      .get(`/api/inventory/stock?warehouse_id=${ctx.wh.id}&item_id=${ctx.para.id}`).set(salesH)).body;
    const total = stock.reduce((a, s) => a + Number(s.quantity_on_hand), 0);
    expect(total).toBeLessThan(10000); // opening was 10000, some dispensed
  });
});

describe('authorisation', () => {
  it('stops a non-sales role creating an invoice', async () => {
    const r = await request(app).post('/api/sales/invoices').set(finH).send({
      legal_entity_id: 1, customer_id: ctx.cust.id, lines: [{ item_id: ctx.para.id, quantity: 1 }],
    });
    // FINANCE is not SALES; only SALES (or ADMIN) may create invoices
    expect([401, 403]).toContain(r.status);
  });
});
