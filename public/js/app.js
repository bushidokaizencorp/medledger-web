'use strict';
/* MedLedger SPA shell. Vanilla JS, no build step. Each view renders into
   #content and wires its own actions. LE = legal entity 1 (demo). */
(function () {
  const LE = 1;
  const content = document.getElementById('content');
  const title = document.getElementById('viewTitle');
  const user = API.user();
  document.getElementById('userName').textContent = user.full_name || user.email || '';
  document.getElementById('avatar').textContent = (user.full_name || user.email || '?').slice(0, 1).toUpperCase();

  document.getElementById('logout').onclick = async () => {
    try { await API.post('/auth/logout', {}); } catch (e) {}
    sessionStorage.clear();
    window.location.href = '/pages/login.html';
  };

  // ---- modal helper ----
  const modalBg = document.getElementById('modalBg');
  document.getElementById('modalClose').onclick = () => modalBg.classList.remove('show');
  modalBg.onclick = (e) => { if (e.target === modalBg) modalBg.classList.remove('show'); };
  function modal(titleText, bodyHtml, footHtml) {
    document.getElementById('modalTitle').textContent = titleText;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalFoot').innerHTML = footHtml || '';
    modalBg.classList.add('show');
  }
  function closeModal() { modalBg.classList.remove('show'); }

  const money = (v) => (v == null ? '—' : Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tag = (text, cls) => `<span class="tag ${cls}">${esc(text)}</span>`;
  const statusTag = (s) => {
    const map = { ISSUED: 'ok', PAID: 'ok', ACCEPTED: 'ok', DRAFT: 'muted', PARTPAID: 'warn', REJECTED: 'warn', NOT_SUBMITTED: 'muted' };
    return tag(s, map[s] || 'muted');
  };

  // ---------------------------------------------------------------- views
  const views = {};

  views.dashboard = async () => {
    const [invoices, items, customers] = await Promise.all([
      API.get('/sales/invoices?legal_entity_id=' + LE),
      API.get('/items'),
      API.get('/customers?legal_entity_id=' + LE),
    ]);
    const issued = invoices.filter((i) => i.status !== 'DRAFT');
    const revenue = issued.reduce((a, i) => a + Number(i.subtotal), 0);
    const vat = issued.reduce((a, i) => a + Number(i.vat), 0);
    const fiscalised = invoices.filter((i) => i.fiscal_status === 'ACCEPTED').length;
    content.innerHTML = `
      <div class="cards">
        <div class="card"><div class="label">Revenue (excl VAT)</div><div class="value">$${money(revenue)}</div><div class="sub">${issued.length} issued invoices</div></div>
        <div class="card"><div class="label">Output VAT</div><div class="value gold">$${money(vat)}</div><div class="sub">collected</div></div>
        <div class="card"><div class="label">Catalogue</div><div class="value">${items.length}</div><div class="sub">active items</div></div>
        <div class="card"><div class="label">Customers</div><div class="value">${customers.length}</div><div class="sub">on file</div></div>
        <div class="card"><div class="label">Fiscalised</div><div class="value">${fiscalised}</div><div class="sub">of ${invoices.length} invoices</div></div>
      </div>
      <div class="panel"><div class="head"><h2>Recent invoices</h2><button class="btn gold sm" id="quickInv">New invoice</button></div>
        <div class="body" style="padding:0">${invoiceTable(invoices.slice(0, 8))}</div></div>`;
    document.getElementById('quickInv').onclick = () => go('invoices').then(newInvoice);
  };

  function invoiceTable(rows) {
    if (!rows.length) return '<div class="empty">No invoices yet.</div>';
    return `<table><thead><tr><th>Number</th><th>Date</th><th>Customer</th><th class="num">Total</th><th>Status</th><th>Fiscal</th><th></th></tr></thead><tbody>
      ${rows.map((i) => `<tr>
        <td><b>${esc(i.invoice_number)}</b></td><td>${esc(i.invoice_date)}</td>
        <td>#${i.customer_id}</td><td class="num">$${money(i.total)}</td>
        <td>${statusTag(i.status)}</td><td>${statusTag(i.fiscal_status)}</td>
        <td><button class="btn ghost sm" data-inv="${i.id}">Open</button></td></tr>`).join('')}
      </tbody></table>`;
  }

  views.invoices = async () => {
    const invoices = await API.get('/sales/invoices?legal_entity_id=' + LE);
    content.innerHTML = `<div class="panel"><div class="head"><h2>Invoices</h2><button class="btn gold sm" id="newInv">New invoice</button></div>
      <div class="body" style="padding:0">${invoiceTable(invoices)}</div></div>`;
    document.getElementById('newInv').onclick = newInvoice;
    content.querySelectorAll('[data-inv]').forEach((b) => { b.onclick = () => openInvoice(b.dataset.inv); });
  };

  async function openInvoice(id) {
    const inv = await API.get('/sales/invoices/' + id);
    const lines = inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${l.quantity}</td>
      <td class="num">$${money(l.unit_price)}</td><td class="num">$${money(l.line_net)}</td>
      <td class="num">$${money(l.line_vat)}</td><td class="num">$${money(l.line_total)}</td></tr>`).join('');
    const canIssue = inv.status === 'DRAFT';
    const canFiscal = inv.status !== 'DRAFT' && inv.fiscal_status !== 'ACCEPTED';
    modal(`Invoice ${inv.invoice_number}`, `
      <div style="display:flex;gap:24px;margin-bottom:14px;font-size:13px">
        <div><span class="muted">Status</span><br>${statusTag(inv.status)}</div>
        <div><span class="muted">Fiscal</span><br>${statusTag(inv.fiscal_status)}</div>
        <div><span class="muted">Date</span><br>${esc(inv.invoice_date)}</div>
        ${inv.fiscal_receipt_number ? `<div><span class="muted">FDMS receipt</span><br><b>${esc(inv.fiscal_receipt_number)}</b></div>` : ''}
      </div>
      <table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Total</th></tr></thead>
      <tbody>${lines}</tbody></table>
      <div style="text-align:right;margin-top:14px;font-size:14px">
        Subtotal: <b>$${money(inv.subtotal)}</b> &nbsp; VAT: <b>$${money(inv.vat)}</b> &nbsp;
        <span style="font-size:16px">Total: <b>$${money(inv.total)}</b></span></div>`,
      `${canIssue ? '<button class="btn" id="issueBtn">Issue &amp; post to GL</button>' : ''}
       ${canFiscal ? '<button class="btn gold" id="fiscalBtn">Fiscalise (ZIMRA)</button>' : ''}`);
    if (canIssue) document.getElementById('issueBtn').onclick = async () => {
      try { await API.post(`/sales/invoices/${id}/issue`, {}); closeModal(); views.invoices(); }
      catch (e) { alert(e.message); }
    };
    if (canFiscal) document.getElementById('fiscalBtn').onclick = async () => {
      try { await API.post(`/sales/invoices/${id}/fiscalise`, {}); closeModal(); views.invoices(); }
      catch (e) { alert(e.message); }
    };
  }

  async function newInvoice() {
    const [customers, items, whs] = await Promise.all([
      API.get('/customers?legal_entity_id=' + LE), API.get('/items'),
      API.get('/inventory/warehouses?legal_entity_id=' + LE),
    ]);
    const custOpts = customers.map((c) => `<option value="${c.id}">${esc(c.code)} — ${esc(c.name)}</option>`).join('');
    const whOpts = whs.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
    const itemOpts = items.map((i) => `<option value="${i.id}" data-price="${i.default_price || 0}">${esc(i.sku)} — ${esc(i.name)}</option>`).join('');
    modal('New invoice', `
      <div id="invErr"></div>
      <div class="row"><div class="field"><label>Customer</label><select id="fCust">${custOpts}</select></div>
        <div class="field"><label>Warehouse</label><select id="fWh">${whOpts}</select></div></div>
      <div class="field"><label>Pricing</label><select id="fInclVat"><option value="false">VAT exclusive</option><option value="true">VAT inclusive</option></select></div>
      <label>Lines</label><div id="lines"></div>
      <button class="btn ghost sm" id="addLine" style="margin-top:8px">+ Add line</button>`,
      `<button class="btn ghost" id="cancel">Cancel</button><button class="btn gold" id="save">Create invoice</button>`);
    const linesEl = document.getElementById('lines');
    function addLineRow() {
      const div = document.createElement('div');
      div.className = 'row'; div.style.marginBottom = '8px';
      div.innerHTML = `<select class="lItem">${itemOpts}</select>
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px">
          <input class="lQty" type="number" placeholder="Qty" value="1" min="0.0001" step="any"/>
          <input class="lPrice" type="number" placeholder="Unit price" step="0.0001"/>
          <button class="x" title="remove">&times;</button></div>`;
      div.querySelector('.lItem').onchange = (e) => {
        div.querySelector('.lPrice').value = e.target.selectedOptions[0].dataset.price;
      };
      div.querySelector('.lPrice').value = div.querySelector('.lItem').selectedOptions[0].dataset.price;
      div.querySelector('.x').onclick = () => div.remove();
      linesEl.appendChild(div);
    }
    addLineRow();
    document.getElementById('addLine').onclick = addLineRow;
    document.getElementById('cancel').onclick = closeModal;
    document.getElementById('save').onclick = async () => {
      const lines = [...linesEl.querySelectorAll('.row')].map((r) => ({
        item_id: Number(r.querySelector('.lItem').value),
        quantity: Number(r.querySelector('.lQty').value),
        unit_price: r.querySelector('.lPrice').value ? Number(r.querySelector('.lPrice').value) : undefined,
      })).filter((l) => l.quantity > 0);
      try {
        await API.post('/sales/invoices', {
          legal_entity_id: LE, customer_id: Number(document.getElementById('fCust').value),
          warehouse_id: Number(document.getElementById('fWh').value),
          prices_include_vat: document.getElementById('fInclVat').value === 'true', lines,
        });
        closeModal(); views.invoices();
      } catch (e) { document.getElementById('invErr').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
  }

  views.customers = async () => {
    const rows = await API.get('/customers?legal_entity_id=' + LE);
    content.innerHTML = `<div class="panel"><div class="head"><h2>Customers</h2><button class="btn gold sm" id="newCust">New customer</button></div>
      <div class="body" style="padding:0"><table><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>MCAZ Licence</th><th class="num">Credit limit</th></tr></thead>
      <tbody>${rows.map((c) => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td><td>${tag(c.customer_type, 'muted')}</td>
        <td>${c.mcaz_licence_no ? esc(c.mcaz_licence_no) : '<span class="muted">—</span>'}</td><td class="num">$${money(c.credit_limit)}</td></tr>`).join('')}</tbody></table></div></div>`;
    document.getElementById('newCust').onclick = () => {
      modal('New customer', `<div id="cErr"></div>
        <div class="row"><div class="field"><label>Code</label><input id="cCode"/></div><div class="field"><label>Name</label><input id="cName"/></div></div>
        <div class="row"><div class="field"><label>Type</label><select id="cType"><option>BUSINESS</option><option>INDIVIDUAL</option><option>GOVT</option></select></div>
        <div class="field"><label>MCAZ Licence (for Rx)</label><input id="cMcaz"/></div></div>
        <div class="row"><div class="field"><label>TIN</label><input id="cTin"/></div><div class="field"><label>Credit limit</label><input id="cCredit" type="number" value="0"/></div></div>`,
        `<button class="btn ghost" id="cCancel">Cancel</button><button class="btn gold" id="cSave">Save</button>`);
      document.getElementById('cCancel').onclick = closeModal;
      document.getElementById('cSave').onclick = async () => {
        try {
          await API.post('/customers', {
            legal_entity_id: LE, code: cCode.value, name: cName.value, customer_type: cType.value,
            mcaz_licence_no: cMcaz.value || undefined, tin: cTin.value || undefined,
            credit_limit: Number(cCredit.value || 0), customer_posting_group_id: 1, vat_business_group_id: 1,
          });
          closeModal(); views.customers();
        } catch (e) { document.getElementById('cErr').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    };
  };

  views.items = async () => {
    const rows = await API.get('/items');
    content.innerHTML = `<div class="panel"><div class="head"><h2>Items</h2></div>
      <div class="body" style="padding:0"><table><thead><tr><th>SKU</th><th>Name</th><th>Form</th><th>Rx</th><th class="num">Price</th></tr></thead>
      <tbody>${rows.map((i) => `<tr><td><b>${esc(i.sku)}</b></td><td>${esc(i.name)}</td><td>${esc(i.dosage_form || '')}</td>
        <td>${i.requires_prescription ? tag('Rx', 'gold') : tag('OTC', 'muted')}</td><td class="num">$${money(i.default_price)}</td></tr>`).join('')}</tbody></table></div></div>`;
  };

  views.stock = async () => {
    const items = await API.get('/items');
    const whs = await API.get('/inventory/warehouses?legal_entity_id=' + LE);
    const wh = whs[0];
    let html = '';
    for (const it of items) {
      const stock = await API.get(`/inventory/stock?warehouse_id=${wh.id}&item_id=${it.id}`);
      const total = stock.reduce((a, s) => a + Number(s.quantity_on_hand), 0);
      html += `<div class="panel"><div class="head"><h2>${esc(it.sku)} — ${esc(it.name)}</h2><span class="muted">${total} on hand</span></div>
        <div class="body" style="padding:0"><table><thead><tr><th>Batch</th><th>Expiry</th><th>Status</th><th class="num">On hand</th></tr></thead>
        <tbody>${stock.length ? stock.map((s) => `<tr><td>${esc(s.batch_number)}</td><td>${esc(s.expiry_date)}</td><td>${tag(s.status, s.status === 'ACTIVE' ? 'ok' : 'warn')}</td><td class="num">${s.quantity_on_hand}</td></tr>`).join('') : '<tr><td colspan=4 class="muted">No stock</td></tr>'}</tbody></table></div></div>`;
    }
    content.innerHTML = html || '<div class="empty">No items.</div>';
  };

  views.quotations = async () => {
    const rows = await API.get('/sales/quotations?legal_entity_id=' + LE);
    content.innerHTML = `<div class="panel"><div class="head"><h2>Quotations</h2></div>
      <div class="body" style="padding:0">${rows.length ? `<table><thead><tr><th>Number</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead>
      <tbody>${rows.map((q) => `<tr><td><b>${esc(q.quote_number)}</b></td><td>${esc(q.quote_date)}</td><td class="num">$${money(q.total)}</td><td>${statusTag(q.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No quotations yet.</div>'}</div></div>`;
  };

  views.trialbalance = async () => {
    const tb = await API.get('/gl/trial-balance?legal_entity_id=' + LE);
    content.innerHTML = `<div class="panel"><div class="head"><h2>Trial Balance</h2>${tb.totals.balanced ? tag('Balanced', 'ok') : tag('Out of balance', 'warn')}</div>
      <div class="body" style="padding:0"><table><thead><tr><th>Account</th><th>Name</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
      <tbody>${tb.rows.map((r) => `<tr><td>${esc(r.account_code)}</td><td>${esc(r.account_name)}</td><td class="num">$${money(r.debit)}</td><td class="num">$${money(r.credit)}</td></tr>`).join('')}
      <tr style="font-weight:700;background:#f8fafc"><td colspan=2>TOTALS</td><td class="num">$${money(tb.totals.debit)}</td><td class="num">$${money(tb.totals.credit)}</td></tr></tbody></table></div></div>`;
  };

  views.fiscal = async () => {
    const invoices = await API.get('/sales/invoices?legal_entity_id=' + LE);
    const fisc = invoices.filter((i) => i.status !== 'DRAFT');
    content.innerHTML = `<div class="panel"><div class="head"><h2>ZIMRA Fiscalisation</h2><span class="tag gold">Simulator mode</span></div>
      <div class="body" style="padding:0">${fisc.length ? `<table><thead><tr><th>Invoice</th><th>Status</th><th>Receipt No.</th><th>Verification</th></tr></thead>
      <tbody>${fisc.map((i) => `<tr><td><b>${esc(i.invoice_number)}</b></td><td>${statusTag(i.fiscal_status)}</td>
      <td>${i.fiscal_receipt_number ? esc(i.fiscal_receipt_number) : '<span class="muted">—</span>'}</td>
      <td class="muted">${i.fiscal_verification_code ? esc(i.fiscal_verification_code) : '—'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No invoices to fiscalise yet.</div>'}</div></div>`;
  };

  // ---------------------------------------------------------------- router
  async function go(view) {
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    title.textContent = document.querySelector(`#nav a[data-view="${view}"]`)?.textContent || view;
    content.innerHTML = '<div class="empty">Loading…</div>';
    try { await (views[view] || views.dashboard)(); }
    catch (e) { content.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  document.querySelectorAll('#nav a').forEach((a) => { a.onclick = () => go(a.dataset.view); });
  go('dashboard');
})();
