/* ============================================================
   SIGNAL LOGIC SYSTEMS — Job Flow Monitor Processing Engine
   dashboard.js  |  Phase 1 — Browser-based diagnostic tool
   ============================================================ */

/* ─── Processing Engine (pure functions, no DOM) ──────────── */

const JFM = (() => {

  const TERMINAL_STAGES = new Set([
    'shipped', 'complete', 'completed', 'closed', 'invoiced',
    'cancelled', 'canceled', 'void', 'voided', 'done', 'finished',
    'delivered', 'archived'
  ]);

  // Common manufacturing stage order — earlier stages first
  const KNOWN_STAGE_ORDER = [
    'quote', 'order', 'open', 'planning', 'planned', 'engineering',
    'material', 'materials', 'purchasing', 'layout', 'setup',
    'run', 'running', 'machining', 'machine', 'welding', 'weld',
    'fabrication', 'fab', 'forming', 'assembly', 'assemble',
    'inspection', 'inspect', 'qc', 'quality', 'test', 'testing',
    'paint', 'painting', 'coating', 'finish', 'finishing',
    'packing', 'pack', 'shipping', 'ship', 'in process', 'in_process'
  ];

  // Internal field → accepted CSV column name variants
  const COLUMN_VARIANTS = {
    job_number:  ['job', 'job_number', 'jobno', 'job_no', 'job no', 'wo', 'work_order',
                  'workorder', 'job#', 'job #', 'order_no', 'order no', 'order#'],
    customer:    ['customer', 'customer_name', 'cust_name', 'cust', 'client',
                  'customer name', 'company', 'account'],
    stage:       ['status', 'job_status', 'current_op', 'current_operation', 'work_center',
                  'workcenter', 'operation', 'stage', 'phase', 'department', 'dept',
                  'current stage', 'job status'],
    due_date:    ['due_date', 'due date', 'req_date', 'required_date', 'need_date',
                  'duedate', 'ship_date', 'promise_date', 'promised_date', 'need date',
                  'required date', 'due'],
    order_date:  ['order_date', 'start_date', 'open_date', 'date_opened', 'orderdate',
                  'opened', 'create_date', 'created', 'order date', 'open date', 'start date'],
    job_value:   ['est_total_price', 'quote_price', 'total_price', 'revenue', 'price',
                  'ext_price', 'extended_price', 'value', 'amount', 'total', 'job_total',
                  'est_price', 'estimated_price', 'sell_price', 'sales_price', 'net_price'],
    qty_ordered: ['qty_ordered', 'order_qty', 'quantity', 'qty', 'quantity_ordered', 'ordered'],
    qty_shipped: ['qty_shipped', 'ship_qty', 'shipped', 'quantity_shipped'],
    part_number: ['part', 'part_number', 'part_no', 'partno', 'item', 'item_no', 'part number'],
    description: ['description', 'part_desc', 'desc', 'item_desc', 'part_description', 'name'],
  };

  const REQUIRED_FIELDS  = ['job_number', 'stage'];
  const PREFERRED_FIELDS = ['due_date', 'job_value'];

  // ─── Column Detection ──────────────────────────────────────

  function norm(str) {
    return String(str).toLowerCase().replace(/[\s_\-\.]+/g, '_').trim();
  }

  function detectColumns(headers) {
    const normed = headers.map(h => norm(h));
    const mapping = {};

    for (const [field, variants] of Object.entries(COLUMN_VARIANTS)) {
      for (const v of variants) {
        const nv = norm(v);
        const idx = normed.findIndex(h => h === nv);
        if (idx !== -1) { mapping[field] = headers[idx]; break; }
      }
      // Fuzzy fallback: partial match
      if (!mapping[field]) {
        for (const v of variants) {
          const nv = norm(v);
          const idx = normed.findIndex(h => h.includes(nv) || nv.includes(h));
          if (idx !== -1) { mapping[field] = headers[idx]; break; }
        }
      }
    }

    const missing = [...REQUIRED_FIELDS, ...PREFERRED_FIELDS].filter(f => !mapping[f]);
    return { mapping, missing };
  }

  // ─── Row Normalization ─────────────────────────────────────

  function parseDate(str) {
    if (!str || !str.toString().trim()) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function parseValue(str) {
    if (!str && str !== 0) return null;
    const v = parseFloat(String(str).replace(/[$,\s]/g, ''));
    return isNaN(v) ? null : v;
  }

  function mapRow(raw, mapping) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dueDate   = parseDate(mapping.due_date   ? raw[mapping.due_date]   : null);
    const orderDate = parseDate(mapping.order_date ? raw[mapping.order_date] : null);
    const value     = parseValue(mapping.job_value  ? raw[mapping.job_value]  : null);
    const stage     = (mapping.stage ? raw[mapping.stage] : '').toString().trim();
    const daysOverdue = dueDate ? Math.max(0, Math.floor((today - dueDate) / 86400000)) : 0;

    return {
      job_number:   (mapping.job_number  ? raw[mapping.job_number]  : '').toString().trim(),
      customer:     (mapping.customer    ? raw[mapping.customer]    : '').toString().trim(),
      part_number:  (mapping.part_number ? raw[mapping.part_number] : '').toString().trim(),
      description:  (mapping.description ? raw[mapping.description] : '').toString().trim(),
      stage,
      due_date:     dueDate,
      order_date:   orderDate,
      job_value:    value,
      days_overdue: daysOverdue,
      is_past_due:  dueDate ? dueDate < today : false,
    };
  }

  // ─── Active Job Filter ─────────────────────────────────────

  function isActive(job) {
    return job.stage ? !TERMINAL_STAGES.has(job.stage.toLowerCase()) : true;
  }

  // ─── Stage Order Inference ─────────────────────────────────

  function inferStageOrder(jobs) {
    const stages = [...new Set(jobs.map(j => j.stage).filter(Boolean))];

    // Split into known and unknown
    const known = [], unknown = [];
    for (const s of stages) {
      const ki = KNOWN_STAGE_ORDER.indexOf(s.toLowerCase());
      ki !== -1 ? known.push({ s, ki }) : unknown.push(s);
    }
    known.sort((a, b) => a.ki - b.ki);

    // Rank unknowns by median job age (older avg open date = earlier in process)
    const ranked = unknown.map(stage => {
      const aged = jobs
        .filter(j => j.stage === stage && j.order_date)
        .map(j => Date.now() - j.order_date.getTime());
      const median = aged.length
        ? aged.sort((a, b) => a - b)[Math.floor(aged.length / 2)]
        : 0;
      return { s: stage, median };
    });
    ranked.sort((a, b) => b.median - a.median);

    return [...known.map(x => x.s), ...ranked.map(x => x.s)];
  }

  // ─── Constraint Identification ─────────────────────────────

  function findConstraint(active) {
    const counts = {}, values = {};
    for (const j of active) {
      const s = j.stage || 'Unknown';
      counts[s] = (counts[s] || 0) + 1;
      values[s] = (values[s] || 0) + (j.job_value || 0);
    }
    const max = Math.max(...Object.values(counts));
    const tied = Object.keys(counts)
      .filter(s => counts[s] === max)
      .sort((a, b) => (values[b] || 0) - (values[a] || 0));
    return { stage: tied[0], counts, values };
  }

  // ─── Main Calculation ──────────────────────────────────────

  function calculate(rows, mapping) {
    const jobs   = rows.map(r => mapRow(r, mapping)).filter(j => j.job_number || j.stage);
    const active = jobs.filter(isActive);

    if (active.length === 0) return null;

    const stageOrder = inferStageOrder(active);
    const { stage: constraint, counts, values } = findConstraint(active);
    const ci = stageOrder.indexOf(constraint);

    const revenueAtRisk = values[constraint] || 0;

    let cascadeTotal = 0;
    const upstreamStages = ci > 0 ? stageOrder.slice(0, ci) : [];
    if (upstreamStages.length > 0) {
      cascadeTotal = upstreamStages.reduce((s, st) => s + (values[st] || 0), 0);
    } else {
      // Stage order unknown — sum all non-constraint active jobs
      cascadeTotal = active
        .filter(j => j.stage !== constraint)
        .reduce((s, j) => s + (j.job_value || 0), 0);
    }

    const pastDue   = active.filter(j => j.is_past_due);
    const avgLate   = pastDue.length
      ? Math.round(pastDue.reduce((s, j) => s + j.days_overdue, 0) / pastDue.length)
      : 0;
    const totalValue = active.reduce((s, j) => s + (j.job_value || 0), 0);
    const onTimeRate = active.length
      ? Math.round(((active.length - pastDue.length) / active.length) * 100)
      : 100;

    // Priority: days_overdue × value (fallback: days_overdue only)
    const priorityJobs = active
      .map(j => ({ ...j, score: j.days_overdue * (j.job_value || 1) }))
      .filter(j => j.is_past_due)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const hasValue   = active.some(j => j.job_value !== null);
    const hasDueDate = active.some(j => j.due_date !== null);

    const firstCustomer = jobs.find(j => j.customer);
    const customerName  = firstCustomer ? firstCustomer.customer : null;

    return {
      totalRecords: rows.length,
      totalJobs: active.length,
      constraint,
      jobsAtConstraint: counts[constraint] || 0,
      revenueAtRisk,
      cascadeTotal,
      totalValue,
      pastDueCount: pastDue.length,
      avgDaysLate: avgLate,
      onTimeRate,
      stageOrder,
      stageCounts: counts,
      stageValues: values,
      priorityJobs,
      hasValue,
      hasDueDate,
      upstreamStages,
      customerName,
      reportDate: new Date(),
    };
  }

  return { detectColumns, calculate, COLUMN_VARIANTS, REQUIRED_FIELDS, PREFERRED_FIELDS };
})();


