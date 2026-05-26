'use strict';

/*
 * po-dashboard.js
 * Signal Logic Systems — PO Tracker dashboard front-end.
 *
 * Talks to /.netlify/functions/po-api with a bearer token issued by
 * onboard-customer.js. All data lives in the customer's SharePoint —
 * this file just renders and dispatches actions.
 *
 * URL contract: ?customer=<id>&token=<hmac-token>
 */

(function () {
  // ─── Bootstrap ────────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const CUSTOMER = params.get('customer');
  const TOKEN = params.get('token');

  if (!CUSTOMER || !TOKEN) {
    document.body.innerHTML =
      '<main class="po-wrap"><div class="po-card error-state">' +
      'Missing <code>customer</code> or <code>token</code> URL parameter. ' +
      'Use the dashboard link issued by onboarding.</div></main>';
    return;
  }

  const API = '/.netlify/functions/po-api';

  // Local copy of config the user is editing. Only sent to the server
  // on Save Settings.
  let configDraft = null;
  let configOriginal = null;

  // ─── Helpers ──────────────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'dataset') Object.assign(node.dataset, attrs[k]);
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        }
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children];
      for (const c of arr) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (isNaN(t)) return String(iso);
    return new Date(t).toISOString().slice(0, 10);
  }

  function daysFromNow(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    return Math.round((t - Date.now()) / 86_400_000);
  }

  function toast(msg, kind) {
    const stack = $('#toasts');
    const t = el('div', { class: 'toast ' + (kind || '') }, msg);
    stack.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity .25s ease';
      setTimeout(() => t.remove(), 280);
    }, 4500);
  }

  async function callApi(action, body) {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(Object.assign({ action }, body || {})),
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data || data.ok === false) {
      const msg = (data && data.error) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return data;
  }

  // ─── Tab navigation ───────────────────────────────────────────────
  $$('.po-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const panelName = tab.dataset.panel;
      $$('.po-tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.po-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + panelName));
    });
  });

  // ─── Initial load ─────────────────────────────────────────────────
  $('#customer-label').textContent = CUSTOMER;

  async function refreshAll() {
    $('#last-updated').textContent = new Date().toLocaleString('en-US', { hour12: false });
    try {
      await Promise.all([
        loadRecords(),
        loadQueue(),
        loadAlerts(),
        loadConfig(),
      ]);
    } catch (err) {
      toast('Refresh failed: ' + err.message, 'error');
    }
  }

  // ─── Settings panel ────────────────────────────────────────────────
  async function loadConfig() {
    try {
      const data = await callApi('get_config');
      configOriginal = JSON.parse(JSON.stringify(data.config || {}));
      configDraft = JSON.parse(JSON.stringify(data.config || {}));
      renderConfig();
    } catch (err) {
      toast('Could not load config: ' + err.message, 'error');
    }
  }

  function renderConfig() {
    if (!configDraft) return;
    $('#cfg-auto-send').checked       = !!configDraft.auto_send;
    $('#cfg-ack-timer').value         = configDraft.ack_timer ?? 3;
    $('#cfg-follow-up-window').value  = configDraft.follow_up_window ?? 2;
    $('#cfg-gap-days').value          = configDraft.min_followup_gap_days ?? 3;
    $('#cfg-notification-target').value = configDraft.notification_target || 'ops_lead';
    $('#cfg-custom-email').value      = configDraft.custom_notification_email || '';
    $('#custom-email-row').style.display =
      configDraft.notification_target === 'custom' ? '' : 'none';

    const chips = $('#keyword-chips');
    chips.innerHTML = '';
    const kws = Array.isArray(configDraft.keywords) ? configDraft.keywords : [];
    for (const kw of kws) {
      chips.appendChild(el('span', { class: 'chip' }, [
        kw,
        el('button', {
          title: 'Remove',
          onclick: () => {
            configDraft.keywords = configDraft.keywords.filter(k => k !== kw);
            renderConfig();
          },
        }, '×'),
      ]));
    }
  }

  $('#cfg-auto-send').addEventListener('change', e => { configDraft.auto_send = e.target.checked; });
  $('#cfg-ack-timer').addEventListener('input', e => { configDraft.ack_timer = Number(e.target.value); });
  $('#cfg-follow-up-window').addEventListener('input', e => { configDraft.follow_up_window = Number(e.target.value); });
  $('#cfg-gap-days').addEventListener('input', e => { configDraft.min_followup_gap_days = Number(e.target.value); });
  $('#cfg-notification-target').addEventListener('change', e => {
    configDraft.notification_target = e.target.value;
    $('#custom-email-row').style.display = e.target.value === 'custom' ? '' : 'none';
  });
  $('#cfg-custom-email').addEventListener('input', e => { configDraft.custom_notification_email = e.target.value || null; });

  $('#add-keyword-btn').addEventListener('click', () => {
    const inp = $('#new-keyword');
    const v = inp.value.trim();
    if (!v) return;
    if (!Array.isArray(configDraft.keywords)) configDraft.keywords = [];
    if (!configDraft.keywords.includes(v)) configDraft.keywords.push(v);
    inp.value = '';
    renderConfig();
  });

  $('#save-settings-btn').addEventListener('click', async () => {
    try {
      const data = await callApi('update_config', { config: configDraft });
      configOriginal = JSON.parse(JSON.stringify(configDraft));
      const out = $('#env-output');
      out.style.display = 'block';
      out.textContent =
        (data.note || '') + '\n\n' +
        Object.keys(data.env_vars).map(k => k + '=' + data.env_vars[k]).join('\n');
      toast('Settings staged — install env vars on Netlify.', 'success');
    } catch (err) {
      toast('Save failed: ' + err.message, 'error');
    }
  });

  $('#reload-settings-btn').addEventListener('click', () => {
    if (!configOriginal) return;
    configDraft = JSON.parse(JSON.stringify(configOriginal));
    renderConfig();
    $('#env-output').style.display = 'none';
  });

  // ─── Active Jobs panel ────────────────────────────────────────────
  async function loadRecords() {
    const root = $('#jobs-content');
    try {
      const data = await callApi('list_records');
      const records = data.records || [];
      $('#count-jobs').textContent = records.length;
      renderRecords(root, records);
    } catch (err) {
      root.innerHTML = '';
      root.appendChild(el('div', { class: 'error-state' }, 'Failed to load: ' + err.message));
    }
  }

  function statusFor(record) {
    if (record.constraint_flag) return { cls: 'shifted',  label: 'Constraint shifted' };
    if (record.overdue)         return { cls: 'overdue',  label: 'Overdue' };
    // At-risk: any line item ships within next 3 days
    const ships = record.line_item_ship_dates || {};
    for (const k of Object.keys(ships)) {
      const d = daysFromNow(ships[k]);
      if (d != null && d <= 3) return { cls: 'at-risk', label: 'At risk' };
    }
    return { cls: 'on-track', label: 'On track' };
  }

  function constraintForRecord(record) {
    const ships = record.line_item_ship_dates || {};
    let best = null;
    for (const k of Object.keys(ships)) {
      const t = Date.parse(ships[k]);
      if (isNaN(t)) continue;
      if (!best || t > best.t) best = { item: k, t, iso: ships[k] };
    }
    return best;
  }

  function renderRecords(root, records) {
    root.innerHTML = '';
    if (!records.length) {
      root.appendChild(el('div', { class: 'empty' }, 'No active tracking records.'));
      return;
    }

    const table = el('table', { class: 'po-table' });
    const thead = el('thead', null,
      el('tr', null, [
        el('th', null, 'Job'),
        el('th', null, 'Vendor'),
        el('th', null, 'PO'),
        el('th', null, 'Stage'),
        el('th', null, 'Constraint item'),
        el('th', null, 'Est. ship'),
        el('th', null, 'Days left'),
        el('th', null, 'Status'),
      ])
    );
    table.appendChild(thead);
    const tbody = el('tbody');
    table.appendChild(tbody);

    for (const record of records) {
      const cons = constraintForRecord(record);
      const days = cons ? daysFromNow(cons.iso) : null;
      const status = statusFor(record);

      const row = el('tr', { dataset: { po: record.po_number } }, [
        el('td', null, record.job_id || '—'),
        el('td', null, record.vendor || '—'),
        el('td', null, record.po_number),
        el('td', null, record.stage || 'STAGE_1'),
        el('td', null, cons ? cons.item : '—'),
        el('td', null, cons ? fmtDate(cons.iso) : '—'),
        el('td', null, days == null ? '—' : String(days)),
        el('td', null, el('span', { class: 'badge ' + status.cls }, status.label)),
      ]);

      const detailRow = buildDetailRow(record);
      detailRow.style.display = 'none';

      row.addEventListener('click', () => {
        const expanded = row.classList.toggle('expanded');
        detailRow.style.display = expanded ? '' : 'none';
      });

      tbody.appendChild(row);
      tbody.appendChild(detailRow);
    }

    root.appendChild(table);
  }

  function buildDetailRow(record) {
    const detailRow = el('tr', { class: 'row-detail' });
    const td = el('td', { colspan: 8 });
    detailRow.appendChild(td);

    // Meta grid
    const grid = el('div', { class: 'detail-grid' }, [
      el('div', null, [el('strong', null, 'Order date'), document.createTextNode(fmtDate(record.timer_start))]),
      el('div', null, [el('strong', null, 'Acknowledged'), document.createTextNode(fmtDate(record.ack_received_date))]),
      el('div', null, [el('strong', null, 'Last follow-up'), document.createTextNode(fmtDate(record.last_follow_up_date))]),
      el('div', null, [el('strong', null, 'Prior constraint'), document.createTextNode(record.prior_constraint_item || '—')]),
    ]);
    td.appendChild(grid);

    // Line items
    const items = Array.isArray(record.line_items) ? record.line_items : [];
    if (items.length) {
      const liTable = el('table', { class: 'line-items-table' });
      liTable.appendChild(el('thead', null, el('tr', null, [
        el('th', null, 'Item'),
        el('th', null, 'Qty'),
        el('th', null, 'Est. ship'),
      ])));
      const liBody = el('tbody');
      for (const li of items) {
        liBody.appendChild(el('tr', null, [
          el('td', null, li.item_name || '—'),
          el('td', null, (li.quantity ? String(li.quantity) : '') + (li.unit ? ' ' + li.unit : '')),
          el('td', null, fmtDate(li.estimated_ship_date || (record.line_item_ship_dates || {})[li.item_name])),
        ]));
      }
      liTable.appendChild(liBody);
      td.appendChild(liTable);
    }

    // Per-row override controls
    const overrides = el('div', { class: 'queue-actions', style: 'margin-top:1rem;' }, [
      el('button', {
        class: 'po-btn ghost',
        onclick: async (e) => {
          e.stopPropagation();
          const newAck = prompt('Acknowledgement timer (business days) for this PO:', '');
          if (!newAck) return;
          try {
            await callApi('patch_record', {
              item_id: record._itemId,
              partial: { notes: (record.notes || '') + `\n[override] ack_timer=${newAck} @ ${new Date().toISOString()}` },
            });
            toast('Override saved.', 'success');
            loadRecords();
          } catch (err) { toast(err.message, 'error'); }
        },
      }, 'Adjust timer'),
      el('button', {
        class: 'po-btn ghost',
        onclick: async (e) => {
          e.stopPropagation();
          const flip = !record.constraint_flag;
          try {
            await callApi('patch_record', {
              item_id: record._itemId,
              partial: { constraint_flag: flip },
            });
            toast(flip ? 'Flagged.' : 'Flag cleared.', 'success');
            loadRecords();
            loadAlerts();
          } catch (err) { toast(err.message, 'error'); }
        },
      }, record.constraint_flag ? 'Clear constraint flag' : 'Flag as constraint'),
    ]);
    td.appendChild(overrides);

    return detailRow;
  }

  // ─── Email Queue panel ────────────────────────────────────────────
  async function loadQueue() {
    const root = $('#queue-content');
    try {
      const data = await callApi('list_queue');
      const queue = data.queue || [];
      $('#count-queue').textContent = queue.length;
      renderQueue(root, queue);
    } catch (err) {
      root.innerHTML = '';
      root.appendChild(el('div', { class: 'error-state' }, 'Failed to load: ' + err.message));
    }
  }

  function badgeClassForType(type) {
    if (type === 'STAGE_1')          return 'type-s1';
    if (type === 'STAGE_2')          return 'type-s2';
    if (type === 'CONSTRAINT_ALERT') return 'type-cs';
    return '';
  }

  function renderQueue(root, queue) {
    root.innerHTML = '';
    if (!queue.length) {
      root.appendChild(el('div', { class: 'empty' }, 'Queue is empty. Either auto-send is on or there is nothing pending.'));
      return;
    }

    for (const item of queue) {
      const head = el('div', { class: 'queue-item-head' }, [
        el('span', { class: 'badge ' + badgeClassForType(item.email_type) }, item.email_type.replace('_', ' ')),
        el('div', { class: 'grow' }, [
          el('div', { class: 'subject' }, item.subject || '(no subject)'),
          el('div', { class: 'meta' }, [
            'To: ' + (item.recipient || '—'),
            ' · PO ' + (item.po_number || '—'),
            ' · ' + fmtDate(item.created_at),
          ]),
        ]),
      ]);

      const body = el('div', { class: 'queue-body' }, [
        el('pre', null, item.body || ''),
        el('div', { class: 'queue-actions' }, [
          el('button', { class: 'po-btn', onclick: async () => {
            try { await callApi('send_queue_item', { item_id: item._itemId }); toast('Sent.', 'success'); loadQueue(); loadRecords(); }
            catch (err) { toast(err.message, 'error'); }
          }}, 'Send'),
          el('button', { class: 'po-btn ghost', onclick: () => editEl.classList.toggle('show') }, 'Edit'),
          el('button', { class: 'po-btn danger', onclick: async () => {
            if (!confirm('Skip this email?')) return;
            try { await callApi('skip_queue_item', { item_id: item._itemId }); toast('Skipped.', 'success'); loadQueue(); }
            catch (err) { toast(err.message, 'error'); }
          }}, 'Skip'),
        ]),
      ]);

      const subjInp = el('input', { type: 'text', value: item.subject });
      const recpInp = el('input', { type: 'email', value: item.recipient });
      const bodyTa  = el('textarea', null);
      bodyTa.value = item.body || '';

      const editEl = el('div', { class: 'queue-edit' }, [
        subjInp,
        recpInp,
        bodyTa,
        el('button', { class: 'po-btn', onclick: async () => {
          try {
            await callApi('edit_queue_item', {
              item_id: item._itemId,
              subject: subjInp.value,
              recipient: recpInp.value,
              body: bodyTa.value,
            });
            toast('Saved.', 'success');
            loadQueue();
          } catch (err) { toast(err.message, 'error'); }
        }}, 'Save changes'),
      ]);

      head.addEventListener('click', () => body.classList.toggle('show'));

      const card = el('div', { class: 'queue-item' }, [head, body, editEl]);
      root.appendChild(card);
    }
  }

  // ─── Constraint Alerts panel ──────────────────────────────────────
  async function loadAlerts() {
    const root = $('#alerts-content');
    try {
      const data = await callApi('list_alerts');
      const alerts = data.alerts || [];
      $('#count-alerts').textContent = alerts.length;
      renderAlerts(root, alerts);
    } catch (err) {
      root.innerHTML = '';
      root.appendChild(el('div', { class: 'error-state' }, 'Failed to load: ' + err.message));
    }
  }

  function renderAlerts(root, alerts) {
    root.innerHTML = '';
    if (!alerts.length) {
      root.appendChild(el('div', { class: 'empty' }, 'No constraint shifts to surface.'));
      return;
    }
    for (const a of alerts) {
      const sevClass = a.severity ? 'severity-' + a.severity : '';
      const item = el('div', { class: 'alert-item ' + sevClass }, [
        el('div', { class: 'alert-grid' }, [
          el('div', null, [
            el('strong', null, 'Job'),
            document.createTextNode(a.job_id || '—'),
          ]),
          el('div', null, [
            el('strong', null, 'Was'),
            document.createTextNode((a.previous_item || '—') + ' · ' + fmtDate(a.previous_date)),
          ]),
          el('div', null, [
            el('strong', null, 'Now'),
            document.createTextNode((a.new_item || '—') + ' · ' + fmtDate(a.new_date)),
          ]),
          el('div', null, [
            el('strong', null, 'Δ days'),
            document.createTextNode((a.delta_days >= 0 ? '+' : '') + (a.delta_days ?? '—')),
          ]),
        ]),
        el('div', { style: 'display:flex; gap:.5rem; margin-top:.85rem;' }, [
          el('button', { class: 'po-btn', onclick: async () => {
            try {
              await callApi('notify_constraint', {
                record: { job_id: a.job_id, po_number: a.contributing_po },
                shift: a,
              });
              toast('Notification sent.', 'success');
            } catch (err) { toast(err.message, 'error'); }
          }}, 'Notify'),
        ]),
      ]);
      root.appendChild(item);
    }
  }

  // ─── Kickoff ─────────────────────────────────────────────────────
  refreshAll();
})();