/* ─── UI Controller ───────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function () {

  // State
  let parsedRows   = [];
  let csvHeaders   = [];
  let columnMap    = {};
  let chartBar     = null;
  let chartRevenue = null;

  // Sections
  const uploadSection  = document.getElementById('uploadSection');
  const mappingSection = document.getElementById('mappingSection');
  const dashSection    = document.getElementById('dashSection');

  // Upload elements
  const dropZone   = document.getElementById('dropZone');
  const fileInput  = document.getElementById('fileInput');
  const dropMsg    = document.getElementById('dropMsg');

  // ─── Drag & Drop ──────────────────────────────────────────

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  // ─── File Handling ─────────────────────────────────────────

  function handleFile(file) {
    if (!file.name.match(/\.(csv|txt)$/i)) {
      showError('Please upload a CSV file.');
      return;
    }

    dropMsg.textContent = 'Parsing…';
    dropZone.classList.add('loading');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        dropZone.classList.remove('loading');
        if (!results.data || results.data.length === 0) {
          showError('The file appears to be empty or unreadable.');
          dropMsg.innerHTML = dropMsgDefault();
          return;
        }

        parsedRows  = results.data;
        csvHeaders  = results.meta.fields || Object.keys(results.data[0]);

        const { mapping, missing } = JFM.detectColumns(csvHeaders);
        columnMap = mapping;

        const requiredMissing = missing.filter(f => JFM.REQUIRED_FIELDS.includes(f));

        if (requiredMissing.length > 0) {
          showMappingUI(missing);
        } else {
          runAndRender(columnMap);
        }
      },
      error: function () {
        dropZone.classList.remove('loading');
        showError('Failed to parse the file. Make sure it is a valid CSV.');
        dropMsg.innerHTML = dropMsgDefault();
      }
    });
  }

  function dropMsgDefault() {
    return `<span class="drop-icon">&#8679;</span>
            <strong>Drag &amp; drop your CSV here</strong>
            <span>or click to browse</span>`;
  }

  function showError(msg) {
    const el = document.getElementById('uploadError');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function clearError() {
    const el = document.getElementById('uploadError');
    el.textContent = '';
    el.style.display = 'none';
  }

  // ─── Column Mapping UI ─────────────────────────────────────

  function showMappingUI(missingFields) {
    uploadSection.style.display  = 'none';
    mappingSection.style.display = 'block';
    dashSection.style.display    = 'none';

    const detectedEl = document.getElementById('detectedList');
    const fieldsEl   = document.getElementById('mappingFields');
    const labels = {
      job_number: 'Job Number', customer: 'Customer', stage: 'Current Stage',
      due_date: 'Due Date', order_date: 'Order Date', job_value: 'Job Value ($)',
      qty_ordered: 'Qty Ordered', part_number: 'Part Number', description: 'Description'
    };

    // Show what was detected
    detectedEl.innerHTML = Object.entries(columnMap)
      .map(([field, col]) => `<div class="detected-row">
        <span class="det-field">${labels[field] || field}</span>
        <span class="det-arrow">→</span>
        <span class="det-col">${col}</span>
      </div>`).join('');

    if (!detectedEl.innerHTML) {
      detectedEl.innerHTML = '<p style="color:var(--text-secondary);font-size:.9rem;">No columns auto-detected.</p>';
    }

    // Dropdowns for missing fields
    fieldsEl.innerHTML = missingFields.map(field => {
      const isRequired = JFM.REQUIRED_FIELDS.includes(field);
      const opts = csvHeaders.map(h => `<option value="${h}">${h}</option>`).join('');
      return `<div class="map-row">
        <label class="map-label">
          ${labels[field] || field}
          ${isRequired ? '<span class="req-star">*</span>' : '<span class="opt-tag">optional</span>'}
        </label>
        <select class="map-select" data-field="${field}">
          <option value="">— skip this field —</option>
          ${opts}
        </select>
      </div>`;
    }).join('');

    // Formatting guidance — teach the customer how to avoid this next time
    const TOP_VARIANTS = {
      job_number:  'Job, Job_Number, JobNo, WO, Work_Order',
      customer:    'Customer, Customer_Name, Cust_Name, Cust',
      stage:       'Status, Job_Status, Current_Op, Work_Center, Operation',
      due_date:    'Due_Date, Due Date, Req_Date, Ship_Date, Promise_Date',
      order_date:  'Order_Date, Start_Date, Open_Date, Date_Opened',
      job_value:   'Est_Total_Price, Total_Price, Revenue, Price, Ext_Price',
      qty_ordered: 'Qty_Ordered, Order_Qty, Quantity, Qty',
      part_number: 'Part, Part_Number, Part_No, PartNo',
      description: 'Description, Part_Desc, Desc, Item_Desc',
    };

    const guidanceEl = document.getElementById('mappingGuidance');
    const guidanceRows = missingFields.map(field =>
      `<div class="guide-row">
        <span class="guide-field">${labels[field] || field}</span>
        <span class="guide-variants">${TOP_VARIANTS[field] || ''}</span>
      </div>`
    ).join('');
    guidanceEl.innerHTML = `
      <div class="guide-header">To skip this step on future exports, rename the undetected columns to one of these accepted names:</div>
      ${guidanceRows}
    `;

    document.getElementById('applyMappingBtn').onclick = applyMapping;
    document.getElementById('backToUploadBtn').onclick = resetToUpload;
  }

  function applyMapping() {
    document.querySelectorAll('.map-select').forEach(sel => {
      if (sel.value) columnMap[sel.dataset.field] = sel.value;
    });

    const stillMissing = JFM.REQUIRED_FIELDS.filter(f => !columnMap[f]);
    if (stillMissing.length > 0) {
      document.getElementById('mappingError').textContent =
        `Required: ${stillMissing.join(', ')}. Please select a column for each.`;
      return;
    }
    document.getElementById('mappingError').textContent = '';
    runAndRender(columnMap);
  }

  // ─── Process & Render ──────────────────────────────────────

  function runAndRender(mapping) {
    const metrics = JFM.calculate(parsedRows, mapping);

    if (!metrics) {
      showError('No active jobs found in this file. Check that your Status/Stage column contains active records.');
      resetToUpload();
      return;
    }

    uploadSection.style.display  = 'none';
    mappingSection.style.display = 'none';
    dashSection.style.display    = 'block';

    renderKPIs(metrics);
    renderCharts(metrics);
    renderTable(metrics);
    renderSummary(metrics);

    // Scrub raw data from memory — raw job records must not remain inspectable
    parsedRows = [];
    metrics.priorityJobs = metrics.priorityJobs.map(j => ({
      job_number:   j.job_number,
      customer:     j.customer,
      stage:        j.stage,
      job_value:    j.job_value,
      days_overdue: j.days_overdue,
      score:        j.score,
      is_past_due:  j.is_past_due,
    }));

    // Scroll to dashboard
    dashSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ─── KPI Cards ────────────────────────────────────────────

  function fmt$(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '$' + Math.round(n).toLocaleString();
  }

  function renderKPIs(m) {
    document.getElementById('kpi-total-jobs').textContent    = m.totalJobs.toLocaleString();
    document.getElementById('kpi-constraint').textContent    = m.constraint || '—';
    document.getElementById('kpi-constraint-sub').textContent = `${m.jobsAtConstraint} jobs queued`;
    document.getElementById('kpi-revenue-risk').textContent  = m.hasValue ? fmt$(m.revenueAtRisk) : m.jobsAtConstraint + ' jobs';
    document.getElementById('kpi-cascade').textContent       = m.hasValue ? fmt$(m.cascadeTotal)   : (m.totalJobs - m.jobsAtConstraint) + ' jobs';
    document.getElementById('kpi-past-due').textContent      = m.hasDueDate ? m.pastDueCount : '—';
    document.getElementById('kpi-ontime').textContent        = m.hasDueDate ? m.onTimeRate + '%' : '—';

    // Color the on-time rate
    const otEl = document.getElementById('kpi-ontime');
    if (m.hasDueDate) {
      otEl.style.color = m.onTimeRate >= 80 ? '#4ade80' : m.onTimeRate >= 60 ? '#fbbf24' : '#f87171';
    }

    // Highlight past due in red if any
    if (m.hasDueDate && m.pastDueCount > 0) {
      document.getElementById('kpi-past-due').style.color = '#f87171';
    }

    document.getElementById('reportDate').textContent =
      m.reportDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('reportRecords').textContent =
      `${m.totalRecords} records processed — ${m.totalJobs} active jobs`;

    const customerLine = document.getElementById('reportCustomerLine');
    const customerSpan = document.getElementById('reportCustomer');
    if (m.customerName) {
      customerSpan.textContent = m.customerName;
      customerLine.style.display = '';
    } else {
      customerLine.style.display = 'none';
    }
  }

  // ─── Charts ───────────────────────────────────────────────

  const CHART_DEFAULTS = {
    color:       'rgba(244, 197, 66, 0.75)',
    colorHover:  'rgba(244, 197, 66, 1)',
    colorAlert:  'rgba(239, 68, 68, 0.85)',
    colorAlertH: 'rgba(239, 68, 68, 1)',
    gridColor:   'rgba(43, 47, 54, 0.8)',
    textColor:   '#B5B5BE',
  };

  function renderCharts(m) {
    if (chartBar)     { chartBar.destroy();     chartBar     = null; }
    if (chartRevenue) { chartRevenue.destroy(); chartRevenue = null; }

    const stages = m.stageOrder.filter(s => m.stageCounts[s]);
    const counts = stages.map(s => m.stageCounts[s] || 0);
    const barColors = stages.map(s =>
      s === m.constraint ? CHART_DEFAULTS.colorAlert : CHART_DEFAULTS.color
    );
    const barHover = stages.map(s =>
      s === m.constraint ? CHART_DEFAULTS.colorAlertH : CHART_DEFAULTS.colorHover
    );

    // Chart 1: Jobs per stage (horizontal)
    const ctx1 = document.getElementById('chartConstraint').getContext('2d');
    const opts1 = chartOptions('Active Jobs by Stage', 'Jobs');
    opts1.indexAxis = 'y';
    chartBar = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: stages,
        datasets: [{
          label: 'Active Jobs',
          data: counts,
          backgroundColor: barColors,
          hoverBackgroundColor: barHover,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: opts1,
    });

    // Chart 2: Revenue by stage (only if value data present)
    const chartRevWrap = document.getElementById('chartRevenueWrap');
    if (m.hasValue) {
      chartRevWrap.style.display = 'block';
      const vals = stages.map(s => Math.round(m.stageValues[s] || 0));
      const ctx2 = document.getElementById('chartRevenue').getContext('2d');
      chartRevenue = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: stages,
          datasets: [{
            label: 'Revenue Held ($)',
            data: vals,
            backgroundColor: barColors,
            hoverBackgroundColor: barHover,
            borderRadius: 4,
            borderSkipped: false,
          }]
        },
        options: chartOptions('Revenue Held by Stage', 'Value ($)', true),
      });
    } else {
      chartRevWrap.style.display = 'none';
    }
  }

  function chartOptions(title, yLabel, isCurrency = false) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#141418',
          borderColor: '#2B2F36',
          borderWidth: 1,
          titleColor: '#F8F9FA',
          bodyColor: '#B5B5BE',
          callbacks: {
            label: ctx => isCurrency
              ? ` $${ctx.raw.toLocaleString()}`
              : ` ${ctx.raw} jobs`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: CHART_DEFAULTS.textColor, font: { family: 'Inter', size: 12 } },
          grid:  { color: CHART_DEFAULTS.gridColor },
        },
        y: {
          ticks: {
            color: CHART_DEFAULTS.textColor,
            font: { family: 'Inter', size: 12 },
            callback: v => isCurrency ? '$' + v.toLocaleString() : v
          },
          grid:  { color: CHART_DEFAULTS.gridColor },
          beginAtZero: true,
        }
      }
    };
  }

  // ─── Priority Table ────────────────────────────────────────

  function renderTable(m) {
    const wrap = document.getElementById('priorityTableWrap');
    const tbody = document.getElementById('priorityTbody');

    if (!m.hasDueDate || m.priorityJobs.length === 0) {
      wrap.style.display = 'none';
      return;
    }

    wrap.style.display = 'block';

    const showValue   = m.hasValue;
    const showCustomer = m.priorityJobs.some(j => j.customer);

    tbody.innerHTML = m.priorityJobs.map((j, i) => {
      const urgency = j.days_overdue > 14 ? 'urgent' : j.days_overdue > 7 ? 'warning' : 'mild';
      return `<tr class="priority-row ${urgency}">
        <td class="td-rank">${i + 1}</td>
        <td class="td-job">${j.job_number || '—'}</td>
        ${showCustomer ? `<td class="td-cust">${j.customer || '—'}</td>` : ''}
        <td class="td-stage"><span class="stage-badge ${j.stage === m.constraint ? 'stage-constraint' : ''}">${j.stage || '—'}</span></td>
        ${showValue ? `<td class="td-val">${fmt$(j.job_value)}</td>` : ''}
        <td class="td-late"><span class="late-badge">${j.days_overdue}d late</span></td>
      </tr>`;
    }).join('');

    // Build header to match columns
    const thead = document.getElementById('priorityThead');
    thead.innerHTML = `<tr>
      <th>#</th>
      <th>Job</th>
      ${showCustomer ? '<th>Customer</th>' : ''}
      <th>Stage</th>
      ${showValue ? '<th>Value</th>' : ''}
      <th>Overdue</th>
    </tr>`;
  }

  // ─── Diagnostic Summary ────────────────────────────────────

  function renderSummary(m) {
    const el = document.getElementById('diagnosticSummary');
    const parts = [];

    // Constraint sentence
    if (m.hasValue && m.revenueAtRisk > 0) {
      parts.push(`<strong>${m.constraint}</strong> is your current production constraint, holding <strong>${fmt$(m.revenueAtRisk)}</strong> in active revenue across <strong>${m.jobsAtConstraint} job${m.jobsAtConstraint !== 1 ? 's' : ''}</strong>.`);
    } else {
      parts.push(`<strong>${m.constraint}</strong> is your current production constraint with <strong>${m.jobsAtConstraint} job${m.jobsAtConstraint !== 1 ? 's' : ''}</strong> currently queued.`);
    }

    // Cascade sentence
    if (m.hasValue && m.cascadeTotal > 0 && m.upstreamStages.length > 0) {
      parts.push(`An additional <strong>${fmt$(m.cascadeTotal)}</strong> in upstream work is on track to reach ${m.constraint} next.`);
    } else if (!m.hasValue && m.totalJobs - m.jobsAtConstraint > 0) {
      parts.push(`<strong>${m.totalJobs - m.jobsAtConstraint} additional jobs</strong> are upstream and will reach ${m.constraint} next.`);
    }

    // Due date sentence
    if (m.hasDueDate) {
      if (m.pastDueCount === 0) {
        parts.push('All tracked jobs are currently on schedule.');
      } else {
        parts.push(`<strong>${m.pastDueCount} job${m.pastDueCount !== 1 ? 's are' : ' is'} past due</strong> by an average of <strong>${m.avgDaysLate} day${m.avgDaysLate !== 1 ? 's' : ''}</strong>.`);
      }
    }

    // Total exposure
    if (m.hasValue && m.totalValue > 0) {
      parts.push(`Total active pipeline value: <strong>${fmt$(m.totalValue)}</strong>.`);
    }

    el.innerHTML = parts.map(p => `<p>${p}</p>`).join('');
  }

  // ─── Reset ────────────────────────────────────────────────

  function resetToUpload() {
    parsedRows  = [];
    csvHeaders  = [];
    columnMap   = {};

    uploadSection.style.display  = 'block';
    mappingSection.style.display = 'none';
    dashSection.style.display    = 'none';

    if (chartBar)     { chartBar.destroy();     chartBar     = null; }
    if (chartRevenue) { chartRevenue.destroy(); chartRevenue = null; }

    fileInput.value = '';
    dropMsg.innerHTML = dropMsgDefault();
    clearError();
    uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.getElementById('resetBtn')?.addEventListener('click', resetToUpload);
  document.getElementById('resetBtn2')?.addEventListener('click', resetToUpload);

  // ─── Print / Export ───────────────────────────────────────

  document.getElementById('printBtn')?.addEventListener('click', () => window.print());

});
