/* =====================================================================
   Studio Business Manager — Offline CRM + Invoice + PM
   v1.1 — Pure HTML/CSS/JS · IndexedDB Storage · No Frameworks
   ===================================================================== */

/* ===================== IndexedDB Wrapper ===================== */
const DB_NAME = 'StudioBusinessManagerDB';
const DB_VERSION = 1;
const STORES = ['customers','projects','quotations','invoices','payments','expenses','receipts','settings','meta'];
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      STORES.forEach(s => {
        if (!d.objectStoreNames.contains(s)) {
          if (s === 'settings' || s === 'meta')
            d.createObjectStore(s, { keyPath: 'key' });
          else
            d.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
        }
      });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e);
  });
}

function tx(store, mode='readonly') { return db.transaction(store, mode).objectStore(store); }

function dbAdd(store, data) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').add(data);
    r.onsuccess = () => { res(r.result); triggerCloudSync(store); };
    r.onerror = e => rej(e);
  });
}
function dbPut(store, data) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').put(data);
    r.onsuccess = () => { res(r.result); triggerCloudSync(store); };
    r.onerror = e => rej(e);
  });
}
function dbGet(store, id) {
  return new Promise((res, rej) => {
    const r = tx(store).get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e);
  });
}
function dbAll(store) {
  return new Promise((res, rej) => {
    const r = tx(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = e => rej(e);
  });
}
function dbDelete(store, id) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').delete(id);
    r.onsuccess = () => { res(true); triggerCloudSync(store); };
    r.onerror = e => rej(e);
  });
}
function dbClear(store) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').clear();
    r.onsuccess = () => { res(true); triggerCloudSync(store); };
    r.onerror = e => rej(e);
  });
}

/* ===================== CLOUD SYNC HOOKS =====================
   Wraps DB writes → every change debounces a push to GitHub.
   The cloud-sync.js module handles auth, retries, conflicts.
   Excludes the 'meta' store entries that are purely device-local
   (backup folder handle, last_auto_backup_at) to avoid noisy pushes.
   ============================================================= */
const CLOUD_LOCAL_META_KEYS = new Set(['backup_dir_handle', 'last_auto_backup_at']);

function triggerCloudSync(store) {
  if (typeof window === 'undefined' || !window.CLOUD) return;
  if (!window.CLOUD.isConfigured()) return;
  // schedulePush internally debounces and fetches payload only when firing
  window.CLOUD.schedulePush(async () => await buildCloudPayload());
  if (typeof updateCloudIndicator === 'function') updateCloudIndicator();
}

async function buildCloudPayload() {
  const customers   = await dbAll('customers');
  const projects    = await dbAll('projects');
  const quotations  = await dbAll('quotations');
  const invoices    = await dbAll('invoices');
  const payments    = await dbAll('payments');
  const expenses    = await dbAll('expenses');
  const receipts    = await dbAll('receipts');
  const sObj        = await dbGet('settings', 'company');
  const settingsObj = sObj?.value || {};
  const actObj      = await dbGet('meta', 'activities');
  const activities  = actObj?.value || [];
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    source: 'cloud-sync',
    customers, projects, quotations, invoices, payments, expenses, receipts,
    settings: settingsObj,
    activities,
  };
}

/* Apply a cloud payload into IndexedDB.
   Suspends auto-push during apply so we don't echo back. */
async function applyCloudPayload(d) {
  if (!d) return;
  if (window.CLOUD) window.CLOUD.suspend();
  try {
    for (const s of STORES) await new Promise((res, rej) => {
      const r = db.transaction(s, 'readwrite').objectStore(s).clear();
      r.onsuccess = () => res(true); r.onerror = e => rej(e);
    });
    const rawAdd = (store, data) => new Promise((res, rej) => {
      const r = db.transaction(store, 'readwrite').objectStore(store).add(data);
      r.onsuccess = () => res(r.result); r.onerror = e => rej(e);
    });
    const rawPut = (store, data) => new Promise((res, rej) => {
      const r = db.transaction(store, 'readwrite').objectStore(store).put(data);
      r.onsuccess = () => res(r.result); r.onerror = e => rej(e);
    });
    for (const c of (d.customers||[]))  await rawAdd('customers', c);
    for (const p of (d.projects||[]))   await rawAdd('projects',  p);
    for (const q of (d.quotations||[])) await rawAdd('quotations',q);
    for (const i of (d.invoices||[]))   await rawAdd('invoices',  i);
    for (const p of (d.payments||[]))   await rawAdd('payments',  p);
    for (const e of (d.expenses||[]))   await rawAdd('expenses',  e);
    for (const r of (d.receipts||[]))   await rawAdd('receipts',  r);
    if (d.settings)   await rawPut('settings', { key: 'company',    value: d.settings });
    if (d.activities) await rawPut('meta',     { key: 'activities', value: d.activities });
  } finally {
    if (window.CLOUD) window.CLOUD.resume();
  }
}

/* ===================== Helpers ===================== */
const $ = id => document.getElementById(id);
const fmtMoney = n => (settings.currency || '₹') + Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2, maximumFractionDigits:2});
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '-';
const today = () => new Date().toISOString().slice(0,10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const fullDateLabel = (d = new Date()) => new Date(d).toLocaleDateString('en-GB', {
  day: '2-digit', month: 'long', year: 'numeric'
});

// Sanitize a string so it is safe as a filename across OSes
function safeFileName(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Document';
}

/* ===================== WhatsApp + Gmail Share Helpers ===================== */
// Normalize a phone number into wa.me digits (no '+', no spaces, no dashes).
// Adds India country code 91 if number is a 10-digit local mobile.
function normalizeWaNumber(num) {
  if (!num) return '';
  let d = String(num).replace(/[^\d]/g, '');
  if (!d) return '';
  // Strip leading zero
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  // Default country code: India 91
  if (d.length === 10) d = '91' + d;
  return d;
}

function customerWhatsappNumber(c) {
  if (!c) return '';
  return normalizeWaNumber(c.whatsapp || c.mobile || '');
}

function buildWaUrl(number, message) {
  const base = number ? `https://wa.me/${number}` : `https://wa.me/`;
  return `${base}?text=${encodeURIComponent(message || '')}`;
}

function buildGmailUrl(to, subject, body) {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: to || '',
    su: subject || '',
    body: body || ''
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

function openInNewTab(url) {
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) toast('Pop-up blocked — please allow pop-ups for sharing.', 'error');
}

// Build a friendly invoice message for WhatsApp / Email body
function invoiceMessageText(inv, c) {
  const cn = settings.company_name || 'Studio';
  const name = (c && c.name) || 'Customer';
  const paid = (inv.total || 0) - (inv.balance || 0);
  const lines = [
    `Hello ${name},`,
    ``,
    `Greetings from *${cn}*.`,
    `Please find your invoice details below:`,
    ``,
    `🧾 Invoice #: *${inv.number}*`,
    `📅 Date: ${fmtDate(inv.date)}`,
    `💰 Total: ${fmtMoney(inv.total)}`,
    `✅ Paid: ${fmtMoney(paid)}`,
    `⏳ Balance: ${fmtMoney(inv.balance)}`,
    `📌 Status: ${inv.status}`,
  ];
  if (settings.upi) lines.push(``, `📲 UPI: ${settings.upi}`);
  lines.push(``, `Thank you for your business!`, `— ${cn}`);
  return lines.join('\n');
}

function receiptMessageText(r, c, inv) {
  const cn = settings.company_name || 'Studio';
  const name = (c && c.name) || 'Customer';
  const lines = [
    `Hello ${name},`,
    ``,
    `Greetings from *${cn}*.`,
    `This is your payment receipt:`,
    ``,
    `🧮 Receipt #: *${r.number}*`,
    `📅 Date: ${fmtDate(r.date)}`,
    `💵 Amount Received: ${fmtMoney(r.amount)}`,
    `💳 Mode: ${r.mode}`,
  ];
  if (inv) {
    lines.push(`🧾 Against Invoice: ${inv.number}`);
    lines.push(`⏳ Balance Remaining: ${fmtMoney(inv.balance)}`);
  }
  lines.push(``, `Thank you for your payment!`, `— ${cn}`);
  return lines.join('\n');
}

/* ---------------------------------------------------------------
   Auto-PDF-before-share:
   Browsers cannot attach files to wa.me or Gmail compose URLs.
   So when the user clicks "WhatsApp" or "Email" on any document,
   we FIRST silently render the same PDF the print modal uses
   (so it lands in the user's Downloads folder ready to attach),
   THEN open WhatsApp / Gmail. The message body explicitly tells
   the customer / user that the PDF is attached.                  */
let _lastAutoPdfAt = 0;
function autoSavePdfThen(renderFn, afterDelayMs = 700) {
  // Render the document into the (hidden) preview modal so we have its HTML
  try { renderFn(); } catch(e) { console.warn('PDF render failed', e); }
  // Avoid double-fire if user spam-clicks
  if (Date.now() - _lastAutoPdfAt < 1500) return Promise.resolve();
  _lastAutoPdfAt = Date.now();
  // Fire print/save-as-PDF in next tick so the modal DOM is ready
  return new Promise(resolve => {
    setTimeout(() => {
      try { printDoc(); } catch(e) { console.warn('print failed', e); }
      // Close the preview modal that was opened for rendering — keep UX tidy
      setTimeout(() => {
        try { closeModal('docModal'); } catch(e){}
        resolve();
      }, afterDelayMs);
    }, 50);
  });
}

function _attachmentNote() {
  return `📎 A PDF copy is attached for your records.`;
}

function sendInvoiceWhatsApp(invId) {
  const inv = invoices.find(x => x.id === invId); if (!inv) return;
  const c = customers.find(x => x.id === inv.customer_id) || {};
  const num = customerWhatsappNumber(c);
  const docOpen = $('docModal').classList.contains('active');
  // Auto-download the PDF first (so user can attach it in WhatsApp)
  if (!docOpen) autoSavePdfThen(() => previewInvoice(invId));
  else { try { printDoc(); } catch(e){} }
  toast('📄 PDF downloading — attach it in WhatsApp', 'success');
  if (!num) toast('No WhatsApp/Mobile number for this customer. Opening WhatsApp with empty number.', '');
  const msg = invoiceMessageText(inv, c) + `\n\n` + _attachmentNote();
  setTimeout(() => openInNewTab(buildWaUrl(num, msg)), docOpen ? 200 : 1500);
}

function sendReceiptWhatsApp(rId) {
  const r = receipts.find(x => x.id === rId); if (!r) return;
  const c = customers.find(x => x.id === r.customer_id) || {};
  const inv = invoices.find(x => x.id === r.invoice_id);
  const num = customerWhatsappNumber(c);
  const docOpen = $('docModal').classList.contains('active');
  if (!docOpen) autoSavePdfThen(() => previewReceipt(rId));
  else { try { printDoc(); } catch(e){} }
  toast('📄 PDF downloading — attach it in WhatsApp', 'success');
  if (!num) toast('No WhatsApp/Mobile number for this customer. Opening WhatsApp with empty number.', '');
  const msg = receiptMessageText(r, c, inv) + `\n\n` + _attachmentNote();
  setTimeout(() => openInNewTab(buildWaUrl(num, msg)), docOpen ? 200 : 1500);
}

function emailInvoice(invId) {
  const inv = invoices.find(x => x.id === invId); if (!inv) return;
  const c = customers.find(x => x.id === inv.customer_id) || {};
  const subj = `Invoice ${inv.number} from ${settings.company_name || 'Studio'}`;
  const docOpen = $('docModal').classList.contains('active');
  if (!docOpen) autoSavePdfThen(() => previewInvoice(invId));
  else { try { printDoc(); } catch(e){} }
  toast('📄 PDF downloading — attach it in Gmail', 'success');
  const body = invoiceMessageText(inv, c) + `\n\n` + _attachmentNote();
  setTimeout(() => openInNewTab(buildGmailUrl(c.email || '', subj, body)), docOpen ? 200 : 1500);
}

function emailReceipt(rId) {
  const r = receipts.find(x => x.id === rId); if (!r) return;
  const c = customers.find(x => x.id === r.customer_id) || {};
  const inv = invoices.find(x => x.id === r.invoice_id);
  const subj = `Payment Receipt ${r.number} from ${settings.company_name || 'Studio'}`;
  const docOpen = $('docModal').classList.contains('active');
  if (!docOpen) autoSavePdfThen(() => previewReceipt(rId));
  else { try { printDoc(); } catch(e){} }
  toast('📄 PDF downloading — attach it in Gmail', 'success');
  const body = receiptMessageText(r, c, inv) + `\n\n` + _attachmentNote();
  setTimeout(() => openInNewTab(buildGmailUrl(c.email || '', subj, body)), docOpen ? 200 : 1500);
}

// Doc-modal share buttons (work for whatever doc is currently previewed)
function shareDocViaWhatsApp() {
  const dm = $('docModal');
  const type = dm.dataset.shareType;
  const id = parseInt(dm.dataset.shareId);
  if (!type || !id) return toast('Nothing to share', 'error');
  if (type === 'invoice')   sendInvoiceWhatsApp(id);
  else if (type === 'receipt') sendReceiptWhatsApp(id);
  else if (type === 'quotation') sendQuotationWhatsApp(id);
  else if (type === 'ledger') sendLedgerWhatsApp(id);
}
function shareDocViaEmail() {
  const dm = $('docModal');
  const type = dm.dataset.shareType;
  const id = parseInt(dm.dataset.shareId);
  if (!type || !id) return toast('Nothing to share', 'error');
  if (type === 'invoice')   emailInvoice(id);
  else if (type === 'receipt') emailReceipt(id);
  else if (type === 'quotation') emailQuotation(id);
  else if (type === 'ledger') emailLedger(id);
}

function sendQuotationWhatsApp(id) {
  const q = quotations.find(x => x.id === id); if (!q) return;
  const c = customers.find(x => x.id === q.customer_id) || {};
  const cn = settings.company_name || 'Studio';
  const name = c.name || q.guest_name || 'Customer';
  const docOpen = $('docModal').classList.contains('active');
  if (!docOpen) autoSavePdfThen(() => previewQuotation(id));
  else { try { printDoc(); } catch(e){} }
  toast('📄 PDF downloading — attach it in WhatsApp', 'success');
  const msg = [
    `Hello ${name},`, ``, `Greetings from *${cn}*.`,
    `Please find your quotation details below:`, ``,
    `📝 Quotation #: *${q.number}*`,
    `📅 Date: ${fmtDate(q.date)}`,
    q.valid ? `⏳ Valid Till: ${fmtDate(q.valid)}` : '',
    `💰 Total: ${fmtMoney(q.total)}`,
    ``, `Looking forward to working with you!`, `— ${cn}`,
    ``, _attachmentNote()
  ].filter(Boolean).join('\n');
  const num = customerWhatsappNumber(c);
  setTimeout(() => openInNewTab(buildWaUrl(num, msg)), docOpen ? 200 : 1500);
}
function emailQuotation(id) {
  const q = quotations.find(x => x.id === id); if (!q) return;
  const c = customers.find(x => x.id === q.customer_id) || {};
  const subj = `Quotation ${q.number} from ${settings.company_name || 'Studio'}`;
  const cn = settings.company_name || 'Studio';
  const name = c.name || q.guest_name || 'Customer';
  const docOpen = $('docModal').classList.contains('active');
  if (!docOpen) autoSavePdfThen(() => previewQuotation(id));
  else { try { printDoc(); } catch(e){} }
  toast('📄 PDF downloading — attach it in Gmail', 'success');
  const body = [
    `Hello ${name},`, ``, `Greetings from ${cn}.`,
    `Please find your quotation details below:`, ``,
    `Quotation #: ${q.number}`,
    `Date: ${fmtDate(q.date)}`,
    q.valid ? `Valid Till: ${fmtDate(q.valid)}` : '',
    `Total: ${fmtMoney(q.total)}`,
    ``, `Looking forward to working with you!`, `— ${cn}`,
    ``, _attachmentNote()
  ].filter(Boolean).join('\n');
  setTimeout(() => openInNewTab(buildGmailUrl(c.email || '', subj, body)), docOpen ? 200 : 1500);
}
function sendLedgerWhatsApp(custId) {
  const c = customers.find(x => x.id === custId); if (!c) return;
  const cn = settings.company_name || 'Studio';
  const invs = invoices.filter(inv => inv.customer_id === custId);
  const totalBill = invs.reduce((s,i)=>s+(i.total||0), 0);
  const pending = invs.reduce((s,i)=>s+(i.balance||0), 0);
  const docOpen = $('docModal').classList.contains('active');
  if (!docOpen) autoSavePdfThen(() => previewCustomerLedger(custId));
  else { try { printDoc(); } catch(e){} }
  toast('📄 Ledger PDF downloading — attach it in WhatsApp', 'success');
  const msg = [
    `Hello ${c.name},`, ``, `Greetings from *${cn}*.`,
    `Please find your account ledger summary below:`, ``,
    `🧾 Total Invoices: ${invs.length}`,
    `💰 Total Billing: ${fmtMoney(totalBill)}`,
    `⏳ Outstanding Balance: ${fmtMoney(pending)}`,
    ``, _attachmentNote(), `— ${cn}`
  ].join('\n');
  setTimeout(() => openInNewTab(buildWaUrl(customerWhatsappNumber(c), msg)), docOpen ? 200 : 1500);
}
function emailLedger(custId) {
  const c = customers.find(x => x.id === custId); if (!c) return;
  const cn = settings.company_name || 'Studio';
  const invs = invoices.filter(inv => inv.customer_id === custId);
  const totalBill = invs.reduce((s,i)=>s+(i.total||0), 0);
  const pending = invs.reduce((s,i)=>s+(i.balance||0), 0);
  const docOpen = $('docModal').classList.contains('active');
  if (!docOpen) autoSavePdfThen(() => previewCustomerLedger(custId));
  else { try { printDoc(); } catch(e){} }
  toast('📄 Ledger PDF downloading — attach it in Gmail', 'success');
  const body = [
    `Hello ${c.name},`, ``, `Greetings from ${cn}.`,
    `Please find your account ledger summary below:`, ``,
    `Total Invoices: ${invs.length}`,
    `Total Billing: ${fmtMoney(totalBill)}`,
    `Outstanding Balance: ${fmtMoney(pending)}`,
    ``, _attachmentNote(), `— ${cn}`
  ].join('\n');
  setTimeout(() => openInNewTab(buildGmailUrl(c.email || '', `Account Ledger — ${c.name}`, body)), docOpen ? 200 : 1500);
}

let backupDirectoryHandle = null;
let autoBackupTimer = null;
let lastAutoBackupAt = null;
const AUTO_BACKUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

function toast(msg, type='') {
  const t = $('toast'); t.textContent = msg;
  t.className = 'show ' + type;
  setTimeout(() => t.className = '', 2200);
}

/* ---------------------------------------------------------------
   Modal stack manager (fixes "Quick Add Customer behind invoice"):
   - Each opened modal is pushed onto _modalStack.
   - The topmost modal gets .modal-top so it overlays everything else.
   - A second translucent backdrop sits between layers so the user can
     visually see two modals stacked.
--------------------------------------------------------------- */
const _modalStack = [];
function _ensureSecondBackdrop() {
  let bd = document.getElementById('modalBackdropTop');
  if (!bd) {
    bd = document.createElement('div');
    bd.id = 'modalBackdropTop';
    bd.className = 'modal-backdrop modal-top-backdrop';
    document.body.appendChild(bd);
  }
  return bd;
}
function _refreshModalStack() {
  // Clear all .modal-top markers
  document.querySelectorAll('.modal.modal-top').forEach(m => m.classList.remove('modal-top'));
  const topBd = _ensureSecondBackdrop();
  if (_modalStack.length > 1) {
    const topId = _modalStack[_modalStack.length - 1];
    const el = $(topId);
    if (el) el.classList.add('modal-top');
    topBd.classList.add('active');
  } else {
    topBd.classList.remove('active');
  }
}
function openModal(id) {
  $('modalBackdrop').classList.add('active');
  $(id).classList.add('active');
  if (!_modalStack.includes(id)) _modalStack.push(id);
  _refreshModalStack();
}
function closeModal(id) {
  $(id).classList.remove('active');
  // Pop from stack (most-recent occurrence)
  for (let i = _modalStack.length - 1; i >= 0; i--) {
    if (_modalStack[i] === id) { _modalStack.splice(i, 1); break; }
  }
  setTimeout(() => {
    const anyOpen = document.querySelectorAll('.modal.active').length > 0;
    if (!anyOpen) $('modalBackdrop').classList.remove('active');
    _refreshModalStack();
  }, 50);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    $('modalBackdrop').classList.remove('active');
  }
});

/* ===================== State ===================== */
let settings = {};
let customers = [], projects = [], quotations = [], invoices = [], payments = [], expenses = [], receipts = [];
let activities = [];

// Default lists
const DEFAULT_PROJECT_TYPES = [
  'Wedding Photography', 'Pre Wedding', 'Engagement', 'Birthday', 'Maternity',
  'Newborn', 'Album Designing', 'Graphic Designing', 'Video Editing', 'Custom Project'
];
const DEFAULT_PROJECT_STATUSES = [
  'Pending','Inquiry','Quotation Sent','Booked','In Progress','Editing',
  'Album Designing','Ready','Delivered','Completed','Cancelled'
];

async function loadAll() {
  [customers, projects, quotations, invoices, payments, expenses, receipts] = await Promise.all([
    dbAll('customers'), dbAll('projects'), dbAll('quotations'),
    dbAll('invoices'), dbAll('payments'), dbAll('expenses'), dbAll('receipts')
  ]);
  const s = await dbGet('settings','company');
  settings = s ? s.value : defaultSettings();
  // Ensure settings has new fields
  if (!Array.isArray(settings.project_types) || !settings.project_types.length) {
    settings.project_types = DEFAULT_PROJECT_TYPES.slice();
  }
  if (!Array.isArray(settings.auto_items)) {
    settings.auto_items = [];
  }
  const a = await dbGet('meta','activities');
  activities = a ? a.value : [];
}

function defaultSettings() {
  return {
    company_name:'Studio Business Manager', logo:'', address:'', mobile:'', whatsapp:'',
    email:'', website:'', gst:'', pan:'',
    bank_name:'', acc_holder:'', acc_no:'', ifsc:'', upi:'',
    tax: 0, currency: '₹', inv_prefix:'INV', quote_prefix:'QT', rec_prefix:'RC',
    project_types: DEFAULT_PROJECT_TYPES.slice(),
    auto_items: []
  };
}

async function logActivity(text, icon='✨') {
  activities.unshift({ text, icon, time: Date.now() });
  activities = activities.slice(0, 30);
  await dbPut('meta', { key:'activities', value: activities });
}

/* ===================== Navigation ===================== */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const p = item.dataset.page;
    document.querySelectorAll('.page').forEach(pg => pg.classList.remove('active'));
    $('page-' + p).classList.add('active');
    if (window.innerWidth < 880) $('sidebar').classList.remove('open');
    pageHook(p);
  });
});
$('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));

// Programmatic navigation (used by dashboard clickable cards)
function goPage(p, filter) {
  document.querySelectorAll('.nav-item').forEach(i => {
    i.classList.toggle('active', i.dataset.page === p);
  });
  document.querySelectorAll('.page').forEach(pg => pg.classList.remove('active'));
  const target = $('page-' + p);
  if (target) target.classList.add('active');
  pageHook(p);
  // Apply contextual filters
  if (p === 'projects' && $('projectStatusFilter')) {
    if (filter === 'active') {
      $('projectStatusFilter').value = 'In Progress';
    } else if (filter === 'completed') {
      $('projectStatusFilter').value = 'Completed';
    } else if (filter === 'upcoming') {
      $('projectStatusFilter').value = '';
    } else {
      $('projectStatusFilter').value = '';
    }
    renderProjects();
  }
  if (p === 'invoices' && $('invoiceStatusFilter')) {
    if (filter === 'pending') $('invoiceStatusFilter').value = 'Unpaid';
    else $('invoiceStatusFilter').value = '';
    renderInvoices();
  }
  window.scrollTo({top:0, behavior:'smooth'});
}

function pageHook(p) {
  if (p==='dashboard') renderDashboard();
  if (p==='customers') renderCustomers();
  if (p==='projects') { populateProjectStatusFilter(); renderProjects(); }
  if (p==='quotations') renderQuotations();
  if (p==='invoices') renderInvoices();
  if (p==='payments') renderPayments();
  if (p==='receipts') renderReceipts();
  if (p==='expenses') renderExpenses();
  if (p==='settings') loadSettingsForm();
  if (p==='recurring') renderRecurring();
  if (p==='cloud') { if (typeof renderCloudStatusPanel === 'function') renderCloudStatusPanel(); }
}

/* ===================== Theme ===================== */
$('themeToggle').addEventListener('click', () => {
  const cur = document.body.dataset.theme;
  const next = cur === 'light' ? 'dark' : 'light';
  document.body.dataset.theme = next;
  $('themeToggle').textContent = next === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
  localStorage.setItem('sbm_theme', next);
});

/* ===================== Settings ===================== */
function loadSettingsForm() {
  ['company_name','address','mobile','whatsapp','email','website','gst','pan',
   'bank_name','acc_holder','acc_no','ifsc','upi','currency','inv_prefix','quote_prefix','rec_prefix']
   .forEach(k => { const el = $('set_'+k); if (el) el.value = settings[k] || ''; });
  $('set_tax').value = settings.tax || 0;
  $('logoPreview').src = settings.logo || '';
  $('logoPreview').style.display = settings.logo ? 'inline' : 'none';
  applyCompanyNameToUI();
  if (settings.logo) { $('brandLogo').innerHTML = `<img src="${settings.logo}"/>`; }
  renderProjectTypesList();
  renderAutoItemsList();
}

function applyCompanyNameToUI() {
  const name = settings.company_name || 'Studio Business Manager';
  $('topCompanyName').textContent = name;
  // Split name: first word goes to brand-title, rest to subtitle (or full)
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    $('brandTitle').textContent = parts[0];
    $('brandSub').textContent = parts.slice(1).join(' ');
  } else {
    $('brandTitle').textContent = name;
    $('brandSub').textContent = 'Business Manager';
  }
  // dashboard title remains "Dashboard"; we don't overwrite it
}

$('set_logo')?.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    settings.logo = r.result;
    $('logoPreview').src = r.result;
    $('logoPreview').style.display = 'inline';
  };
  r.readAsDataURL(f);
});

function renderProjectTypesList() {
  const box = $('projectTypesList');
  if (!box) return;
  if (!settings.project_types || !settings.project_types.length) {
    settings.project_types = DEFAULT_PROJECT_TYPES.slice();
  }
  box.innerHTML = settings.project_types.map((t,i)=>`
    <div class="sl-row">
      <input type="text" class="input" value="${escapeHtml(t)}" data-idx="${i}" data-kind="ptype"/>
      <span></span>
      <button type="button" class="rm" onclick="removeProjectType(${i})">×</button>
    </div>
  `).join('');
  // listen for edits
  box.querySelectorAll('input[data-kind="ptype"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx);
      settings.project_types[idx] = e.target.value;
    });
  });
}
function addProjectTypeRow() {
  settings.project_types = settings.project_types || [];
  settings.project_types.push('New Type');
  renderProjectTypesList();
}
function removeProjectType(i) {
  settings.project_types.splice(i,1);
  renderProjectTypesList();
}

function renderAutoItemsList() {
  const box = $('autoItemsList');
  if (!box) return;
  if (!Array.isArray(settings.auto_items)) settings.auto_items = [];
  if (!settings.auto_items.length) {
    box.innerHTML = `<p class="muted" style="text-align:center;padding:10px;">No auto items yet. Click "+ Add Item" to add one.</p>`;
    return;
  }
  box.innerHTML = settings.auto_items.map((it,i)=>`
    <div class="sl-row">
      <input type="text" class="input" placeholder="Item description" value="${escapeHtml(it.desc||'')}" data-idx="${i}" data-kind="ai-desc"/>
      <input type="number" class="input" placeholder="Rate (0 = ask later)" value="${it.rate||0}" data-idx="${i}" data-kind="ai-rate"/>
      <button type="button" class="rm" onclick="removeAutoItem(${i})">×</button>
    </div>
  `).join('');
  box.querySelectorAll('input[data-kind="ai-desc"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx);
      settings.auto_items[idx].desc = e.target.value;
    });
  });
  box.querySelectorAll('input[data-kind="ai-rate"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx);
      settings.auto_items[idx].rate = parseFloat(e.target.value) || 0;
    });
  });
}
function addAutoItemRow() {
  settings.auto_items = settings.auto_items || [];
  settings.auto_items.push({ desc: '', rate: 0 });
  renderAutoItemsList();
}
function removeAutoItem(i) {
  settings.auto_items.splice(i,1);
  renderAutoItemsList();
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function populateProjectStatusFilter() {
  const sel = $('projectStatusFilter');
  if (!sel) return;
  const cur = sel.value;
  const statuses = DEFAULT_PROJECT_STATUSES;
  sel.innerHTML = `<option value="">All Status</option>` +
    statuses.map(s => `<option value="${s}">${s}</option>`).join('');
  sel.value = cur || '';
}

async function saveSettings() {
  ['company_name','address','mobile','whatsapp','email','website','gst','pan',
   'bank_name','acc_holder','acc_no','ifsc','upi','currency','inv_prefix','quote_prefix','rec_prefix']
   .forEach(k => settings[k] = $('set_'+k).value.trim());
  settings.tax = parseFloat($('set_tax').value)||0;
  // Clean empty project types
  settings.project_types = (settings.project_types||[]).map(s=>String(s||'').trim()).filter(Boolean);
  if (!settings.project_types.length) settings.project_types = DEFAULT_PROJECT_TYPES.slice();
  // Clean auto_items
  settings.auto_items = (settings.auto_items||[])
    .map(it=>({ desc: String(it.desc||'').trim(), rate: parseFloat(it.rate)||0 }))
    .filter(it=>it.desc);
  await dbPut('settings', { key:'company', value: settings });
  applyCompanyNameToUI();
  if (settings.logo) $('brandLogo').innerHTML = `<img src="${settings.logo}"/>`;
  toast('Settings saved', 'success');
}

/* ===================== Customers ===================== */
function openCustomerModal(id) {
  $('cust_id').value = id || '';
  $('customerModalTitle').textContent = id ? 'Edit Customer' : 'Add Customer';
  if (id) {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    $('cust_name').value = c.name || '';
    $('cust_mobile').value = c.mobile || '';
    $('cust_whatsapp').value = c.whatsapp || '';
    $('cust_email').value = c.email || '';
    $('cust_city').value = c.city || '';
    $('cust_address').value = c.address || '';
    $('cust_notes').value = c.notes || '';
  } else {
    ['cust_name','cust_mobile','cust_whatsapp','cust_email','cust_city','cust_address','cust_notes']
      .forEach(f => $(f).value = '');
  }
  // mark that this is NOT a quick-add (default flow)
  $('customerModal').dataset.quickTarget = '';
  openModal('customerModal');
}

// Quick-add customer — called from invoice/quote/project modals
function quickAddCustomer(targetSelectId) {
  ['cust_name','cust_mobile','cust_whatsapp','cust_email','cust_city','cust_address','cust_notes']
    .forEach(f => $(f).value = '');
  $('cust_id').value = '';
  $('customerModalTitle').textContent = 'Quick Add Customer';
  $('customerModal').dataset.quickTarget = targetSelectId;
  openModal('customerModal');
}

async function saveCustomer() {
  const name = $('cust_name').value.trim();
  const mobile = $('cust_mobile').value.trim();
  if (!name || !mobile) return toast('Name & Mobile required','error');
  const id = $('cust_id').value;
  const data = {
    name, mobile,
    whatsapp: $('cust_whatsapp').value.trim(),
    email: $('cust_email').value.trim(),
    city: $('cust_city').value.trim(),
    address: $('cust_address').value.trim(),
    notes: $('cust_notes').value.trim(),
    created: Date.now()
  };
  let newId;
  if (id) { data.id = Number(id); await dbPut('customers', data); newId = data.id; }
  else { newId = await dbAdd('customers', data); data.id = newId; }
  await logActivity(`Customer ${id ? 'updated' : 'added'}: ${name}`, '👤');
  await loadAll();
  renderCustomers();
  renderDashboard();
  closeModal('customerModal');
  toast('Customer saved', 'success');

  // If this was a quick-add, refresh the target dropdown and pre-select the new customer
  const target = $('customerModal').dataset.quickTarget;
  if (target) {
    const sel = $(target);
    if (sel) {
      const placeholder = target === 'quote_customer'
        ? `<option value="">-- Guest / No Customer --</option>`
        : `<option value="">-- Select Customer --</option>`;
      sel.innerHTML = placeholder + customers.map(c => `<option value="${c.id}">${c.name} (${c.mobile})</option>`).join('');
      sel.value = String(newId);
      // trigger any change handler (invoice projects)
      sel.dispatchEvent(new Event('change'));
    }
    $('customerModal').dataset.quickTarget = '';
  }
}

async function deleteCustomer(id) {
  if (!confirm('Delete this customer? Related projects/invoices remain.')) return;
  await dbDelete('customers', id);
  await loadAll(); renderCustomers(); renderDashboard();
  toast('Customer deleted','success');
}

function renderCustomers() {
  const q = ($('customerSearch')?.value || '').toLowerCase();
  const filtered = customers.filter(c =>
    !q || (c.name+' '+c.mobile+' '+(c.city||'')+' '+(c.email||'')).toLowerCase().includes(q)
  ).sort((a,b)=>b.created-a.created);
  const body = $('customerTable');
  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:30px;">No customers found</td></tr>`;
    return;
  }
  body.innerHTML = filtered.map((c,i) => {
    const projs = projects.filter(p => p.customer_id === c.id);
    const pending = invoices.filter(inv => inv.customer_id === c.id)
                            .reduce((s,inv) => s + (inv.balance||0), 0);
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${escapeHtml(c.name)}</strong><br><small style="color:var(--muted)">${escapeHtml(c.email||'')}</small></td>
      <td>${escapeHtml(c.mobile)}</td>
      <td>${escapeHtml(c.city||'-')}</td>
      <td>${projs.length}</td>
      <td>${fmtMoney(pending)}</td>
      <td class="actions">
        <button class="act-btn" onclick="viewCustomer(${c.id})">View</button>
        <button class="act-btn" onclick="openCustomerModal(${c.id})">Edit</button>
        <button class="act-btn danger" onclick="deleteCustomer(${c.id})">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

$('customerSearch')?.addEventListener('input', renderCustomers);

function viewCustomer(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  const projs = projects.filter(p => p.customer_id === id);
  const invs = invoices.filter(inv => inv.customer_id === id);
  const quotes = quotations.filter(q => q.customer_id === id);
  const totalBill = invs.reduce((s,i)=>s+(i.total||0), 0);
  const totalPaid = invs.reduce((s,i)=>s+((i.total||0)-(i.balance||0)), 0);
  const pending = invs.reduce((s,i)=>s+(i.balance||0), 0);
  const pays = payments.filter(p => invs.some(inv => inv.id === p.invoice_id));

  $('customerProfileBody').innerHTML = `
    <div class="profile-head">
      <div class="profile-avatar">${c.name.charAt(0).toUpperCase()}</div>
      <div style="flex:1;">
        <h3>${escapeHtml(c.name)}</h3>
        <p class="muted">📱 ${escapeHtml(c.mobile)} ${c.whatsapp ? '· 💬 '+escapeHtml(c.whatsapp):''} ${c.email?'· ✉️ '+escapeHtml(c.email):''}</p>
        <p class="muted">${escapeHtml(c.city||'')} ${c.address?'· '+escapeHtml(c.address):''}</p>
      </div>
      <div class="profile-actions" style="display:flex;flex-wrap:wrap;gap:6px;">
        <button class="btn-primary" onclick="previewCustomerLedger(${c.id})">📄 Ledger PDF</button>
        <button class="btn-wa" onclick="sendLedgerWhatsApp(${c.id})"><span class="ic-wa-svg"></span> WhatsApp</button>
        <button class="btn-email" onclick="emailLedger(${c.id})"><span class="ic-gmail-svg"></span> Email</button>
      </div>
    </div>
    <div class="profile-stats">
      <div class="ps"><span>Projects</span><h4>${projs.length}</h4></div>
      <div class="ps"><span>Total Billing</span><h4>${fmtMoney(totalBill)}</h4></div>
      <div class="ps"><span>Total Paid</span><h4>${fmtMoney(totalPaid)}</h4></div>
      <div class="ps"><span>Pending</span><h4>${fmtMoney(pending)}</h4></div>
    </div>
    <div class="profile-section">
      <h4>Projects (${projs.length})</h4>
      ${projs.length ? `<table class="table"><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Status</th></tr></thead>
        <tbody>${projs.map(p=>`<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.type)}</td><td>${fmtMoney(p.value)}</td><td>${statusBadge(p.status)}</td></tr>`).join('')}</tbody></table>`
        : `<p class="muted">No projects</p>`}
    </div>
    <div class="profile-section">
      <h4>Invoices (${invs.length})</h4>
      ${invs.length ? `<table class="table"><thead><tr><th>#</th><th>Date</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead>
        <tbody>${invs.map(i=>`<tr><td>${i.number}</td><td>${fmtDate(i.date)}</td><td>${fmtMoney(i.total)}</td><td>${fmtMoney(i.balance)}</td><td>${statusBadge(i.status)}</td></tr>`).join('')}</tbody></table>`
        : `<p class="muted">No invoices</p>`}
    </div>
    <div class="profile-section">
      <h4>Quotations (${quotes.length})</h4>
      ${quotes.length ? `<table class="table"><thead><tr><th>#</th><th>Date</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${quotes.map(q=>`<tr><td>${q.number}</td><td>${fmtDate(q.date)}</td><td>${fmtMoney(q.total)}</td><td>${statusBadge(q.status)}</td></tr>`).join('')}</tbody></table>`
        : `<p class="muted">No quotations</p>`}
    </div>
    <div class="profile-section">
      <h4>Payment History (${pays.length})</h4>
      ${pays.length ? `<table class="table"><thead><tr><th>Date</th><th>Invoice</th><th>Amount</th><th>Mode</th></tr></thead>
        <tbody>${pays.map(p=>{const inv=invs.find(i=>i.id===p.invoice_id);return `<tr><td>${fmtDate(p.date)}</td><td>${inv?inv.number:'-'}</td><td>${fmtMoney(p.amount)}</td><td>${escapeHtml(p.mode)}</td></tr>`}).join('')}</tbody></table>`
        : `<p class="muted">No payments</p>`}
    </div>
  `;
  openModal('customerProfileModal');
}

function statusBadge(s) {
  const map = {
    'Pending':'gray','Inquiry':'gray','Quotation Sent':'blue','Booked':'purple','In Progress':'orange',
    'Editing':'orange','Album Designing':'orange','Ready':'blue','Delivered':'green',
    'Completed':'green','Cancelled':'red',
    'Paid':'green','Partial':'orange','Unpaid':'red',
    'Draft':'gray','Sent':'blue','Accepted':'green','Rejected':'red'
  };
  return `<span class="badge ${map[s]||'gray'}">${escapeHtml(s||'—')}</span>`;
}

/* ===================== Projects ===================== */
function openProjectModal(id) {
  $('proj_id').value = id || '';
  $('projectModalTitle').textContent = id ? 'Edit Project' : 'New Project';
  // populate customer dropdown
  const sel = $('proj_customer');
  sel.innerHTML = `<option value="">-- Select Customer --</option>` +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.mobile)})</option>`).join('');
  // populate project types and statuses (custom-aware)
  const typeSel = $('proj_type');
  const types = (settings.project_types && settings.project_types.length) ? settings.project_types : DEFAULT_PROJECT_TYPES;
  typeSel.innerHTML = types.map(t=>`<option>${escapeHtml(t)}</option>`).join('');
  const statSel = $('proj_status');
  statSel.innerHTML = DEFAULT_PROJECT_STATUSES.map(s=>`<option>${escapeHtml(s)}</option>`).join('');

  if (id) {
    const p = projects.find(x=>x.id===id);
    if (!p) return;
    $('proj_name').value = p.name;
    $('proj_customer').value = p.customer_id;
    // If saved type isn't in current list, add it
    if (p.type && !types.includes(p.type)) {
      typeSel.insertAdjacentHTML('beforeend', `<option>${escapeHtml(p.type)}</option>`);
    }
    $('proj_type').value = p.type;
    $('proj_status').value = p.status;
    $('proj_booking').value = p.booking || '';
    $('proj_event').value = p.event || '';
    $('proj_delivery').value = p.delivery || '';
    $('proj_value').value = p.value || 0;
    $('proj_advance').value = p.advance || 0;
    $('proj_notes').value = p.notes || '';
  } else {
    $('proj_name').value=''; $('proj_booking').value=today();
    $('proj_event').value=''; $('proj_delivery').value='';
    $('proj_value').value=0; $('proj_advance').value=0; $('proj_notes').value='';
    $('proj_type').value = types[0] || 'Custom Project';
    $('proj_status').value = 'Pending';
  }
  openModal('projectModal');
}

async function saveProject() {
  const name = $('proj_name').value.trim();
  const cid = parseInt($('proj_customer').value);
  if (!name || !cid) return toast('Project name & customer required','error');
  const data = {
    name, customer_id: cid,
    type: $('proj_type').value, status: $('proj_status').value,
    booking: $('proj_booking').value, event: $('proj_event').value,
    delivery: $('proj_delivery').value,
    value: parseFloat($('proj_value').value)||0,
    advance: parseFloat($('proj_advance').value)||0,
    notes: $('proj_notes').value.trim(),
    created: Date.now()
  };
  data.pending = data.value - data.advance;
  const id = $('proj_id').value;
  if (id) { data.id = Number(id); await dbPut('projects', data); }
  else { await dbAdd('projects', data); }
  await logActivity(`Project ${id?'updated':'created'}: ${name}`, '📁');
  await loadAll(); renderProjects(); renderDashboard();
  closeModal('projectModal'); toast('Project saved','success');
}

async function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  await dbDelete('projects', id);
  await loadAll(); renderProjects(); renderDashboard();
  toast('Project deleted','success');
}

function renderProjects() {
  populateProjectStatusFilter();
  const q = ($('projectSearch')?.value || '').toLowerCase();
  const sf = $('projectStatusFilter')?.value || '';
  let list = projects.filter(p => {
    const c = customers.find(x=>x.id===p.customer_id);
    const hay = (p.name+' '+p.type+' '+(c?c.name:'')+' '+(c?c.mobile:'')).toLowerCase();
    return (!q || hay.includes(q)) && (!sf || p.status===sf);
  }).sort((a,b)=>b.created-a.created);

  const body = $('projectTable');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:30px;">No projects found</td></tr>`;
    return;
  }
  body.innerHTML = list.map((p,i)=>{
    const c = customers.find(x=>x.id===p.customer_id);
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${c?escapeHtml(c.name):'-'}</td>
      <td>${escapeHtml(p.type||'-')}</td>
      <td>${fmtDate(p.event)}</td>
      <td>${fmtMoney(p.value)}</td>
      <td>${fmtMoney(p.pending||0)}</td>
      <td>${statusBadge(p.status)}</td>
      <td class="actions">
        <button class="act-btn" onclick="openProjectModal(${p.id})">Edit</button>
        <button class="act-btn danger" onclick="deleteProject(${p.id})">Del</button>
      </td>
    </tr>`;
  }).join('');
}
$('projectSearch')?.addEventListener('input', renderProjects);
$('projectStatusFilter')?.addEventListener('change', renderProjects);

/* ===================== Item Rows (shared by Quote & Invoice) ===================== */
function addItemRow(bodyId, item={desc:'', qty:1, rate:0}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" placeholder="✏️ Enter service / item description (e.g., Wedding Photography Package)" value="${escapeHtml(item.desc||'')}" oninput="recalc('${bodyId}')"/></td>
    <td><input type="number" placeholder="Qty" value="${item.qty||1}" oninput="recalc('${bodyId}')" style="width:70px"/></td>
    <td><input type="number" placeholder="Rate" value="${item.rate||0}" oninput="recalc('${bodyId}')" style="width:100px"/></td>
    <td class="amt">0.00</td>
    <td><button class="rm-row" onclick="this.closest('tr').remove();recalc('${bodyId}')" title="Remove">×</button></td>`;
  $(bodyId).appendChild(tr);
  recalc(bodyId);
}
function getItems(bodyId) {
  return Array.from($(bodyId).querySelectorAll('tr')).map(tr => {
    const i = tr.querySelectorAll('input');
    return { desc: i[0].value, qty: parseFloat(i[1].value)||0, rate: parseFloat(i[2].value)||0 };
  });
}
function recalc(bodyId) {
  let sub = 0;
  $(bodyId).querySelectorAll('tr').forEach(tr => {
    const i = tr.querySelectorAll('input');
    const amt = (parseFloat(i[1].value)||0) * (parseFloat(i[2].value)||0);
    tr.querySelector('.amt').textContent = amt.toFixed(2);
    sub += amt;
  });
  if (bodyId==='quoteItems') calcQuote(sub);
  else calcInvoice(sub);
}
function calcQuote(sub) {
  if (sub===undefined) { sub = getItems('quoteItems').reduce((s,i)=>s+i.qty*i.rate,0); }
  const disc = parseFloat($('quote_discount').value)||0;
  const tax = parseFloat($('quote_tax').value)||0;
  const afterDisc = sub - (sub*disc/100);
  const total = afterDisc + (afterDisc*tax/100);
  $('quote_subtotal').value = sub.toFixed(2);
  $('quote_total').value = total.toFixed(2);
}
function calcInvoice(sub) {
  if (sub===undefined) { sub = getItems('invItems').reduce((s,i)=>s+i.qty*i.rate,0); }
  const disc = parseFloat($('inv_discount').value)||0;
  const tax = parseFloat($('inv_tax').value)||0;
  const adv = parseFloat($('inv_advance').value)||0;
  const afterDisc = sub - (sub*disc/100);
  const total = afterDisc + (afterDisc*tax/100);
  $('inv_subtotal').value = sub.toFixed(2);
  $('inv_total').value = total.toFixed(2);
  $('inv_balance').value = (total - adv).toFixed(2);
}

// Render auto-item chips inside invoice/quote modal
function renderAutoItemChips(targetBodyId, chipsContainerId) {
  const box = $(chipsContainerId);
  if (!box) return;
  const items = settings.auto_items || [];
  if (!items.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<span style="font-size:11px;color:var(--muted);font-weight:600;align-self:center;">⚡ Quick Add:</span>` +
    items.map((it,i)=>{
      const label = it.rate > 0
        ? `${escapeHtml(it.desc)} · ₹${it.rate}`
        : `${escapeHtml(it.desc)}`;
      return `<span class="chip" onclick="insertAutoItem('${targetBodyId}',${i})">+ ${label}</span>`;
    }).join('');
}
function insertAutoItem(bodyId, idx) {
  const it = (settings.auto_items||[])[idx];
  if (!it) return;
  // If the body has only one empty row, replace its values; otherwise append a new row
  const rows = $(bodyId).querySelectorAll('tr');
  if (rows.length === 1) {
    const inputs = rows[0].querySelectorAll('input');
    if (!inputs[0].value) {
      inputs[0].value = it.desc;
      inputs[1].value = 1;
      inputs[2].value = it.rate || 0;
      recalc(bodyId);
      return;
    }
  }
  addItemRow(bodyId, { desc: it.desc, qty: 1, rate: it.rate || 0 });
}

/* ===================== Quotations ===================== */
/* Sequential, short, predictable document numbers.
   Format: <PREFIX>-<N>   e.g. INV-1, INV-2, RC-1, QT-7
   - No 4-digit zero padding (looked too big in tables / PDFs)
   - No year segment in the number itself; year is already on the
     printed document via the date field.
   - Picks max(existing serial) + 1 so it stays strictly serial-wise
     even after deletions.                                            */
function nextNumber(prefix, store) {
  const list = (store==='invoices'?invoices: store==='quotations'?quotations: receipts);
  // Extract trailing numeric serial from existing doc numbers, regardless of any old format
  const max = list.reduce((m,x)=>{
    const s = (x.number||'').toString();
    // Take the LAST contiguous run of digits as the serial
    const match = s.match(/(\d+)(?!.*\d)/);
    const n = match ? parseInt(match[1], 10) : 0;
    return n>m?n:m;
  },0);
  return `${prefix}-${max+1}`;
}

function openQuotationModal(id) {
  $('quote_id').value = id || '';
  $('quotationModalTitle').textContent = id ? 'Edit Quotation' : 'New Quotation';
  $('quote_customer').innerHTML = `<option value="">-- Guest / No Customer --</option>` +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('quoteItems').innerHTML = '';
  $('quote_guest_name').value = '';
  if (id) {
    const q = quotations.find(x=>x.id===id);
    if (!q) return;
    $('quote_customer').value = q.customer_id || '';
    $('quote_guest_name').value = q.guest_name || '';
    $('quote_date').value = q.date;
    $('quote_valid').value = q.valid || '';
    $('quote_status').value = q.status;
    $('quote_discount').value = q.discount||0;
    $('quote_tax').value = q.tax||0;
    $('quote_notes').value = q.notes||'';
    (q.items||[]).forEach(it=>addItemRow('quoteItems',it));
  } else {
    $('quote_date').value = today();
    $('quote_discount').value=0; $('quote_tax').value=settings.tax||0;
    $('quote_notes').value=''; $('quote_status').value='Draft';
    addItemRow('quoteItems');
  }
  renderAutoItemChips('quoteItems', 'quoteAutoItems');
  calcQuote();
  openModal('quotationModal');
}

async function saveQuotation() {
  const cid = parseInt($('quote_customer').value) || null;
  const guestName = $('quote_guest_name').value.trim();
  // Quotation can be saved without customer (guest mode), as long as guest name exists OR cid exists
  if (!cid && !guestName) {
    return toast('Please pick a customer OR enter a Guest Name','error');
  }
  const items = getItems('quoteItems').filter(i=>i.desc||i.qty||i.rate);
  if (!items.length) return toast('Add at least one item','error');
  const sub = items.reduce((s,i)=>s+i.qty*i.rate,0);
  const disc = parseFloat($('quote_discount').value)||0;
  const tax = parseFloat($('quote_tax').value)||0;
  const afterDisc = sub - (sub*disc/100);
  const total = afterDisc + (afterDisc*tax/100);
  const id = $('quote_id').value;
  const data = {
    number: id ? quotations.find(q=>q.id===Number(id)).number : nextNumber(settings.quote_prefix||'QT','quotations'),
    customer_id: cid, guest_name: cid ? '' : guestName,
    date: $('quote_date').value,
    valid: $('quote_valid').value, status: $('quote_status').value,
    items, subtotal: sub, discount: disc, tax, total,
    notes: $('quote_notes').value.trim(), created: Date.now()
  };
  if (id) { data.id = Number(id); await dbPut('quotations', data); }
  else { await dbAdd('quotations', data); }
  await logActivity(`Quotation ${data.number} saved`, '📝');
  await loadAll(); renderQuotations();
  closeModal('quotationModal'); toast('Quotation saved','success');
}

async function deleteQuotation(id) {
  if (!confirm('Delete this quotation?')) return;
  await dbDelete('quotations', id);
  await loadAll(); renderQuotations(); toast('Deleted','success');
}

function renderQuotations() {
  const body = $('quotationTable');
  const list = [...quotations].sort((a,b)=>b.created-a.created);
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:30px;">No quotations yet</td></tr>`;
    return;
  }
  body.innerHTML = list.map(q=>{
    const c = customers.find(x=>x.id===q.customer_id);
    const who = c ? c.name : (q.guest_name ? q.guest_name + ' (Guest)' : '— Guest —');
    return `<tr>
      <td><strong>${q.number}</strong></td>
      <td>${fmtDate(q.date)}</td>
      <td>${escapeHtml(who)}</td>
      <td>${fmtMoney(q.total)}</td>
      <td>${statusBadge(q.status)}</td>
      <td class="actions">
        <button class="act-btn" onclick="previewQuotation(${q.id})">View</button>
        <button class="act-btn" onclick="openQuotationModal(${q.id})">Edit</button>
        <button class="act-btn danger" onclick="deleteQuotation(${q.id})">Del</button>
      </td>
    </tr>`;
  }).join('');
}

/* ===================== Invoices ===================== */
function openInvoiceModal(id) {
  $('inv_id').value = id || '';
  $('invoiceModalTitle').textContent = id ? 'Edit Invoice' : 'New Invoice';
  $('inv_customer').innerHTML = `<option value="">-- Select Customer --</option>` +
    customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('inv_project').innerHTML = `<option value="">— Without Project —</option>`;
  $('invItems').innerHTML = '';

  // reset recurring fields
  if ($('inv_recurring')) $('inv_recurring').checked = false;
  if ($('inv_recurring_next')) $('inv_recurring_next').value = '';
  if ($('inv_recurring_active')) $('inv_recurring_active').value = '1';
  if ($('inv_recurring_fields')) $('inv_recurring_fields').style.display = 'none';

  if (id) {
    const inv = invoices.find(x=>x.id===id);
    if (!inv) return;
    $('inv_customer').value = inv.customer_id;
    loadProjectsForCustomer(inv.project_id);
    $('inv_date').value = inv.date;
    $('inv_due').value = inv.due || '';
    $('inv_discount').value = inv.discount||0;
    $('inv_tax').value = inv.tax||0;
    $('inv_advance').value = inv.advance||0;
    $('inv_notes').value = inv.notes||'';
    (inv.items||[]).forEach(it=>addItemRow('invItems',it));
    // Restore recurring state
    if (inv.recurring) {
      if ($('inv_recurring')) $('inv_recurring').checked = true;
      if ($('inv_recurring_next')) $('inv_recurring_next').value = inv.recurring_next || nextMonthDateStr(inv.date);
      if ($('inv_recurring_active')) $('inv_recurring_active').value = (inv.recurring_active === 0) ? '0' : '1';
      if ($('inv_recurring_fields')) $('inv_recurring_fields').style.display = '';
    }
  } else {
    $('inv_date').value = today();
    const d = new Date(); d.setDate(d.getDate()+15);
    $('inv_due').value = d.toISOString().slice(0,10);
    $('inv_discount').value=0; $('inv_tax').value=settings.tax||0;
    $('inv_advance').value=0; $('inv_notes').value='';
    // Start with ONE blank row only — distractions from settings are removed.
    // Users can use "Quick Add" chips at the top for items they want.
    addItemRow('invItems');
  }
  renderAutoItemChips('invItems', 'invAutoItems');
  calcInvoice();
  openModal('invoiceModal');
}

function toggleRecurringFields() {
  const box = $('inv_recurring_fields');
  if (!box) return;
  const on = $('inv_recurring').checked;
  box.style.display = on ? '' : 'none';
  if (on && !$('inv_recurring_next').value) {
    const base = $('inv_date').value || today();
    $('inv_recurring_next').value = nextMonthDateStr(base);
  }
}

function nextMonthDateStr(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) return today();
  const day = d.getDate();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  // Use original day, clamp to last day of next month
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next.toISOString().slice(0,10);
}

function loadProjectsForCustomer(selectedProjectId) {
  const cid = parseInt($('inv_customer').value);
  const sel = $('inv_project');
  const list = projects.filter(p => p.customer_id === cid);
  sel.innerHTML = `<option value="">— Without Project —</option>` +
    list.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.type)})</option>`).join('');
  if (selectedProjectId) sel.value = selectedProjectId;
  // auto-fill items if project selected and no items yet
  sel.onchange = () => {
    const pid = parseInt(sel.value);
    if (!pid) return;
    const p = projects.find(x=>x.id===pid);
    if (!p) return;
    if (!$('invItems').children.length || (
      $('invItems').children.length===1 &&
      !$('invItems').querySelector('input').value
    )) {
      $('invItems').innerHTML = '';
      addItemRow('invItems', { desc: `${p.type} - ${p.name}`, qty:1, rate:p.value||0 });
      if (p.advance) $('inv_advance').value = p.advance;
      calcInvoice();
    }
  };
}

async function saveInvoice() {
  const cid = parseInt($('inv_customer').value);
  if (!cid) return toast('Customer required','error');
  const items = getItems('invItems').filter(i=>i.desc||i.qty||i.rate);
  if (!items.length) return toast('Add at least one item','error');
  const sub = items.reduce((s,i)=>s+i.qty*i.rate,0);
  const disc = parseFloat($('inv_discount').value)||0;
  const tax = parseFloat($('inv_tax').value)||0;
  const adv = parseFloat($('inv_advance').value)||0;
  const afterDisc = sub - (sub*disc/100);
  const total = afterDisc + (afterDisc*tax/100);
  const balance = total - adv;
  let status = 'Unpaid';
  if (balance <= 0.001) status = 'Paid';
  else if (adv > 0) status = 'Partial';

  const id = $('inv_id').value;
  const isRecurring = $('inv_recurring') ? $('inv_recurring').checked : false;
  const recurringNext = ($('inv_recurring_next') && $('inv_recurring_next').value)
    ? $('inv_recurring_next').value
    : nextMonthDateStr($('inv_date').value);
  const recurringActive = ($('inv_recurring_active') && $('inv_recurring_active').value === '0') ? 0 : 1;

  const data = {
    number: id ? invoices.find(i=>i.id===Number(id)).number : nextNumber(settings.inv_prefix||'INV','invoices'),
    customer_id: cid,
    project_id: parseInt($('inv_project').value) || null,
    date: $('inv_date').value, due: $('inv_due').value,
    items, subtotal: sub, discount: disc, tax,
    total, advance: adv, balance, status,
    notes: $('inv_notes').value.trim(),
    recurring: isRecurring ? 1 : 0,
    recurring_next: isRecurring ? recurringNext : '',
    recurring_active: isRecurring ? recurringActive : 0,
    recurring_last: id ? (invoices.find(i=>i.id===Number(id))||{}).recurring_last || '' : '',
    created: Date.now()
  };
  let invId;
  if (id) { data.id = Number(id); await dbPut('invoices', data); invId=data.id; }
  else { invId = await dbAdd('invoices', data); }

  // If advance > 0 and new invoice, record advance as payment + receipt
  if (!id && adv > 0) {
    const payId = await dbAdd('payments', {
      invoice_id: invId, customer_id: cid,
      date: data.date, amount: adv, mode:'Cash', notes:'Advance payment',
      created: Date.now()
    });
    await dbAdd('receipts', {
      number: nextNumber(settings.rec_prefix||'RC','receipts'),
      payment_id: payId, invoice_id: invId, customer_id: cid,
      date: data.date, amount: adv, mode: 'Cash', created: Date.now()
    });
  }

  await logActivity(`Invoice ${data.number} saved · ${fmtMoney(total)}`, '🧾');
  await loadAll(); renderInvoices(); renderDashboard(); renderReceipts(); renderPayments();
  closeModal('invoiceModal'); toast('Invoice saved','success');
}

async function deleteInvoice(id) {
  if (!confirm('Delete this invoice? Related payments will remain.')) return;
  await dbDelete('invoices', id);
  await loadAll(); renderInvoices(); renderDashboard();
  toast('Invoice deleted','success');
}

function renderInvoices() {
  const q = ($('invoiceSearch')?.value||'').toLowerCase();
  const sf = $('invoiceStatusFilter')?.value||'';
  let list = invoices.filter(inv => {
    const c = customers.find(x=>x.id===inv.customer_id);
    const hay = (inv.number+' '+(c?c.name:'')+' '+(c?c.mobile:'')).toLowerCase();
    return (!q||hay.includes(q)) && (!sf||inv.status===sf);
  }).sort((a,b)=>b.created-a.created);
  const body = $('invoiceTable');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:30px;">No invoices found</td></tr>`;
    return;
  }
  body.innerHTML = list.map(inv => {
    const c = customers.find(x=>x.id===inv.customer_id);
    const p = projects.find(x=>x.id===inv.project_id);
    const paid = inv.total - inv.balance;
    const showPay = inv.balance > 0.001;
    return `<tr>
      <td><strong>${inv.number}</strong></td>
      <td>${fmtDate(inv.date)}</td>
      <td>${c?escapeHtml(c.name):'-'}</td>
      <td>${p?escapeHtml(p.name):'<span style="color:var(--muted);font-style:italic">—</span>'}</td>
      <td>${fmtMoney(inv.total)}</td>
      <td>${fmtMoney(paid)}</td>
      <td>${fmtMoney(inv.balance)}</td>
      <td>${statusBadge(inv.status)}</td>
      <td class="actions">
        <button class="act-btn" onclick="previewInvoice(${inv.id})">View</button>
        <button class="act-btn wa" onclick="sendInvoiceWhatsApp(${inv.id})" title="Send via WhatsApp (PDF auto-downloads)"><span class="ic-wa-svg"></span></button>
        <button class="act-btn email" onclick="emailInvoice(${inv.id})" title="Send via Gmail (PDF auto-downloads)"><span class="ic-gmail-svg"></span></button>
        <button class="act-btn" onclick="openInvoiceModal(${inv.id})">Edit</button>
        <button class="act-btn danger" onclick="deleteInvoice(${inv.id})">Del</button>
        ${showPay ? `<button class="act-btn pay" onclick="openPaymentModal(${inv.id})">💰 Add Payment</button>` : ''}
        ${inv.recurring ? `<span class="act-btn recurring-badge" title="Recurring Monthly">🔄</span>` : ''}
      </td>
    </tr>`;
  }).join('');
}
$('invoiceSearch')?.addEventListener('input', renderInvoices);
$('invoiceStatusFilter')?.addEventListener('change', renderInvoices);

/* ===================== Payments ===================== */
function openPaymentModal(invId) {
  $('pay_id').value = '';
  // Show only invoices that still have balance (or all if none has balance)
  const withBalance = invoices.filter(i => (i.balance||0) > 0.001);
  const optionsList = withBalance.length ? withBalance : invoices;
  $('pay_invoice').innerHTML = optionsList.map(inv => {
    const c = customers.find(x=>x.id===inv.customer_id);
    return `<option value="${inv.id}">${inv.number} · ${c?escapeHtml(c.name):'—'} · Bal ${fmtMoney(inv.balance)}</option>`;
  }).join('') || `<option value="">No invoices</option>`;
  if (invId) $('pay_invoice').value = invId;
  $('pay_date').value = today();
  $('pay_amount').value = '';
  $('pay_mode').value = 'Cash';
  $('pay_notes').value = '';
  updatePayInvoiceInfo();
  openModal('paymentModal');
}

function updatePayInvoiceInfo() {
  const id = parseInt($('pay_invoice').value);
  const box = $('pay_invoice_info');
  if (!box) return;
  if (!id) { box.innerHTML = ''; return; }
  const inv = invoices.find(x=>x.id===id);
  if (!inv) { box.innerHTML = ''; return; }
  const c = customers.find(x=>x.id===inv.customer_id);
  const paid = inv.total - inv.balance;
  box.innerHTML = `
    <div class="row"><span>Customer</span><span>${c?escapeHtml(c.name):'—'}</span></div>
    <div class="row"><span>Invoice Total</span><span>${fmtMoney(inv.total)}</span></div>
    <div class="row"><span>Paid So Far</span><span>${fmtMoney(paid)}</span></div>
    <div class="row bal"><span>Balance Due</span><span>${fmtMoney(inv.balance)}</span></div>
  `;
  // Pre-fill amount with balance
  if (!$('pay_amount').value) $('pay_amount').value = inv.balance.toFixed(2);
}

async function savePayment() {
  const invId = parseInt($('pay_invoice').value);
  const amt = parseFloat($('pay_amount').value);
  if (!invId || !amt || amt<=0) return toast('Invoice & amount required','error');
  const inv = invoices.find(x=>x.id===invId);
  if (!inv) return toast('Invoice not found','error');
  const data = {
    invoice_id: invId, customer_id: inv.customer_id,
    date: $('pay_date').value, amount: amt,
    mode: $('pay_mode').value, notes: $('pay_notes').value.trim(),
    created: Date.now()
  };
  const payId = await dbAdd('payments', data);

  // update invoice balance/status
  inv.balance = Math.max(0, inv.balance - amt);
  inv.advance = (inv.advance||0) + amt;
  if (inv.balance <= 0.001) inv.status = 'Paid';
  else inv.status = 'Partial';
  await dbPut('invoices', inv);

  // auto-create receipt
  const recData = {
    number: nextNumber(settings.rec_prefix||'RC','receipts'),
    payment_id: payId, invoice_id: invId, customer_id: inv.customer_id,
    date: data.date, amount: amt, mode: data.mode, notes: data.notes, created: Date.now()
  };
  const recId = await dbAdd('receipts', recData);

  await logActivity(`Payment received ${fmtMoney(amt)} for ${inv.number}`, '💰');
  await loadAll(); renderPayments(); renderInvoices(); renderReceipts(); renderDashboard();
  closeModal('paymentModal');
  toast('Payment saved · Opening receipt...','success');
  // Auto-open the freshly generated receipt so user can save/print it as same file
  setTimeout(() => previewReceipt(recId), 350);
}

async function deletePayment(id) {
  if (!confirm('Delete this payment? Invoice balance will be restored.')) return;
  const pay = payments.find(p=>p.id===id);
  if (pay) {
    const inv = invoices.find(x=>x.id===pay.invoice_id);
    if (inv) {
      inv.balance = (inv.balance||0) + pay.amount;
      inv.advance = Math.max(0, (inv.advance||0) - pay.amount);
      if (inv.balance >= inv.total - 0.001) inv.status = 'Unpaid';
      else if (inv.advance>0) inv.status = 'Partial';
      await dbPut('invoices', inv);
    }
    const r = receipts.find(rc=>rc.payment_id===id);
    if (r) await dbDelete('receipts', r.id);
  }
  await dbDelete('payments', id);
  await loadAll(); renderPayments(); renderInvoices(); renderReceipts(); renderDashboard();
  toast('Payment deleted','success');
}

function renderPayments() {
  const body = $('paymentTable');
  const list = [...payments].sort((a,b)=>b.created-a.created);
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:30px;">No payments yet</td></tr>`;
    return;
  }
  body.innerHTML = list.map(p=>{
    const inv = invoices.find(x=>x.id===p.invoice_id);
    const c = customers.find(x=>x.id===p.customer_id);
    return `<tr>
      <td>${fmtDate(p.date)}</td>
      <td>${c?escapeHtml(c.name):'-'}</td>
      <td>${inv?inv.number:'-'}</td>
      <td><strong>${fmtMoney(p.amount)}</strong></td>
      <td>${escapeHtml(p.mode)}</td>
      <td>${escapeHtml(p.notes||'-')}</td>
      <td class="actions">
        <button class="act-btn danger" onclick="deletePayment(${p.id})">Del</button>
      </td>
    </tr>`;
  }).join('');
}

/* ===================== Receipts ===================== */
function renderReceipts() {
  const body = $('receiptTable');
  const list = [...receipts].sort((a,b)=>b.created-a.created);
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:30px;">No receipts yet — recorded when payments are saved</td></tr>`;
    return;
  }
  body.innerHTML = list.map(r=>{
    const inv = invoices.find(x=>x.id===r.invoice_id);
    const c = customers.find(x=>x.id===r.customer_id);
    return `<tr>
      <td><strong>${r.number}</strong></td>
      <td>${fmtDate(r.date)}</td>
      <td>${c?escapeHtml(c.name):'-'}</td>
      <td>${inv?inv.number:'-'}</td>
      <td>${fmtMoney(r.amount)}</td>
      <td>${escapeHtml(r.mode)}</td>
      <td class="actions">
        <button class="act-btn" onclick="previewReceipt(${r.id})">View</button>
        <button class="act-btn wa" onclick="sendReceiptWhatsApp(${r.id})" title="Send via WhatsApp (PDF auto-downloads)"><span class="ic-wa-svg"></span></button>
        <button class="act-btn email" onclick="emailReceipt(${r.id})" title="Send via Gmail (PDF auto-downloads)"><span class="ic-gmail-svg"></span></button>
      </td>
    </tr>`;
  }).join('');
}

/* ===================== Expenses ===================== */
function openExpenseModal(id) {
  $('exp_id').value = id || '';
  if (id) {
    const e = expenses.find(x=>x.id===id); if (!e) return;
    $('exp_date').value=e.date; $('exp_category').value=e.category;
    $('exp_amount').value=e.amount; $('exp_desc').value=e.description||'';
  } else {
    $('exp_date').value=today(); $('exp_amount').value=''; $('exp_desc').value='';
    $('exp_category').value='Travel';
  }
  openModal('expenseModal');
}
async function saveExpense() {
  const amt = parseFloat($('exp_amount').value);
  if (!amt || amt<=0) return toast('Amount required','error');
  const data = {
    date: $('exp_date').value, category: $('exp_category').value,
    amount: amt, description: $('exp_desc').value.trim(), created: Date.now()
  };
  const id = $('exp_id').value;
  if (id) { data.id=Number(id); await dbPut('expenses', data); }
  else { await dbAdd('expenses', data); }
  await logActivity(`Expense added: ${data.category} ${fmtMoney(amt)}`, '💼');
  await loadAll(); renderExpenses(); renderDashboard();
  closeModal('expenseModal'); toast('Expense saved','success');
}
async function deleteExpense(id) {
  if (!confirm('Delete expense?')) return;
  await dbDelete('expenses', id);
  await loadAll(); renderExpenses(); renderDashboard();
  toast('Deleted','success');
}
function renderExpenses() {
  const revenue = invoices.reduce((s,i)=>s+((i.total||0)-(i.balance||0)),0);
  const totalEx = expenses.reduce((s,e)=>s+(e.amount||0),0);
  $('exRevenue').textContent = fmtMoney(revenue);
  $('exTotal').textContent = fmtMoney(totalEx);
  $('exProfit').textContent = fmtMoney(revenue-totalEx);
  const body = $('expenseTable');
  const list = [...expenses].sort((a,b)=>b.created-a.created);
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:30px;">No expenses yet</td></tr>`;
    return;
  }
  body.innerHTML = list.map(e=>`<tr>
    <td>${fmtDate(e.date)}</td>
    <td><span class="badge purple">${escapeHtml(e.category)}</span></td>
    <td>${escapeHtml(e.description||'-')}</td>
    <td>${fmtMoney(e.amount)}</td>
    <td class="actions">
      <button class="act-btn" onclick="openExpenseModal(${e.id})">Edit</button>
      <button class="act-btn danger" onclick="deleteExpense(${e.id})">Del</button>
    </td>
  </tr>`).join('');
}

/* ===================== Dashboard ===================== */
function renderDashboard() {
  $('stTotalCustomers').textContent = customers.length;
  $('stTotalProjects').textContent = projects.length;
  const active = projects.filter(p=>!['Completed','Cancelled','Delivered'].includes(p.status)).length;
  const done = projects.filter(p=>['Completed','Delivered'].includes(p.status)).length;
  $('stActiveProjects').textContent = active;
  $('stCompletedProjects').textContent = done;
  const pending = invoices.reduce((s,i)=>s+(i.balance||0), 0);
  $('stPendingPayments').textContent = fmtMoney(pending);
  const revenue = invoices.reduce((s,i)=>s+((i.total||0)-(i.balance||0)),0);
  $('stTotalRevenue').textContent = fmtMoney(revenue);
  const now = new Date();
  const monthRev = payments.filter(p => {
    const d = new Date(p.date);
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  }).reduce((s,p)=>s+p.amount, 0);
  $('stMonthlyRevenue').textContent = fmtMoney(monthRev);

  const upcoming = projects.filter(p => {
    if (!p.delivery) return false;
    const d = new Date(p.delivery);
    const diff = (d - now) / 86400000;
    return diff >= 0 && diff <= 30 && !['Completed','Cancelled','Delivered'].includes(p.status);
  }).sort((a,b)=>new Date(a.delivery)-new Date(b.delivery));
  $('stUpcomingDeliveries').textContent = upcoming.length;

  if (upcoming.length) {
    $('upcomingList').innerHTML = upcoming.slice(0,8).map(p=>{
      const c = customers.find(x=>x.id===p.customer_id);
      return `<div class="upcoming-item">
        <div class="act-ico">📅</div>
        <div class="act-text">
          <strong>${escapeHtml(p.name)}</strong> — ${c?escapeHtml(c.name):''}
          <small>${escapeHtml(p.type||'')} · Delivery: ${fmtDate(p.delivery)} · ${statusBadge(p.status)}</small>
        </div>
      </div>`;
    }).join('');
  } else {
    $('upcomingList').innerHTML = `<p class="empty">No upcoming deliveries</p>`;
  }

  if (activities.length) {
    $('activityList').innerHTML = activities.slice(0,8).map(a=>`
      <div class="activity-item">
        <div class="act-ico">${a.icon}</div>
        <div class="act-text"><strong>${escapeHtml(a.text)}</strong>
        <small>${new Date(a.time).toLocaleString()}</small></div>
      </div>`).join('');
  } else {
    $('activityList').innerHTML = `<p class="empty">No recent activity</p>`;
  }

  const totalEx = expenses.reduce((s,e)=>s+(e.amount||0),0);
  $('plRevenue').textContent = fmtMoney(revenue);
  $('plExpense').textContent = fmtMoney(totalEx);
  $('plProfit').textContent = fmtMoney(revenue-totalEx);
}

/* ===================== Global Search ===================== */
$('globalSearch').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const box = $('searchResults');
  if (!q) { box.classList.remove('active'); box.innerHTML=''; return; }
  const results = [];
  customers.forEach(c => {
    if ((c.name+c.mobile+(c.email||'')+(c.city||'')).toLowerCase().includes(q))
      results.push({type:'Customer', label:c.name, sub:`${c.mobile} · ${c.city||''}`, action:`viewCustomer(${c.id})`});
  });
  projects.forEach(p => {
    if ((p.name+(p.type||'')).toLowerCase().includes(q)) {
      const c = customers.find(x=>x.id===p.customer_id);
      results.push({type:'Project', label:p.name, sub:`${p.type||''} · ${c?c.name:''}`, action:`openProjectModal(${p.id})`});
    }
  });
  invoices.forEach(i => {
    if ((i.number+'').toLowerCase().includes(q)) {
      const c = customers.find(x=>x.id===i.customer_id);
      results.push({type:'Invoice', label:i.number, sub:`${c?c.name:''} · ${fmtMoney(i.total)}`, action:`previewInvoice(${i.id})`});
    }
  });
  quotations.forEach(q2 => {
    if ((q2.number+'').toLowerCase().includes(q)) {
      const c = customers.find(x=>x.id===q2.customer_id);
      const who = c ? c.name : (q2.guest_name || 'Guest');
      results.push({type:'Quotation', label:q2.number, sub:`${who} · ${fmtMoney(q2.total)}`, action:`previewQuotation(${q2.id})`});
    }
  });
  if (!results.length) {
    box.innerHTML = `<div class="sr-item">No matches</div>`;
  } else {
    box.innerHTML = results.slice(0,12).map(r =>
      `<div class="sr-item" onclick="${r.action};$('globalSearch').value='';$('searchResults').classList.remove('active')">
        <strong>[${r.type}]</strong> ${escapeHtml(r.label)}<small>${escapeHtml(r.sub)}</small>
      </div>`).join('');
  }
  box.classList.add('active');
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-box')) $('searchResults').classList.remove('active');
});

/* ===================== UPI QR Generator (offline canvas) ===================== */
var qrcode = function() {
  var qrcode = function(typeNumber, errorCorrectionLevel) {
    var PAD0 = 0xEC; var PAD1 = 0x11;
    var _typeNumber = typeNumber; var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null; var _moduleCount = 0; var _dataCache = null; var _dataList = [];
    var _this = {};
    var makeImpl = function(test, maskPattern) {
      _moduleCount = _typeNumber * 4 + 17;
      _modules = (function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) modules[row][col] = null;
        }
        return modules;
      })(_moduleCount);
      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);
      if (_typeNumber >= 7) setupTypeNumber(test);
      if (_dataCache == null) _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      mapData(_dataCache, maskPattern);
    };
    var setupPositionProbePattern = function(row, col) {
      for (var r = -1; r <= 7; r += 1) { if (row + r <= -1 || _moduleCount <= row + r) continue;
        for (var c = -1; c <= 7; c += 1) { if (col + c <= -1 || _moduleCount <= col + c) continue;
          _modules[row + r][col + c] = (0 <= r && r <= 6 && (c == 0 || c == 6)) || (0 <= c && c <= 6 && (r == 0 || r == 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4);
        }}
    };
    var getBestMaskPattern = function() {
      var minLostPoint = 0; var pattern = 0;
      for (var i = 0; i < 8; i += 1) { makeImpl(true, i);
        var lostPoint = QRUtil.getLostPoint(_this);
        if (i == 0 || minLostPoint > lostPoint) { minLostPoint = lostPoint; pattern = i; }
      } return pattern;
    };
    var setupTimingPattern = function() {
      for (var r = 8; r < _moduleCount - 8; r += 1) { if (_modules[r][6] != null) continue; _modules[r][6] = (r % 2 == 0); }
      for (var c = 8; c < _moduleCount - 8; c += 1) { if (_modules[6][c] != null) continue; _modules[6][c] = (c % 2 == 0); }
    };
    var setupPositionAdjustPattern = function() {
      var pos = QRUtil.getPatternPosition(_typeNumber);
      for (var i = 0; i < pos.length; i += 1) { for (var j = 0; j < pos.length; j += 1) {
        var row = pos[i]; var col = pos[j];
        if (_modules[row][col] != null) continue;
        for (var r = -2; r <= 2; r += 1) { for (var c = -2; c <= 2; c += 1) {
          _modules[row + r][col + c] = (r == -2 || r == 2 || c == -2 || c == 2 || (r == 0 && c == 0));
        }}
      }}
    };
    var setupTypeNumber = function(test) {
      var bits = QRUtil.getBCHTypeNumber(_typeNumber);
      for (var i = 0; i < 18; i += 1) { var mod = (!test && ((bits >> i) & 1) == 1); _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod; }
      for (var i = 0; i < 18; i += 1) { var mod = (!test && ((bits >> i) & 1) == 1); _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod; }
    };
    var setupTypeInfo = function(test, maskPattern) {
      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);
      for (var i = 0; i < 15; i += 1) { var mod = (!test && ((bits >> i) & 1) == 1);
        if (i < 6) _modules[i][8] = mod; else if (i < 8) _modules[i + 1][8] = mod; else _modules[_moduleCount - 15 + i][8] = mod;
      }
      for (var i = 0; i < 15; i += 1) { var mod = (!test && ((bits >> i) & 1) == 1);
        if (i < 8) _modules[8][_moduleCount - i - 1] = mod; else if (i < 9) _modules[8][15 - i - 1 + 1] = mod; else _modules[8][15 - i - 1] = mod;
      }
      _modules[_moduleCount - 8][8] = (!test);
    };
    var mapData = function(data, maskPattern) {
      var inc = -1; var row = _moduleCount - 1; var bitIndex = 7; var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);
      for (var col = _moduleCount - 1; col > 0; col -= 2) { if (col == 6) col -= 1;
        while (true) { for (var c = 0; c < 2; c += 1) { if (_modules[row][col - c] == null) {
          var dark = false;
          if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) == 1);
          var mask = maskFunc(row, col - c); if (mask) dark = !dark;
          _modules[row][col - c] = dark; bitIndex -= 1;
          if (bitIndex == -1) { byteIndex += 1; bitIndex = 7; }
        }}
        row += inc; if (row < 0 || _moduleCount <= row) { row -= inc; inc = -inc; break; }
        }
      }
    };
    var createBytes = function(buffer, rsBlocks) {
      var offset = 0; var maxDcCount = 0; var maxEcCount = 0;
      var dcdata = new Array(rsBlocks.length); var ecdata = new Array(rsBlocks.length);
      for (var r = 0; r < rsBlocks.length; r += 1) {
        var dcCount = rsBlocks[r].dataCount; var ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount); maxEcCount = Math.max(maxEcCount, ecCount);
        dcdata[r] = new Array(dcCount);
        for (var i = 0; i < dcdata[r].length; i += 1) dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        offset += dcCount;
        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
        var modPoly = rawPoly.mod(rsPoly); ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) { var modIndex = i + modPoly.getLength() - ecdata[r].length; ecdata[r][i] = (modIndex >= 0) ? modPoly.getAt(modIndex) : 0; }
      }
      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) totalCodeCount += rsBlocks[i].totalCount;
      var data = new Array(totalCodeCount); var index = 0;
      for (var i = 0; i < maxDcCount; i += 1) for (var r = 0; r < rsBlocks.length; r += 1) if (i < dcdata[r].length) { data[index] = dcdata[r][i]; index += 1; }
      for (var i = 0; i < maxEcCount; i += 1) for (var r = 0; r < rsBlocks.length; r += 1) if (i < ecdata[r].length) { data[index] = ecdata[r][i]; index += 1; }
      return data;
    };
    var createData = function(typeNumber, errorCorrectionLevel, dataList) {
      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
      var buffer = qrBitBuffer();
      for (var i = 0; i < dataList.length; i += 1) { var data = dataList[i]; buffer.put(data.getMode(), 4); buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber)); data.write(buffer); }
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) totalDataCount += rsBlocks[i].dataCount;
      if (buffer.getLengthInBits() > totalDataCount * 8) throw 'code length overflow.';
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
      while (buffer.getLengthInBits() % 8 != 0) buffer.putBit(false);
      while (true) { if (buffer.getLengthInBits() >= totalDataCount * 8) break; buffer.put(PAD0, 8);
        if (buffer.getLengthInBits() >= totalDataCount * 8) break; buffer.put(PAD1, 8); }
      return createBytes(buffer, rsBlocks);
    };
    _this.addData = function(data) { var newData = qr8BitByte(data); _dataList.push(newData); _dataCache = null; };
    _this.isDark = function(row, col) { if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) throw row + ',' + col; return _modules[row][col]; };
    _this.getModuleCount = function() { return _moduleCount; };
    _this.make = function() { if (_typeNumber < 1) {
        var typeNumber = 1;
        for (; typeNumber < 40; typeNumber++) { var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer(); for (var i = 0; i < _dataList.length; i++) { var data = _dataList[i]; buffer.put(data.getMode(), 4); buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber)); data.write(buffer); }
          var totalDataCount = 0; for (var i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
          if (buffer.getLengthInBits() <= totalDataCount * 8) break;
        }
        _typeNumber = typeNumber;
      }
      makeImpl(false, getBestMaskPattern());
    };
    _this.createDataURL = function(cellSize, margin) {
      cellSize = cellSize || 4; margin = (typeof margin == 'undefined') ? cellSize * 4 : margin;
      var size = _moduleCount * cellSize + margin * 2;
      var min = margin; var max = size - margin;
      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor((x - min) / cellSize); var r = Math.floor((y - min) / cellSize);
          return _modules[r][c] ? 0 : 1;
        } else { return 1; }
      });
    };
    return _this;
  };
  var QRMode = { MODE_NUMBER: 1 << 0, MODE_ALPHA_NUM: 1 << 1, MODE_8BIT_BYTE: 1 << 2, MODE_KANJI: 1 << 3 };
  var QRErrorCorrectionLevel = { 'L': 1, 'M': 0, 'Q': 3, 'H': 2 };
  var QRMaskPattern = { PATTERN000: 0, PATTERN001: 1, PATTERN010: 2, PATTERN011: 3, PATTERN100: 4, PATTERN101: 5, PATTERN110: 6, PATTERN111: 7 };
  var QRUtil = function() {
    var PATTERN_POSITION_TABLE = [[],[6, 18],[6, 22],[6, 26],[6, 30],[6, 34],[6, 22, 38],[6, 24, 42],[6, 26, 46],[6, 28, 50],[6, 30, 54],[6, 32, 58],[6, 34, 62],[6, 26, 46, 66],[6, 26, 48, 70],[6, 26, 50, 74],[6, 30, 54, 78],[6, 30, 56, 82],[6, 30, 58, 86],[6, 34, 62, 90],[6, 28, 50, 72, 94],[6, 26, 50, 74, 98],[6, 30, 54, 78, 102],[6, 28, 54, 80, 106],[6, 32, 58, 84, 110],[6, 30, 58, 86, 114],[6, 34, 62, 90, 118],[6, 26, 50, 74, 98, 122],[6, 30, 54, 78, 102, 126],[6, 26, 52, 78, 104, 130],[6, 30, 56, 82, 108, 134],[6, 34, 60, 86, 112, 138],[6, 30, 58, 86, 114, 142],[6, 34, 62, 90, 118, 146],[6, 30, 54, 78, 102, 126, 150],[6, 24, 50, 76, 102, 128, 154],[6, 28, 54, 80, 106, 132, 158],[6, 32, 58, 84, 110, 136, 162],[6, 26, 54, 82, 110, 138, 166],[6, 30, 58, 86, 114, 142, 170]];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
    var _this = {};
    var _getBCHDigit = function(data) { var digit = 0; while (data != 0) { digit += 1; data >>>= 1; } return digit; };
    _this.getBCHTypeInfo = function(data) { var d = data << 10; while (_getBCHDigit(d) - _getBCHDigit(G15) >= 0) d ^= (G15 << (_getBCHDigit(d) - _getBCHDigit(G15))); return ((data << 10) | d) ^ G15_MASK; };
    _this.getBCHTypeNumber = function(data) { var d = data << 12; while (_getBCHDigit(d) - _getBCHDigit(G18) >= 0) d ^= (G18 << (_getBCHDigit(d) - _getBCHDigit(G18))); return (data << 12) | d; };
    _this.getPatternPosition = function(typeNumber) { return PATTERN_POSITION_TABLE[typeNumber - 1]; };
    _this.getMaskFunction = function(maskPattern) {
      switch (maskPattern) {
        case QRMaskPattern.PATTERN000: return function(i, j) { return (i + j) % 2 == 0; };
        case QRMaskPattern.PATTERN001: return function(i, j) { return i % 2 == 0; };
        case QRMaskPattern.PATTERN010: return function(i, j) { return j % 3 == 0; };
        case QRMaskPattern.PATTERN011: return function(i, j) { return (i + j) % 3 == 0; };
        case QRMaskPattern.PATTERN100: return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0; };
        case QRMaskPattern.PATTERN101: return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
        case QRMaskPattern.PATTERN110: return function(i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 == 0; };
        case QRMaskPattern.PATTERN111: return function(i, j) { return ((i * j) % 3 + (i + j) % 2) % 2 == 0; };
        default: throw 'bad maskPattern:' + maskPattern;
      }
    };
    _this.getErrorCorrectPolynomial = function(errorCorrectLength) { var a = qrPolynomial([1], 0); for (var i = 0; i < errorCorrectLength; i += 1) a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0)); return a; };
    _this.getLengthInBits = function(mode, type) {
      if (1 <= type && type < 10) { switch (mode) { case QRMode.MODE_NUMBER: return 10; case QRMode.MODE_ALPHA_NUM: return 9; case QRMode.MODE_8BIT_BYTE: return 8; case QRMode.MODE_KANJI: return 8; default: throw 'mode'; }}
      else if (type < 27) { switch (mode) { case QRMode.MODE_NUMBER: return 12; case QRMode.MODE_ALPHA_NUM: return 11; case QRMode.MODE_8BIT_BYTE: return 16; case QRMode.MODE_KANJI: return 10; default: throw 'mode'; }}
      else if (type < 41) { switch (mode) { case QRMode.MODE_NUMBER: return 14; case QRMode.MODE_ALPHA_NUM: return 13; case QRMode.MODE_8BIT_BYTE: return 16; case QRMode.MODE_KANJI: return 12; default: throw 'mode'; }}
      else throw 'type:' + type;
    };
    _this.getLostPoint = function(qrcode) {
      var moduleCount = qrcode.getModuleCount(); var lostPoint = 0;
      for (var row = 0; row < moduleCount; row += 1) for (var col = 0; col < moduleCount; col += 1) {
        var sameCount = 0; var dark = qrcode.isDark(row, col);
        for (var r = -1; r <= 1; r += 1) { if (row + r < 0 || moduleCount <= row + r) continue;
          for (var c = -1; c <= 1; c += 1) { if (col + c < 0 || moduleCount <= col + c) continue; if (r == 0 && c == 0) continue; if (dark == qrcode.isDark(row + r, col + c)) sameCount += 1; }}
        if (sameCount > 5) lostPoint += (3 + sameCount - 5);
      }
      for (var row = 0; row < moduleCount - 1; row += 1) for (var col = 0; col < moduleCount - 1; col += 1) {
        var count = 0;
        if (qrcode.isDark(row, col)) count += 1;
        if (qrcode.isDark(row + 1, col)) count += 1;
        if (qrcode.isDark(row, col + 1)) count += 1;
        if (qrcode.isDark(row + 1, col + 1)) count += 1;
        if (count == 0 || count == 4) lostPoint += 3;
      }
      for (var row = 0; row < moduleCount; row += 1) for (var col = 0; col < moduleCount - 6; col += 1)
        if (qrcode.isDark(row, col) && !qrcode.isDark(row, col + 1) && qrcode.isDark(row, col + 2) && qrcode.isDark(row, col + 3) && qrcode.isDark(row, col + 4) && !qrcode.isDark(row, col + 5) && qrcode.isDark(row, col + 6)) lostPoint += 40;
      for (var col = 0; col < moduleCount; col += 1) for (var row = 0; row < moduleCount - 6; row += 1)
        if (qrcode.isDark(row, col) && !qrcode.isDark(row + 1, col) && qrcode.isDark(row + 2, col) && qrcode.isDark(row + 3, col) && qrcode.isDark(row + 4, col) && !qrcode.isDark(row + 5, col) && qrcode.isDark(row + 6, col)) lostPoint += 40;
      var darkCount = 0;
      for (var col = 0; col < moduleCount; col += 1) for (var row = 0; row < moduleCount; row += 1) if (qrcode.isDark(row, col)) darkCount += 1;
      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10; return lostPoint;
    };
    return _this;
  }();
  var QRMath = function() {
    var EXP_TABLE = new Array(256); var LOG_TABLE = new Array(256);
    for (var i = 0; i < 8; i += 1) EXP_TABLE[i] = 1 << i;
    for (var i = 8; i < 256; i += 1) EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
    for (var i = 0; i < 255; i += 1) LOG_TABLE[EXP_TABLE[i]] = i;
    var _this = {};
    _this.glog = function(n) { if (n < 1) throw 'glog(' + n + ')'; return LOG_TABLE[n]; };
    _this.gexp = function(n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP_TABLE[n]; };
    return _this;
  }();
  function qrPolynomial(num, shift) {
    if (typeof num.length == 'undefined') throw num.length + '/' + shift;
    var _num = function() { var offset = 0; while (offset < num.length && num[offset] == 0) offset += 1;
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) _num[i] = num[i + offset];
      return _num; }();
    var _this = {};
    _this.getAt = function(index) { return _num[index]; };
    _this.getLength = function() { return _num.length; };
    _this.multiply = function(e) { var num = new Array(_this.getLength() + e.getLength() - 1);
      for (var i = 0; i < _this.getLength(); i += 1) for (var j = 0; j < e.getLength(); j += 1)
        num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
      return qrPolynomial(num, 0); };
    _this.mod = function(e) { if (_this.getLength() - e.getLength() < 0) return _this;
      var ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
      var num = new Array(_this.getLength());
      for (var i = 0; i < _this.getLength(); i += 1) num[i] = _this.getAt(i);
      for (var i = 0; i < e.getLength(); i += 1) num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
      return qrPolynomial(num, 0).mod(e); };
    return _this;
  }
  var QRRSBlock = function() {
    var RS_BLOCK_TABLE = [
      [1, 26, 19],[1, 26, 16],[1, 26, 13],[1, 26, 9],
      [1, 44, 34],[1, 44, 28],[1, 44, 22],[1, 44, 16],
      [1, 70, 55],[1, 70, 44],[2, 35, 17],[2, 35, 13],
      [1, 100, 80],[2, 50, 32],[2, 50, 24],[4, 25, 9],
      [1, 134, 108],[2, 67, 43],[2, 33, 15, 2, 34, 16],[2, 33, 11, 2, 34, 12],
      [2, 86, 68],[4, 43, 27],[4, 43, 19],[4, 43, 15],
      [2, 98, 78],[4, 49, 31],[2, 32, 14, 4, 33, 15],[4, 39, 13, 1, 40, 14],
      [2, 121, 97],[2, 60, 38, 2, 61, 39],[4, 40, 18, 2, 41, 19],[4, 40, 14, 2, 41, 15],
      [2, 146, 116],[3, 58, 36, 2, 59, 37],[4, 36, 16, 4, 37, 17],[4, 36, 12, 4, 37, 13],
      [2, 86, 68, 2, 87, 69],[4, 69, 43, 1, 70, 44],[6, 43, 19, 2, 44, 20],[6, 43, 15, 2, 44, 16]
    ];
    var qrRSBlock = function(totalCount, dataCount) { var _this = {}; _this.totalCount = totalCount; _this.dataCount = dataCount; return _this; };
    var _this = {};
    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case QRErrorCorrectionLevel.L: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
        case QRErrorCorrectionLevel.M: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
        case QRErrorCorrectionLevel.Q: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
        case QRErrorCorrectionLevel.H: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
        default: return undefined;
      }
    };
    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
      if (typeof rsBlock == 'undefined') throw 'bad rs block @ typeNumber:' + typeNumber + '/errorCorrectionLevel:' + errorCorrectionLevel;
      var length = rsBlock.length / 3; var list = [];
      for (var i = 0; i < length; i += 1) { var count = rsBlock[i * 3 + 0]; var totalCount = rsBlock[i * 3 + 1]; var dataCount = rsBlock[i * 3 + 2];
        for (var j = 0; j < count; j += 1) list.push(qrRSBlock(totalCount, dataCount)); }
      return list;
    };
    return _this;
  }();
  function qrBitBuffer() {
    var _buffer = []; var _length = 0; var _this = {};
    _this.getBuffer = function() { return _buffer; };
    _this.getAt = function(index) { var bufIndex = Math.floor(index / 8); return ((_buffer[bufIndex] >>> (7 - index % 8)) & 1) == 1; };
    _this.put = function(num, length) { for (var i = 0; i < length; i += 1) _this.putBit(((num >>> (length - i - 1)) & 1) == 1); };
    _this.getLengthInBits = function() { return _length; };
    _this.putBit = function(bit) { var bufIndex = Math.floor(_length / 8); if (_buffer.length <= bufIndex) _buffer.push(0);
      if (bit) _buffer[bufIndex] |= (0x80 >>> (_length % 8)); _length += 1; };
    return _this;
  }
  function qr8BitByte(data) {
    var _mode = QRMode.MODE_8BIT_BYTE;
    var _bytes = function() { var bytes = []; for (var i = 0; i < data.length; i++) { var c = data.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) { bytes.push(0xc0 | (c >> 6)); bytes.push(0x80 | (c & 0x3f)); }
      else if (c < 0x10000) { bytes.push(0xe0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 0x3f)); bytes.push(0x80 | (c & 0x3f)); }
      else { bytes.push(0xf0 | (c >> 18)); bytes.push(0x80 | ((c >> 12) & 0x3f)); bytes.push(0x80 | ((c >> 6) & 0x3f)); bytes.push(0x80 | (c & 0x3f)); }
    } return bytes; }();
    var _this = {};
    _this.getMode = function() { return _mode; };
    _this.getLength = function() { return _bytes.length; };
    _this.write = function(buffer) { for (var i = 0; i < _bytes.length; i += 1) buffer.put(_bytes[i], 8); };
    return _this;
  }
  function createDataURL(width, height, getPixel) {
    var c = document.createElement('canvas'); c.width=width; c.height=height;
    var ctx = c.getContext('2d'); var img = ctx.createImageData(width, height);
    for (var y=0;y<height;y++) for (var x=0;x<width;x++) { var v = getPixel(x,y); var i=(y*width+x)*4; img.data[i]=v?255:0; img.data[i+1]=v?255:0; img.data[i+2]=v?255:0; img.data[i+3]=255; }
    ctx.putImageData(img,0,0); return c.toDataURL('image/png');
  }
  return qrcode;
}();

function generateUPIQR(amount, payeeName) {
  if (!settings.upi) return '';
  let upiUrl = `upi://pay?pa=${encodeURIComponent(settings.upi)}`;
  if (settings.acc_holder || payeeName) upiUrl += `&pn=${encodeURIComponent(settings.acc_holder || payeeName || settings.company_name || 'Studio')}`;
  if (amount && amount > 0) upiUrl += `&am=${amount.toFixed(2)}`;
  upiUrl += `&cu=INR&tn=${encodeURIComponent('Payment to '+(settings.company_name||'Studio'))}`;
  try {
    const qr = qrcode(0, 'M'); qr.addData(upiUrl); qr.make();
    return qr.createDataURL(4, 8);
  } catch(e) { console.error(e); return ''; }
}

/* ===================== Document Templates ===================== */
function companyBlock() {
  return `
    <div class="doc-header">
      <div class="doc-logo">${settings.logo ? `<img src="${settings.logo}"/>` : (settings.company_name||'SB').substring(0,2).toUpperCase()}</div>
      <div class="doc-company">
        <h1>${escapeHtml(settings.company_name || 'Studio Business Manager')}</h1>
        <p>
          ${settings.address ? escapeHtml(settings.address).replace(/\n/g,'<br>')+'<br>' : ''}
          ${settings.mobile ? '📱 '+escapeHtml(settings.mobile) : ''} ${settings.whatsapp?' · 💬 '+escapeHtml(settings.whatsapp):''}<br>
          ${settings.email ? '✉️ '+escapeHtml(settings.email) : ''} ${settings.website?' · 🌐 '+escapeHtml(settings.website):''}<br>
          ${settings.gst ? 'GST: '+escapeHtml(settings.gst)+' ':''} ${settings.pan?'· PAN: '+escapeHtml(settings.pan):''}
        </p>
      </div>
    </div>`;
}

function bankBlock(amount) {
  const qr = generateUPIQR(amount);
  return `
    <div class="doc-footer">
      <div class="doc-bank">
        <h4>💳 Payment Details</h4>
        ${settings.bank_name?'<strong>Bank:</strong> '+escapeHtml(settings.bank_name)+'<br>':''}
        ${settings.acc_holder?'<strong>A/c Holder:</strong> '+escapeHtml(settings.acc_holder)+'<br>':''}
        ${settings.acc_no?'<strong>A/c No:</strong> '+escapeHtml(settings.acc_no)+'<br>':''}
        ${settings.ifsc?'<strong>IFSC:</strong> '+escapeHtml(settings.ifsc)+'<br>':''}
        ${settings.upi?'<strong>UPI ID:</strong> '+escapeHtml(settings.upi):''}
      </div>
      ${qr ? `<div class="doc-qr"><img src="${qr}"/><small>Scan to Pay</small></div>` : `<div></div>`}
    </div>
    <div class="doc-thanks">Thank you for your business — We appreciate your trust ✨</div>`;
}

// Simpler footer for receipts — NO bank details, NO QR code (per requirement #3)
function receiptFooter() {
  return `
    <div class="doc-receipt-footer">
      <div class="sig-row">
        <div class="sig"><div class="line"></div><span>Receiver's Signature</span></div>
        <div class="sig"><div class="line"></div><span>For ${escapeHtml(settings.company_name || 'Studio')}</span></div>
      </div>
      <div class="doc-thanks">Thank you for your payment ✨</div>
    </div>`;
}

function previewInvoice(id) {
  const inv = invoices.find(x=>x.id===id); if (!inv) return;
  const c = customers.find(x=>x.id===inv.customer_id) || {};
  const p = projects.find(x=>x.id===inv.project_id);
  const paid = inv.total - inv.balance;
  const stamp = inv.status==='Paid' ? `<div class="doc-status-stamp paid">PAID</div>` :
                inv.status==='Partial' ? `<div class="doc-status-stamp partial">PARTIAL</div>` :
                `<div class="doc-status-stamp unpaid">UNPAID</div>`;

  $('docTitle').textContent = `Invoice ${inv.number}`;
  // File name = "Invoice Number - Customer Name"
  $('docModal').dataset.pdfName = safeFileName(`${inv.number} - ${c.name || 'Customer'}`);
  $('docModal').dataset.shareType = 'invoice';
  $('docModal').dataset.shareId = String(inv.id);
  $('docContent').innerHTML = `
    ${companyBlock()}
    ${stamp}
    <div class="doc-title-row">
      <h2>INVOICE</h2>
      <div class="doc-meta">
        <strong>Invoice #:</strong> ${inv.number}<br>
        <strong>Date:</strong> ${fmtDate(inv.date)}<br>
        <strong>Due Date:</strong> ${fmtDate(inv.due)}<br>
        ${p?'<strong>Project:</strong> '+escapeHtml(p.name):''}
      </div>
    </div>
    <div class="doc-parties">
      <div class="doc-party">
        <span>Bill To</span>
        <h4>${escapeHtml(c.name||'-')}</h4>
        <p>
          ${c.address ? escapeHtml(c.address)+'<br>':''}
          ${c.city?escapeHtml(c.city)+'<br>':''}
          ${c.mobile?'📱 '+escapeHtml(c.mobile):''} ${c.email?' · ✉️ '+escapeHtml(c.email):''}
        </p>
      </div>
      <div class="doc-party">
        <span>Project</span>
        <h4>${p?escapeHtml(p.name):'Service Invoice'}</h4>
        <p>${p?escapeHtml(p.type||'')+' · Event: '+fmtDate(p.event):'Direct service invoice (without project)'}</p>
      </div>
    </div>
    <table class="doc-items">
      <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>
        ${inv.items.map((it,i)=>`<tr>
          <td>${i+1}</td>
          <td class="desc">${escapeHtml(it.desc)}</td>
          <td class="qty">${it.qty}</td>
          <td class="rate">${fmtMoney(it.rate)}</td>
          <td class="amount">${fmtMoney(it.qty*it.rate)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="doc-totals">
      <div class="row"><span>Subtotal</span><span>${fmtMoney(inv.subtotal)}</span></div>
      ${inv.discount?`<div class="row"><span>Discount (${inv.discount}%)</span><span>-${fmtMoney(inv.subtotal*inv.discount/100)}</span></div>`:''}
      ${inv.tax?`<div class="row"><span>Tax (${inv.tax}%)</span><span>+${fmtMoney((inv.subtotal-inv.subtotal*inv.discount/100)*inv.tax/100)}</span></div>`:''}
      <div class="row grand"><span>Grand Total</span><span>${fmtMoney(inv.total)}</span></div>
      <div class="row"><span>Paid</span><span style="color:#1f8a4c;">${fmtMoney(paid)}</span></div>
      <div class="row balance-due"><span>Balance Due</span><span>${fmtMoney(inv.balance)}</span></div>
    </div>
    ${inv.notes?`<p style="margin-top:14px;font-size:12px;color:#555;font-weight:600;"><strong>Notes:</strong> ${escapeHtml(inv.notes)}</p>`:''}
    ${bankBlock(inv.balance>0?inv.balance:0)}
  `;
  openModal('docModal');
}

function previewQuotation(id) {
  const q = quotations.find(x=>x.id===id); if (!q) return;
  const c = customers.find(x=>x.id===q.customer_id) || {};
  const customerName = c.name || q.guest_name || 'Guest';
  $('docTitle').textContent = `Quotation ${q.number}`;
  $('docModal').dataset.pdfName = safeFileName(`${q.number} - ${customerName}`);
  $('docModal').dataset.shareType = 'quotation';
  $('docModal').dataset.shareId = String(q.id);
  $('docContent').innerHTML = `
    ${companyBlock()}
    <div class="doc-title-row">
      <h2>QUOTATION</h2>
      <div class="doc-meta">
        <strong>Quote #:</strong> ${q.number}<br>
        <strong>Date:</strong> ${fmtDate(q.date)}<br>
        ${q.valid?'<strong>Valid Till:</strong> '+fmtDate(q.valid):''}
      </div>
    </div>
    <div class="doc-parties">
      <div class="doc-party">
        <span>Quotation For</span>
        <h4>${escapeHtml(customerName)}${!c.name && q.guest_name ? ' (Guest)' : ''}</h4>
        <p>
          ${c.address?escapeHtml(c.address)+'<br>':''}
          ${c.city?escapeHtml(c.city)+'<br>':''}
          ${c.mobile?'📱 '+escapeHtml(c.mobile):''} ${c.email?' · ✉️ '+escapeHtml(c.email):''}
        </p>
      </div>
      <div class="doc-party">
        <span>Status</span>
        <h4>${escapeHtml(q.status)}</h4>
        <p>Quotation valid as per terms mentioned.</p>
      </div>
    </div>
    <table class="doc-items">
      <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>
        ${q.items.map((it,i)=>`<tr>
          <td>${i+1}</td>
          <td class="desc">${escapeHtml(it.desc)}</td>
          <td class="qty">${it.qty}</td>
          <td class="rate">${fmtMoney(it.rate)}</td>
          <td class="amount">${fmtMoney(it.qty*it.rate)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="doc-totals">
      <div class="row"><span>Subtotal</span><span>${fmtMoney(q.subtotal)}</span></div>
      ${q.discount?`<div class="row"><span>Discount (${q.discount}%)</span><span>-${fmtMoney(q.subtotal*q.discount/100)}</span></div>`:''}
      ${q.tax?`<div class="row"><span>Tax (${q.tax}%)</span><span>+${fmtMoney((q.subtotal-q.subtotal*q.discount/100)*q.tax/100)}</span></div>`:''}
      <div class="row grand"><span>Grand Total</span><span>${fmtMoney(q.total)}</span></div>
    </div>
    ${q.notes?`<p style="margin-top:14px;font-size:12px;color:#555;font-weight:600;"><strong>Notes:</strong> ${escapeHtml(q.notes)}</p>`:''}
    ${bankBlock(q.total)}
  `;
  openModal('docModal');
}

function previewReceipt(id) {
  const r = receipts.find(x=>x.id===id); if (!r) return;
  const c = customers.find(x=>x.id===r.customer_id) || {};
  const inv = invoices.find(x=>x.id===r.invoice_id);
  $('docTitle').textContent = `Receipt ${r.number}`;
  // File name = "Receipt Number - Customer Name"
  $('docModal').dataset.pdfName = safeFileName(`${r.number} - ${c.name || 'Customer'}`);
  $('docModal').dataset.shareType = 'receipt';
  $('docModal').dataset.shareId = String(r.id);
  $('docContent').innerHTML = `
    ${companyBlock()}
    <div class="doc-status-stamp paid">RECEIPT</div>
    <div class="doc-title-row">
      <h2>PAYMENT RECEIPT</h2>
      <div class="doc-meta">
        <strong>Receipt #:</strong> ${r.number}<br>
        <strong>Date:</strong> ${fmtDate(r.date)}<br>
        ${inv?'<strong>Invoice #:</strong> '+inv.number:''}
      </div>
    </div>
    <div class="doc-parties">
      <div class="doc-party">
        <span>Received From</span>
        <h4>${escapeHtml(c.name||'-')}</h4>
        <p>${c.mobile?'📱 '+escapeHtml(c.mobile):''} ${c.email?' · ✉️ '+escapeHtml(c.email):''}</p>
      </div>
      <div class="doc-party">
        <span>Payment Mode</span>
        <h4>${escapeHtml(r.mode)}</h4>
        <p>Received on ${fmtDate(r.date)}</p>
      </div>
    </div>
    <table class="doc-items">
      <thead><tr><th>Description</th><th>Amount</th></tr></thead>
      <tbody>
        <tr>
          <td class="desc">Payment received against invoice ${inv?inv.number:''}${r.notes?' — '+escapeHtml(r.notes):''}</td>
          <td class="amount">${fmtMoney(r.amount)}</td>
        </tr>
      </tbody>
    </table>
    <div class="doc-totals">
      <div class="row grand"><span>Amount Received</span><span>${fmtMoney(r.amount)}</span></div>
      ${inv ? `<div class="row"><span>Invoice Total</span><span>${fmtMoney(inv.total)}</span></div>
              <div class="row"><span>Balance After This Payment</span><span>${fmtMoney(inv.balance)}</span></div>` : ''}
    </div>
    ${receiptFooter()}
  `;
  openModal('docModal');
}

/* ===================== Customer Ledger (Combined Invoices + Receipts PDF) ===================== */
function previewCustomerLedger(custId) {
  const c = customers.find(x => x.id === custId); if (!c) return;
  const invs = invoices.filter(inv => inv.customer_id === custId).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const recs = receipts.filter(r => r.customer_id === custId).sort((a,b)=>(a.date||'').localeCompare(b.date||''));

  const totalBill = invs.reduce((s,i)=>s+(i.total||0), 0);
  const totalPaid = invs.reduce((s,i)=>s+((i.total||0)-(i.balance||0)), 0);
  const pending = invs.reduce((s,i)=>s+(i.balance||0), 0);

  $('docTitle').textContent = `Customer Ledger — ${c.name}`;
  $('docModal').dataset.pdfName = safeFileName(`Ledger - ${c.name}`);
  $('docModal').dataset.shareType = 'ledger';
  $('docModal').dataset.shareId = String(c.id);

  const invRows = invs.length ? invs.map((inv,i) => `
    <tr>
      <td>${i+1}</td>
      <td><strong>${inv.number}</strong></td>
      <td>${fmtDate(inv.date)}</td>
      <td class="amount">${fmtMoney(inv.total)}</td>
      <td class="amount">${fmtMoney((inv.total||0)-(inv.balance||0))}</td>
      <td class="amount" style="color:${inv.balance>0.001?'#c0392b':'#1f8a4c'};font-weight:700;">${fmtMoney(inv.balance)}</td>
      <td>${escapeHtml(inv.status)}</td>
    </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;color:#888;padding:14px;">No invoices on record</td></tr>`;

  const recRows = recs.length ? recs.map((r,i) => {
    const inv = invoices.find(x => x.id === r.invoice_id);
    return `
    <tr>
      <td>${i+1}</td>
      <td><strong>${r.number}</strong></td>
      <td>${fmtDate(r.date)}</td>
      <td>${inv ? inv.number : '—'}</td>
      <td>${escapeHtml(r.mode)}</td>
      <td class="amount" style="color:#1f8a4c;font-weight:700;">${fmtMoney(r.amount)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" style="text-align:center;color:#888;padding:14px;">No receipts on record</td></tr>`;

  $('docContent').innerHTML = `
    ${companyBlock()}
    <div class="doc-title-row">
      <h2>CUSTOMER LEDGER</h2>
      <div class="doc-meta">
        <strong>Generated:</strong> ${fmtDate(today())}<br>
        <strong>Customer ID:</strong> #${c.id}
      </div>
    </div>
    <div class="doc-parties">
      <div class="doc-party">
        <span>Account Holder</span>
        <h4>${escapeHtml(c.name||'-')}</h4>
        <p>
          ${c.address ? escapeHtml(c.address)+'<br>':''}
          ${c.city?escapeHtml(c.city)+'<br>':''}
          ${c.mobile?'📱 '+escapeHtml(c.mobile):''} ${c.email?' · ✉️ '+escapeHtml(c.email):''}
        </p>
      </div>
      <div class="doc-party">
        <span>Account Summary</span>
        <h4><span style="color:${pending>0.001?'#c0392b':'#1f8a4c'};">${fmtMoney(pending)}</span><small style="font-size:9px;font-weight:600;color:${pending>0.001?'#c0392b':'#1f8a4c'};text-transform:uppercase;letter-spacing:.1em;">Outstanding</small></h4>
        <p>
          Total Billed: <strong>${fmtMoney(totalBill)}</strong><br>
          Total Paid: <strong style="color:#1f8a4c;">${fmtMoney(totalPaid)}</strong><br>
          Invoices: ${invs.length} · Receipts: ${recs.length}
        </p>
      </div>
    </div>

    <h3 class="ledger-section-title">🧾 Invoices</h3>
    <table class="doc-items">
      <thead><tr><th>#</th><th>Invoice #</th><th>Date</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
      <tbody>${invRows}</tbody>
    </table>

    <h3 class="ledger-section-title">🧮 Receipts</h3>
    <table class="doc-items">
      <thead><tr><th>#</th><th>Receipt #</th><th>Date</th><th>Against Invoice</th><th>Mode</th><th>Amount</th></tr></thead>
      <tbody>${recRows}</tbody>
    </table>

    <div class="doc-totals ledger-totals">
      <div class="row"><span>Total Billed</span><span>${fmtMoney(totalBill)}</span></div>
      <div class="row"><span>Total Received</span><span style="color:#1f8a4c;font-weight:700;">${fmtMoney(totalPaid)}</span></div>
      <div class="row grand"><span>Outstanding Balance</span><span>${fmtMoney(pending)}</span></div>
    </div>
    ${invs.length || recs.length ? '' : ''}

    ${bankBlock(pending > 0 ? pending : 0)}
  `;
  openModal('docModal');
}

/* ===================== Recurring Invoices ===================== */
async function autoGenerateRecurringInvoices() {
  const todayStr = today();
  const due = invoices.filter(inv => inv.recurring && inv.recurring_active && inv.recurring_next && inv.recurring_next <= todayStr);
  if (!due.length) return 0;
  let generated = 0;
  for (const src of due) {
    // Clone source invoice into a new one with new number + dates
    const newDate = src.recurring_next || todayStr;
    const dueDate = new Date(newDate); dueDate.setDate(dueDate.getDate()+15);
    const newInv = {
      number: nextNumber(settings.inv_prefix||'INV','invoices'),
      customer_id: src.customer_id,
      project_id: src.project_id || null,
      date: newDate,
      due: dueDate.toISOString().slice(0,10),
      items: JSON.parse(JSON.stringify(src.items||[])),
      subtotal: src.subtotal, discount: src.discount, tax: src.tax,
      total: src.total, advance: 0, balance: src.total, status: 'Unpaid',
      notes: src.notes || '',
      recurring: 0, recurring_next: '', recurring_active: 0, recurring_last: '',
      auto_from_recurring: src.number,
      created: Date.now()
    };
    const newId = await dbAdd('invoices', newInv);
    // Bump source's next date by 1 month, mark last generated
    src.recurring_last = newDate;
    src.recurring_next = nextMonthDateStr(newDate);
    await dbPut('invoices', src);
    await logActivity(`Auto-created recurring invoice ${newInv.number} from ${src.number}`, '🔄');
    generated++;
  }
  if (generated) {
    // Reload local arrays
    invoices = await dbAll('invoices');
  }
  return generated;
}

function renderRecurring() {
  const body = $('recurringTable');
  if (!body) return;
  const list = invoices.filter(inv => inv.recurring).sort((a,b)=>(a.recurring_next||'').localeCompare(b.recurring_next||''));
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:30px;">No recurring invoices yet. — Open any invoice and tick "🔄 Recurring Monthly" to set one up.</td></tr>`;
    return;
  }
  body.innerHTML = list.map(inv => {
    const c = customers.find(x => x.id === inv.customer_id);
    return `<tr>
      <td><strong>${inv.number}</strong></td>
      <td>${c?escapeHtml(c.name):'-'}</td>
      <td>${fmtMoney(inv.total)}</td>
      <td>${fmtDate(inv.recurring_next)}</td>
      <td>${inv.recurring_active ? '<span class="badge green">Active</span>' : '<span class="badge gray">Paused</span>'}</td>
      <td>${inv.recurring_last ? fmtDate(inv.recurring_last) : '—'}</td>
      <td class="actions">
        <button class="act-btn" onclick="openInvoiceModal(${inv.id})">Edit</button>
        <button class="act-btn" onclick="toggleRecurringActive(${inv.id})">${inv.recurring_active?'Pause':'Resume'}</button>
        <button class="act-btn" onclick="runRecurringNow(${inv.id})" title="Generate this month's invoice now">⚡ Run Now</button>
        <button class="act-btn danger" onclick="stopRecurring(${inv.id})">Stop</button>
      </td>
    </tr>`;
  }).join('');
}

async function toggleRecurringActive(invId) {
  const inv = invoices.find(x => x.id === invId); if (!inv) return;
  inv.recurring_active = inv.recurring_active ? 0 : 1;
  await dbPut('invoices', inv);
  invoices = await dbAll('invoices');
  renderRecurring(); toast('Recurring status updated','success');
}
async function stopRecurring(invId) {
  if (!confirm('Stop recurring for this invoice? It will no longer auto-generate. The source invoice itself will remain.')) return;
  const inv = invoices.find(x => x.id === invId); if (!inv) return;
  inv.recurring = 0; inv.recurring_active = 0; inv.recurring_next = '';
  await dbPut('invoices', inv);
  invoices = await dbAll('invoices');
  renderRecurring(); renderInvoices(); toast('Recurring stopped','success');
}
async function runRecurringNow(invId) {
  const inv = invoices.find(x => x.id === invId); if (!inv) return;
  // Force the next date to today so the auto-generator picks it up.
  inv.recurring_next = today();
  await dbPut('invoices', inv);
  const n = await autoGenerateRecurringInvoices();
  renderRecurring(); renderInvoices(); renderDashboard();
  toast(n ? `${n} invoice(s) generated`:'Nothing to generate','success');
}

function getPrintableDocumentStyles(pageHeightMM) {
  // Dynamic page size — page height = exact content height (no bottom blank space)
  // Page width fixed at A4 (210mm); height comes from measured content.
  const h = pageHeightMM ? `${pageHeightMM}mm` : 'auto';
  /* ---------------------------------------------------------------
     v1.3 — PREMIUM INVOICE DESIGN
     - Refined deep-navy + champagne-gold palette (replaces purple)
     - Lighter visual weight, more breathing room
     - Slim accent rules instead of heavy color blocks
     - Editorial-style typography hierarchy
     - Blank space outside content kept untouched (page auto-crops)
  --------------------------------------------------------------- */
  return `
    @page{size:210mm ${h};margin:0}
    *{box-sizing:border-box;margin:0;padding:0;
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
    html,body{background:#fff !important;color:#1a1f3a;margin:0;padding:0}
    body{
      font-family:'Inter','Plus Jakarta Sans','Segoe UI',system-ui,-apple-system,sans-serif;
      font-size:11px;line-height:1.5;font-weight:450;color:#2a2f44;
      padding:10mm 12mm 9mm;
      width:210mm;
    }

    /* CSS variables for the premium palette */
    :root{
      --ink:#1a1f3a;        /* deep navy ink */
      --ink-soft:#3d4564;
      --muted:#7a8099;
      --line:#e8e8ee;       /* subtle hairline */
      --gold:#b8924d;       /* champagne gold accent */
      --gold-soft:#d6b574;
      --cream:#faf8f4;      /* soft cream wash */
      --paid:#1f8a4c;
      --unpaid:#c0392b;
      --partial:#c47d18;
    }

    /* Document wrapper — fluid height, no forced full-page */
    .doc-print{background:#fff;color:#2a2f44;position:relative;width:100%;page-break-inside:avoid}
    .doc-print *{color:inherit}

    /* =============== Company header =============== */
    .doc-header{
      display:flex;justify-content:space-between;align-items:center;
      padding-bottom:14px;margin-bottom:8px;gap:18px;
      border-bottom:1px solid var(--line);
      position:relative;
    }
    /* slim gold accent rule under the hairline */
    .doc-header::after{
      content:'';position:absolute;left:0;bottom:-1px;width:60px;height:2px;
      background:linear-gradient(90deg,var(--gold),var(--gold-soft));
      border-radius:2px;
    }
    .doc-header .doc-logo{
      width:52px;height:52px;border-radius:8px;overflow:hidden;flex-shrink:0;
      background:#1a1f3a;
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-weight:700;font-size:15px;letter-spacing:.5px;
      box-shadow:0 0 0 1px #1a1f3a, 0 0 0 3px #faf8f4;
    }
    .doc-header .doc-logo img{width:100%;height:100%;object-fit:cover}
    .doc-company{text-align:right;flex:1;min-width:0}
    .doc-company h1{
      font-family:'Plus Jakarta Sans','Inter',sans-serif;
      font-size:18px;color:var(--ink);margin-bottom:3px;
      font-weight:700;letter-spacing:-.015em;line-height:1.15;
    }
    .doc-company p{font-size:9px;color:var(--muted);line-height:1.55;font-weight:400;letter-spacing:.01em}

    /* =============== Title row =============== */
    .doc-title-row{
      display:flex;justify-content:space-between;align-items:flex-end;
      margin:14px 0 10px;gap:16px;
    }
    .doc-title-row h2{
      font-family:'Plus Jakarta Sans','Inter',sans-serif;
      font-size:24px;color:var(--ink);
      letter-spacing:.18em;font-weight:700;
      text-transform:uppercase;
      position:relative;padding-bottom:6px;
    }
    .doc-title-row h2::after{
      content:'';position:absolute;left:0;bottom:0;width:34px;height:2px;
      background:var(--gold);
    }
    .doc-meta{
      text-align:right;font-size:9.5px;color:var(--muted);
      line-height:1.7;font-weight:500;letter-spacing:.01em;
    }
    .doc-meta strong{color:var(--ink);font-weight:700;margin-right:3px}

    /* =============== Bill To / Project =============== */
    .doc-parties{
      display:grid;grid-template-columns:1fr 1fr;gap:14px;
      margin:6px 0 14px;
    }
    .doc-party{
      background:transparent;
      padding:4px 0 4px 12px;
      border-left:2px solid var(--gold);
      border-radius:0;
    }
    .doc-party span{
      font-size:8px;text-transform:uppercase;letter-spacing:.16em;
      color:var(--gold);font-weight:700;
    }
    .doc-party h4{
      font-size:13px;margin:3px 0 4px;font-weight:700;color:var(--ink);
      letter-spacing:-.005em;
      display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;
      line-height:1.3;
    }
    .doc-party h4 small{font-weight:600;letter-spacing:.04em}
    .doc-party p{font-size:9.5px;color:var(--ink-soft);line-height:1.6;font-weight:500;margin-top:2px}

    /* =============== Items table (refined editorial style) =============== */
    .doc-items{width:100%;border-collapse:collapse;margin-bottom:10px;margin-top:6px}
    .doc-items th{
      background:transparent;color:var(--ink);
      padding:9px 8px 7px;
      font-size:8.5px;text-align:left;font-weight:700;
      letter-spacing:.14em;text-transform:uppercase;
      border-top:1.5px solid var(--ink);
      border-bottom:1px solid var(--ink);
    }
    .doc-items th:last-child,.doc-items td:last-child{text-align:right}
    .doc-items td{
      padding:8px 8px;border-bottom:1px solid var(--line);
      font-size:10.5px;vertical-align:top;font-weight:500;color:var(--ink-soft);
    }
    .doc-items td.desc{font-weight:600;color:var(--ink)}
    .doc-items td.qty,.doc-items td.rate{font-weight:500;color:var(--ink-soft);font-variant-numeric:tabular-nums}
    .doc-items td.amount{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
    .doc-items tbody tr:last-child td{border-bottom:1.5px solid var(--ink)}

    /* =============== Totals — minimalist with gold accent =============== */
    .doc-totals{
      margin-left:auto;width:280px;font-size:10.5px;margin-bottom:4px;
      font-variant-numeric:tabular-nums;
    }
    .doc-totals .row{
      display:flex;justify-content:space-between;align-items:baseline;
      padding:6px 4px;gap:14px;
      font-weight:500;color:var(--ink-soft);
      border-bottom:1px dotted var(--line);
      line-height:1.45;
      min-height:24px;
    }
    .doc-totals .row span{display:inline-block;line-height:1.45}
    .doc-totals .row span:first-child{text-align:left}
    .doc-totals .row span:last-child{color:var(--ink);font-weight:600;text-align:right;white-space:nowrap}
    .doc-totals .grand{
      background:var(--ink);color:#fff !important;
      padding:10px 14px;border-radius:3px;margin-top:8px;
      font-weight:700;font-size:12.5px;border-bottom:none;
      letter-spacing:.02em;
      box-shadow:inset 0 0 0 1px var(--ink), inset 4px 0 0 var(--gold);
      align-items:center;
      min-height:34px;
    }
    .doc-totals .grand span{color:#fff !important;line-height:1.2}
    .doc-totals .grand span:first-child{text-transform:uppercase;letter-spacing:.1em;font-size:10px;font-weight:700;display:flex;align-items:center}
    .doc-totals .grand span:last-child{font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:flex-end}
    /* Balance Due row — visually highlighted (red), evenly aligned */
    .doc-totals .balance-due{
      background:rgba(192,57,43,0.06);
      border-left:3px solid #c0392b;
      border-bottom:1px solid rgba(192,57,43,0.18);
      padding-left:9px;
      margin-top:2px;
      border-radius:2px;
    }
    .doc-totals .balance-due span{color:#c0392b !important;font-weight:700 !important}
    .doc-totals .balance-due span:last-child{font-size:11.5px}
    /* Ledger totals layout — prevent shift of "Outstanding Balance" */
    .ledger-totals{width:300px}
    .ledger-totals .grand{font-size:11.5px}
    .ledger-totals .grand span:first-child{font-size:10.5px}
    .ledger-totals .grand span:last-child{font-size:13.5px}

    /* =============== Bank + QR footer =============== */
    .doc-footer{
      margin-top:18px;display:grid;grid-template-columns:1fr 105px;
      gap:18px;align-items:flex-start;padding-top:12px;
      border-top:1px solid var(--line);position:relative;
    }
    .doc-footer::before{
      content:'';position:absolute;left:0;top:-1px;width:60px;height:2px;
      background:linear-gradient(90deg,var(--gold),var(--gold-soft));
    }
    .doc-bank{font-size:9.5px;color:var(--ink-soft);line-height:1.7;font-weight:500}
    .doc-bank h4{
      color:var(--gold);margin-bottom:5px;font-size:8.5px;font-weight:700;
      text-transform:uppercase;letter-spacing:.14em;
    }
    .doc-bank strong{font-weight:600;color:var(--ink)}
    .doc-qr{text-align:center}
    .doc-qr img{
      width:95px;height:95px;
      border:1px solid var(--line);border-radius:4px;
      padding:4px;background:#fff;display:block;margin:0 auto
    }
    .doc-qr small{display:block;font-size:7.5px;color:var(--muted);margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.12em}

    /* =============== Thanks bar =============== */
    .doc-thanks{
      text-align:center;margin-top:12px;padding:8px 6px;
      background:transparent;border-top:1px dotted var(--line);
      font-size:9.5px;color:var(--muted);font-weight:500;
      letter-spacing:.05em;font-style:italic;
    }

    /* =============== Receipt footer (signature) =============== */
    .doc-receipt-footer{margin-top:22px;padding-top:14px;border-top:1px solid var(--line);position:relative}
    .doc-receipt-footer::before{
      content:'';position:absolute;left:0;top:-1px;width:60px;height:2px;
      background:linear-gradient(90deg,var(--gold),var(--gold-soft));
    }
    .doc-receipt-footer .sig-row{display:flex;justify-content:space-between;gap:32px;margin-bottom:14px}
    .doc-receipt-footer .sig{flex:1;text-align:center}
    .doc-receipt-footer .sig .line{border-top:1px solid var(--ink-soft);margin-bottom:5px;padding-top:30px}
    .doc-receipt-footer .sig span{font-size:8.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.14em}

    /* =============== Watermark stamp =============== */
    .doc-status-stamp{
      position:absolute;right:14px;top:80px;
      font-size:24px;font-weight:800;opacity:.10;
      border:3px solid currentColor;padding:5px 14px;
      border-radius:4px;transform:rotate(-12deg);letter-spacing:.1em;
    }
    .doc-status-stamp.paid{color:var(--paid)}
    .doc-status-stamp.partial{color:var(--partial)}
    .doc-status-stamp.unpaid{color:var(--unpaid)}

    /* =============== Ledger-specific styles =============== */
    .ledger-section-title{
      font-family:'Plus Jakarta Sans','Inter',sans-serif;
      font-size:11px;color:var(--ink);font-weight:700;
      text-transform:uppercase;letter-spacing:.15em;
      margin:14px 0 6px;padding-bottom:4px;
      border-bottom:1px solid var(--line);position:relative;
    }
    .ledger-section-title::after{
      content:'';position:absolute;left:0;bottom:-1px;width:24px;height:1.5px;
      background:var(--gold);
    }

    /* =============== Reports =============== */
    .report-print{width:100%;page-break-inside:avoid}
    .report-head{
      display:flex;justify-content:space-between;align-items:flex-start;
      gap:14px;margin-bottom:12px;padding-bottom:10px;
      border-bottom:1px solid var(--line);position:relative;
    }
    .report-head::after{
      content:'';position:absolute;left:0;bottom:-1px;width:60px;height:2px;
      background:linear-gradient(90deg,var(--gold),var(--gold-soft));
    }
    .report-head h1{font-size:18px;color:var(--ink);margin-bottom:3px;font-weight:700;letter-spacing:-.01em}
    .report-head h2{font-size:13px;margin:5px 0 2px;font-weight:600;color:var(--ink)}
    .report-head p{font-size:9.5px;color:var(--muted);line-height:1.55;font-weight:500}
    .report-head img{max-height:48px;border-radius:6px}
    .report-table,table{width:100%;border-collapse:collapse}
    .report-table th,table th{
      background:transparent;color:var(--ink);padding:8px 8px;
      font-size:8.5px;text-align:left;font-weight:700;
      letter-spacing:.14em;text-transform:uppercase;
      border-top:1.5px solid var(--ink);border-bottom:1px solid var(--ink);
    }
    .report-table td,table td{
      padding:7px 8px;border-bottom:1px solid var(--line);
      font-size:10.5px;font-weight:500;color:var(--ink-soft);
    }
  `;
}

function printViaIframe(title, bodyHtml) {
  const old = document.getElementById('_sbm_printFrame');
  if (old) old.remove();

  const iframe = document.createElement('iframe');
  iframe.id = '_sbm_printFrame';
  // Make iframe A4 width so measurement is accurate to print page (210mm).
  // Keep visually hidden via left offset (NOT width:0) so layout can be measured.
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:auto;border:none;pointer-events:none;background:#fff;';
  document.body.appendChild(iframe);

  const safeTitle = safeFileName(title);

  // First write WITHOUT a fixed @page height (size:auto) so we can measure content.
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html style="background:#fff"><head><meta charset="UTF-8"><title>${safeTitle}</title><style>${getPrintableDocumentStyles()}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();

  // Force title (browsers use document.title as suggested PDF filename)
  const originalTitle = document.title;
  try {
    iframe.contentDocument.title = safeTitle;
    document.title = safeTitle;
    iframe.addEventListener('load', () => {
      try { iframe.contentDocument.title = safeTitle; } catch(e){}
    });
  } catch(e) { /* ignore */ }

  // Wait for images (logo, QR) + fonts to render, then measure, inject exact page height, then print.
  const ready = () => new Promise(resolve => {
    const win = iframe.contentWindow;
    const idoc = iframe.contentDocument;
    if (!win || !idoc) return resolve();
    const imgs = Array.from(idoc.images || []);
    const imgPromises = imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(r => {
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
        setTimeout(r, 1500); // safety timeout
      });
    });
    const fontReady = (idoc.fonts && idoc.fonts.ready) ? idoc.fonts.ready : Promise.resolve();
    Promise.all([fontReady, ...imgPromises]).then(() => resolve());
  });

  ready().then(() => {
    try {
      const idoc = iframe.contentDocument;
      // Measure actual rendered content height (in CSS pixels), convert to mm.
      // 1 inch = 96 CSS px = 25.4 mm  →  1 mm ≈ 3.7795 px
      const body = idoc.body;
      const html = idoc.documentElement;
      const heightPx = Math.max(
        body.scrollHeight, body.offsetHeight,
        html.clientHeight, html.scrollHeight, html.offsetHeight
      );
      // Add 2mm tiny safety buffer; clamp to A4 minimum so very short docs still look nice.
      let heightMM = Math.ceil(heightPx / 3.7795) + 2;
      if (heightMM < 100) heightMM = 100;       // floor (no microscopic pages)
      // Re-inject styles with exact @page height so PDF page = content height (NO blank bottom).
      const styleEl = idoc.querySelector('style');
      if (styleEl) styleEl.textContent = getPrintableDocumentStyles(heightMM);
    } catch(e) { console.warn('page height measure failed', e); }

    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch(e) {
        console.warn('iframe print failed', e);
        toast('Print failed. Try Ctrl+P from the page.', 'error');
      }
      setTimeout(() => {
        document.title = originalTitle;
        if (iframe.parentNode) iframe.remove();
      }, 3000);
    }, 200);
  });
}

function openPrintWindow(title, bodyHtml) {
  printViaIframe(title, bodyHtml);
}

function printDoc() {
  const content = $('docContent').innerHTML.trim();
  if (!content) return toast('Nothing to print', 'error');
  const pdfName = $('docModal').dataset.pdfName || $('docTitle').textContent || 'Document';
  printViaIframe(pdfName, `<div class="doc-print">${content}</div>`);
}

/* ===================== Reports ===================== */
function generateReport(type) {
  const out = $('reportOutput'); out.style.display='block';
  let title='', body='';
  const ds = (d) => fmtDate(d);

  if (type==='daily') {
    title = 'Daily Revenue Report (Last 30 Days)';
    const map = {};
    payments.forEach(p=>{ map[p.date] = (map[p.date]||0)+p.amount; });
    const rows = Object.keys(map).sort().reverse().slice(0,30);
    body = `<table class="table"><thead><tr><th>Date</th><th>Total Received</th></tr></thead><tbody>
      ${rows.map(d=>`<tr><td>${ds(d)}</td><td>${fmtMoney(map[d])}</td></tr>`).join('')||'<tr><td colspan="2">No data</td></tr>'}
    </tbody></table>`;
  } else if (type==='monthly') {
    title = 'Monthly Revenue Report';
    const map = {};
    payments.forEach(p=>{ const k = p.date.slice(0,7); map[k]=(map[k]||0)+p.amount; });
    body = `<table class="table"><thead><tr><th>Month</th><th>Revenue</th></tr></thead><tbody>
      ${Object.keys(map).sort().reverse().map(k=>`<tr><td>${k}</td><td>${fmtMoney(map[k])}</td></tr>`).join('')||'<tr><td colspan="2">No data</td></tr>'}
    </tbody></table>`;
  } else if (type==='yearly') {
    title = 'Yearly Revenue Report';
    const map = {};
    payments.forEach(p=>{ const k = p.date.slice(0,4); map[k]=(map[k]||0)+p.amount; });
    body = `<table class="table"><thead><tr><th>Year</th><th>Revenue</th></tr></thead><tbody>
      ${Object.keys(map).sort().reverse().map(k=>`<tr><td>${k}</td><td>${fmtMoney(map[k])}</td></tr>`).join('')||'<tr><td colspan="2">No data</td></tr>'}
    </tbody></table>`;
  } else if (type==='pending') {
    title = 'Pending Payments';
    const list = invoices.filter(i=>i.balance>0).sort((a,b)=>b.balance-a.balance);
    body = `<table class="table"><thead><tr><th>Invoice</th><th>Customer</th><th>Total</th><th>Balance</th><th>Due</th></tr></thead><tbody>
      ${list.map(i=>{const c=customers.find(x=>x.id===i.customer_id);return `<tr><td>${i.number}</td><td>${c?escapeHtml(c.name):''}</td><td>${fmtMoney(i.total)}</td><td>${fmtMoney(i.balance)}</td><td>${fmtDate(i.due)}</td></tr>`}).join('')||'<tr><td colspan="5">No pending payments</td></tr>'}
    </tbody></table>`;
  } else if (type==='completed') {
    title = 'Completed Projects';
    const list = projects.filter(p=>['Completed','Delivered'].includes(p.status));
    body = `<table class="table"><thead><tr><th>Project</th><th>Customer</th><th>Type</th><th>Value</th><th>Status</th></tr></thead><tbody>
      ${list.map(p=>{const c=customers.find(x=>x.id===p.customer_id);return `<tr><td>${escapeHtml(p.name)}</td><td>${c?escapeHtml(c.name):''}</td><td>${escapeHtml(p.type||'')}</td><td>${fmtMoney(p.value)}</td><td>${escapeHtml(p.status)}</td></tr>`}).join('')||'<tr><td colspan="5">No data</td></tr>'}
    </tbody></table>`;
  } else if (type==='upcoming') {
    title = 'Upcoming Deliveries';
    const list = projects.filter(p=>p.delivery && new Date(p.delivery)>=new Date() && !['Completed','Delivered','Cancelled'].includes(p.status))
                        .sort((a,b)=>new Date(a.delivery)-new Date(b.delivery));
    body = `<table class="table"><thead><tr><th>Project</th><th>Customer</th><th>Delivery</th><th>Status</th></tr></thead><tbody>
      ${list.map(p=>{const c=customers.find(x=>x.id===p.customer_id);return `<tr><td>${escapeHtml(p.name)}</td><td>${c?escapeHtml(c.name):''}</td><td>${fmtDate(p.delivery)}</td><td>${escapeHtml(p.status)}</td></tr>`}).join('')||'<tr><td colspan="4">No upcoming deliveries</td></tr>'}
    </tbody></table>`;
  } else if (type==='customers') {
    title = 'Customer Report';
    body = `<table class="table"><thead><tr><th>Name</th><th>Mobile</th><th>City</th><th>Projects</th><th>Billed</th><th>Pending</th></tr></thead><tbody>
      ${customers.map(c=>{
        const invs = invoices.filter(i=>i.customer_id===c.id);
        const billed = invs.reduce((s,i)=>s+i.total,0);
        const pend = invs.reduce((s,i)=>s+i.balance,0);
        const np = projects.filter(p=>p.customer_id===c.id).length;
        return `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.mobile)}</td><td>${escapeHtml(c.city||'-')}</td><td>${np}</td><td>${fmtMoney(billed)}</td><td>${fmtMoney(pend)}</td></tr>`;
      }).join('')||'<tr><td colspan="6">No customers</td></tr>'}
    </tbody></table>`;
  } else if (type==='expenses') {
    title = 'Expense Report';
    const map = {};
    expenses.forEach(e=>{ map[e.category]=(map[e.category]||0)+e.amount; });
    body = `<table class="table"><thead><tr><th>Category</th><th>Amount</th></tr></thead><tbody>
      ${Object.keys(map).map(k=>`<tr><td>${escapeHtml(k)}</td><td>${fmtMoney(map[k])}</td></tr>`).join('')||'<tr><td colspan="2">No data</td></tr>'}
      <tr style="font-weight:700"><td>Total</td><td>${fmtMoney(expenses.reduce((s,e)=>s+e.amount,0))}</td></tr>
    </tbody></table>`;
  }

  $('reportTitle').textContent = title;
  $('reportBody').innerHTML = body;
}

function printReport() {
  const reportTitle = $('reportTitle').textContent || 'Report';
  const reportBody = $('reportBody').innerHTML.trim();
  if (!reportBody) return toast('Generate a report first', 'error');

  // File name includes company name for clarity
  const fileName = safeFileName(`${reportTitle} - ${settings.company_name || 'Studio'}`);

  printViaIframe(fileName, `
    <div class="report-print">
      <div class="report-head">
        <div>
          <h1>${escapeHtml(settings.company_name || 'Studio Business Manager')}</h1>
          <p>
            ${settings.address ? escapeHtml(settings.address).replace(/\n/g,'<br>') + '<br>' : ''}
            ${escapeHtml(settings.mobile||'')} ${settings.email ? ' · ' + escapeHtml(settings.email) : ''}
          </p>
          <h2>${escapeHtml(reportTitle)}</h2>
          <p>Generated on ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}</p>
        </div>
        ${settings.logo ? `<img src="${settings.logo}" alt="Company Logo"/>` : ''}
      </div>
      ${reportBody}
    </div>
  `);
}

/* ===================== Backup ===================== */
function updateBackupLocationHint(fileName = 'studio-backup-latest.json') {
  const el = $('backupLocationHint');
  if (!el) return;
  if (!('showDirectoryPicker' in window)) {
    el.textContent = 'Backup will download to your browser Downloads folder as studio-backup-latest.json (overwriting previous).';
    return;
  }
  if (backupDirectoryHandle?.name) {
    el.textContent = `✅ App folder selected: "${backupDirectoryHandle.name}" → backup/${fileName} (auto-overwrites each time)`;
  } else {
    el.textContent = '⚠️ Click "Export Backup" — it will ask you to select your StudioBusinessManager app folder once. After that, backups auto-save to the backup/ folder inside it.';
  }
}

/* Public: verify the last saved backup file inside the chosen app folder.
   Reads backup/studio-backup-latest.json (or any latest copy) and reports
   file size, last-modified time, record counts, and freshness vs current data. */
async function verifyBackup() {
  const panel = $('backupStatusPanel');
  if (!panel) return;
  panel.classList.add('show');
  panel.innerHTML = '<div class="b-row"><span>Verifying…</span><span>Please wait</span></div>';

  const counts = {
    customers: customers.length, projects: projects.length,
    quotations: quotations.length, invoices: invoices.length,
    payments: payments.length, receipts: receipts.length, expenses: expenses.length
  };

  const fmtTime = (d) => d ? new Date(d).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const fmtSize = (b) => b < 1024 ? b + ' B' : b < 1024*1024 ? (b/1024).toFixed(1)+' KB' : (b/1024/1024).toFixed(2)+' MB';

  // Helper to render rows
  const rows = [];
  rows.push(`<div class="b-row"><span>Auto-backup interval</span><span>Every 5 minutes</span></div>`);
  rows.push(`<div class="b-row"><span>App folder selected</span><span class="${backupDirectoryHandle?'b-ok':'b-warn'}">${backupDirectoryHandle ? '✅ "'+backupDirectoryHandle.name+'"' : '⚠️ Not selected'}</span></div>`);
  rows.push(`<div class="b-row"><span>Last auto-backup this session</span><span>${lastAutoBackupAt ? fmtTime(lastAutoBackupAt) : '— (next run within 5 min)'}</span></div>`);

  // Try to read the actual backup file inside the chosen folder
  if (backupDirectoryHandle && backupDirectoryHandle.queryPermission) {
    try {
      let perm = await backupDirectoryHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted' && backupDirectoryHandle.requestPermission) {
        perm = await backupDirectoryHandle.requestPermission({ mode: 'read' });
      }
      if (perm === 'granted') {
        const backupHandle = await backupDirectoryHandle.getDirectoryHandle('backup', { create: false }).catch(()=>null);
        if (!backupHandle) {
          rows.push(`<div class="b-row"><span>backup/ folder</span><span class="b-warn">Not found — no backup yet. Click "Export Backup".</span></div>`);
        } else {
          const fileHandle = await backupHandle.getFileHandle('studio-backup-latest.json', { create: false }).catch(()=>null);
          if (!fileHandle) {
            rows.push(`<div class="b-row"><span>studio-backup-latest.json</span><span class="b-warn">Not found in backup/ — click "Export Backup" once.</span></div>`);
          } else {
            const file = await fileHandle.getFile();
            rows.push(`<div class="b-row"><span>Backup file</span><span class="b-ok">backup/studio-backup-latest.json</span></div>`);
            rows.push(`<div class="b-row"><span>File size</span><span>${fmtSize(file.size)}</span></div>`);
            rows.push(`<div class="b-row"><span>Last modified</span><span>${fmtTime(file.lastModified)}</span></div>`);
            // Parse and compare record counts
            try {
              const text = await file.text();
              const data = JSON.parse(text);
              const bk = {
                customers: (data.customers||[]).length, projects: (data.projects||[]).length,
                quotations: (data.quotations||[]).length, invoices: (data.invoices||[]).length,
                payments: (data.payments||[]).length, receipts: (data.receipts||[]).length,
                expenses: (data.expenses||[]).length
              };
              const ok = Object.keys(counts).every(k => bk[k] === counts[k]);
              rows.push(`<div class="b-row"><span>Backup record counts</span><span class="${ok?'b-ok':'b-warn'}">${ok?'✅ matches current data':'⚠️ differs from current data'}</span></div>`);
              rows.push(`<div class="b-row"><span>&nbsp;&nbsp;• Customers</span><span>${bk.customers} (now ${counts.customers})</span></div>`);
              rows.push(`<div class="b-row"><span>&nbsp;&nbsp;• Projects</span><span>${bk.projects} (now ${counts.projects})</span></div>`);
              rows.push(`<div class="b-row"><span>&nbsp;&nbsp;• Invoices</span><span>${bk.invoices} (now ${counts.invoices})</span></div>`);
              rows.push(`<div class="b-row"><span>&nbsp;&nbsp;• Payments</span><span>${bk.payments} (now ${counts.payments})</span></div>`);
              rows.push(`<div class="b-row"><span>&nbsp;&nbsp;• Receipts</span><span>${bk.receipts} (now ${counts.receipts})</span></div>`);
              rows.push(`<div class="b-row"><span>&nbsp;&nbsp;• Expenses</span><span>${bk.expenses} (now ${counts.expenses})</span></div>`);
              if (data.exported_at) rows.push(`<div class="b-row"><span>Exported timestamp (in file)</span><span>${fmtTime(data.exported_at)}</span></div>`);
            } catch (e) {
              rows.push(`<div class="b-row"><span>JSON parse</span><span class="b-err">❌ Backup file is corrupted: ${escapeHtml(e.message)}</span></div>`);
            }
          }
        }
      } else {
        rows.push(`<div class="b-row"><span>Permission</span><span class="b-warn">⚠️ Folder read access not granted</span></div>`);
      }
    } catch (err) {
      rows.push(`<div class="b-row"><span>Verify error</span><span class="b-err">${escapeHtml(err.message||String(err))}</span></div>`);
    }
  } else if (!('showDirectoryPicker' in window)) {
    rows.push(`<div class="b-row"><span>Browser support</span><span class="b-warn">File System Access not supported — use Chrome / Edge / Brave for auto-backup</span></div>`);
  }

  panel.innerHTML = rows.join('');
}

async function restoreBackupDirectoryHandle() {
  updateBackupLocationHint();
  if (!('showDirectoryPicker' in window)) return;
  try {
    const saved = await dbGet('meta', 'backup_dir_handle');
    if (saved?.value) backupDirectoryHandle = saved.value;
  } catch (err) {
    console.warn('Backup directory handle restore failed', err);
  }
  updateBackupLocationHint();
}

async function rememberBackupDirectoryHandle(handle) {
  backupDirectoryHandle = handle;
  updateBackupLocationHint();
  try {
    await dbPut('meta', { key: 'backup_dir_handle', value: handle });
  } catch (err) {
    console.warn('Backup directory handle persistence failed', err);
  }
}

async function chooseBackupFolder() {
  if (!('showDirectoryPicker' in window)) {
    return toast('Use latest Chrome or Edge for direct app-folder backup', 'error');
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await rememberBackupDirectoryHandle(handle);
    toast('App folder selected. Backup folder will be used automatically.', 'success');
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error(err);
      toast('Could not access selected folder', 'error');
    }
  }
}

async function ensureBackupRootHandle() {
  if (!('showDirectoryPicker' in window)) return null;
  let handle = backupDirectoryHandle;
  if (!handle) {
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await rememberBackupDirectoryHandle(handle);
  }
  if (handle.queryPermission) {
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted' && handle.requestPermission) {
      permission = await handle.requestPermission({ mode: 'readwrite' });
    }
    if (permission !== 'granted') throw new Error('backup_permission_denied');
  }
  return handle;
}

async function saveBackupInsideAppFolder(serializedData) {
  const rootHandle = await ensureBackupRootHandle();
  if (!rootHandle) return null;
  const backupHandle = await rootHandle.getDirectoryHandle('backup', { create: true });
  let fileName = 'studio-backup-latest.json';

  try {
    const fileHandle = await backupHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: false });
    await writable.write(serializedData);
    await writable.close();
  } catch (err) {
    fileName = `studio-backup-${fullDateLabel()}.json`;
    const fileHandle = await backupHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: false });
    await writable.write(serializedData);
    await writable.close();
  }

  updateBackupLocationHint(fileName);
  return fileName;
}

function buildBackupPayload() {
  const data = {
    version: 1, exported_at: new Date().toISOString(),
    customers, projects, quotations, invoices, payments, expenses, receipts, settings, activities
  };
  return JSON.stringify(data, null, 2);
}

/* ---- Silent auto-backup (every 5 minutes) ---- */
async function autoBackupTick() {
  try {
    // Only run if user has already chosen the app folder once
    if (!('showDirectoryPicker' in window)) return;
    if (!backupDirectoryHandle) return;

    // Check permission silently — do NOT prompt the user mid-session
    if (backupDirectoryHandle.queryPermission) {
      const permission = await backupDirectoryHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        const hint = $('backupLocationHint');
        if (hint) hint.textContent = '⚠️ Auto-backup paused — click "Export Backup" once to re-grant folder permission.';
        return;
      }
    }

    const serialized = buildBackupPayload();
    const backupHandle = await backupDirectoryHandle.getDirectoryHandle('backup', { create: true });
    const fileHandle = await backupHandle.getFileHandle('studio-backup-latest.json', { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: false });
    await writable.write(serialized);
    await writable.close();

    lastAutoBackupAt = new Date();
    const hint = $('backupLocationHint');
    if (hint) {
      const t = lastAutoBackupAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      hint.textContent = `✅ Auto-backup ON (every 5 min) → "${backupDirectoryHandle.name}"/backup/studio-backup-latest.json · last saved ${t}`;
    }
    // Remember last auto-backup time across sessions
    try { await dbPut('meta', { key:'last_auto_backup_at', value: lastAutoBackupAt.toISOString() }); } catch(e){}
  } catch (err) {
    console.warn('Auto-backup failed', err);
    const hint = $('backupLocationHint');
    if (hint) hint.textContent = '⚠️ Auto-backup failed — click "Export Backup" once to re-grant permission.';
  }
}

function startAutoBackup() {
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  // First run after 30s (gives the app time to fully load), then every 5 minutes
  setTimeout(autoBackupTick, 30 * 1000);
  autoBackupTimer = setInterval(autoBackupTick, AUTO_BACKUP_INTERVAL_MS);
}

async function exportBackup() {
  const serialized = buildBackupPayload();

  if ('showDirectoryPicker' in window) {
    try {
      const savedFile = await saveBackupInsideAppFolder(serialized);
      if (savedFile) {
        toast(`Backup saved in backup/${savedFile}`, 'success');
        return;
      }
    } catch (err) {
      if (err?.name !== 'AbortError') console.error(err);
    }
  }

  const blob = new Blob([serialized], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `studio-backup-latest.json`;
  a.click();
  URL.revokeObjectURL(url);
  updateBackupLocationHint();
  toast('Backup downloaded as studio-backup-latest.json', 'success');
}

async function importBackup() {
  const f = $('importFile').files[0];
  if (!f) return toast('Choose a backup file','error');
  if (!confirm('This will REPLACE all current data. Continue?')) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const d = JSON.parse(reader.result);
      for (const s of STORES) await dbClear(s);
      for (const c of (d.customers||[])) { delete c.id_dup; await dbAdd('customers', c); }
      for (const p of (d.projects||[])) await dbAdd('projects', p);
      for (const q of (d.quotations||[])) await dbAdd('quotations', q);
      for (const i of (d.invoices||[])) await dbAdd('invoices', i);
      for (const p of (d.payments||[])) await dbAdd('payments', p);
      for (const e of (d.expenses||[])) await dbAdd('expenses', e);
      for (const r of (d.receipts||[])) await dbAdd('receipts', r);
      if (d.settings) await dbPut('settings', { key:'company', value: d.settings });
      if (d.activities) await dbPut('meta', { key:'activities', value: d.activities });
      await loadAll();
      loadSettingsForm(); renderDashboard(); renderCustomers(); renderProjects();
      renderQuotations(); renderInvoices(); renderPayments(); renderReceipts(); renderExpenses();
      toast('Backup restored successfully','success');
    } catch(e) { console.error(e); toast('Invalid backup file','error'); }
  };
  reader.readAsText(f);
}

async function resetAll() {
  if (!confirm('⚠️ Delete ALL data permanently? This cannot be undone.')) return;
  if (!confirm('Really sure? Final confirmation.')) return;
  for (const s of STORES) await dbClear(s);
  await loadAll();
  loadSettingsForm(); renderDashboard(); renderCustomers(); renderProjects();
  renderQuotations(); renderInvoices(); renderPayments(); renderReceipts(); renderExpenses();
  toast('All data erased','success');
}

/* ===================== Init ===================== */
(async function init() {
  const t = localStorage.getItem('sbm_theme') || 'light';
  document.body.dataset.theme = t;
  $('themeToggle').textContent = t==='dark' ? '☀️ Light Mode' : '🌙 Dark Mode';

  await openDB();

  /* ----- FIRST-RUN: if IndexedDB is empty, bootstrap from bundled data/db.json (seed) ----- */
  try {
    const existingCustomers = await dbAll('customers');
    const existingInvoices  = await dbAll('invoices');
    const seeded = localStorage.getItem('fmbiz_seeded_v1') === '1';
    if (!seeded && existingCustomers.length === 0 && existingInvoices.length === 0) {
      try {
        const resp = await fetch('data/db.json', { cache: 'no-store' });
        if (resp.ok) {
          const seedData = await resp.json();
          if (seedData && (seedData.customers?.length || seedData.invoices?.length)) {
            await applyCloudPayload(seedData);
            localStorage.setItem('fmbiz_seeded_v1', '1');
            console.log('[FmBiz] Seeded IndexedDB from data/db.json');
          }
        }
      } catch(e) { console.warn('Seed bootstrap skipped:', e.message); }
    }
  } catch(e) { console.warn('seed check error', e); }

  /* ----- CLOUD: pull latest from GitHub BEFORE loading data ----- */
  if (window.CLOUD && window.CLOUD.isConfigured()) {
    setCloudPill('sync', '⏳ Pulling…');
    try {
      const d = await window.CLOUD.pull();
      if (d) {
        await applyCloudPayload(d);
        toast('☁️ Cloud se latest data load ho gaya', 'success');
      } else {
        // first time push from seed data
        const payload = await buildCloudPayload();
        await window.CLOUD.pushNow(payload);
        toast('☁️ Pehli baar cloud me upload ho gaya', 'success');
      }
      setCloudPill('ok');
    } catch(err) {
      console.warn('Cloud pull failed', err);
      setCloudPill('err', '☁️ Sync error');
      toast('⚠️ Cloud sync error: ' + (err.message||err), 'error');
    }
  }

  await loadAll();
  // Auto-generate any recurring invoices that have fallen due
  try {
    const n = await autoGenerateRecurringInvoices();
    if (n) toast(`🔄 ${n} recurring invoice(s) auto-generated`, 'success');
  } catch(e) { console.warn('recurring gen failed', e); }
  await restoreBackupDirectoryHandle();
  // Restore last auto-backup timestamp from previous session
  try {
    const lab = await dbGet('meta', 'last_auto_backup_at');
    if (lab?.value) lastAutoBackupAt = new Date(lab.value);
  } catch(e){}
  loadSettingsForm();
  renderDashboard();
  startAutoBackup();

  /* ----- CLOUD: wire up the UI ----- */
  initCloudUI();

  /* ----- CLOUD: flush pending push before user closes the tab ----- */
  window.addEventListener('beforeunload', () => {
    if (window.CLOUD && window.CLOUD.pendingPush()) {
      // best-effort synchronous flush via sendBeacon? 
      // GitHub PUT can't use beacon (needs auth header) — but the timer is short (3s)
      // so risk is small. Show a confirmation if there's a pending push:
    }
  });
})();

/* ===================== CLOUD UI ===================== */
function setCloudPill(state, label) {
  const pill = document.getElementById('cloudPill');
  const mini = document.getElementById('cloudStatusMini');
  if (!pill) return;
  pill.classList.remove('cloud-off','cloud-ok','cloud-sync','cloud-err','cloud-pending');
  let cls = 'cloud-off', text = '☁️ Offline';
  switch(state) {
    case 'ok':      cls='cloud-ok';      text = label || '☁️ Synced'; break;
    case 'sync':    cls='cloud-sync';    text = label || '☁️ Syncing…'; break;
    case 'pending': cls='cloud-pending'; text = label || '☁️ Pending'; break;
    case 'err':     cls='cloud-err';     text = label || '⚠️ Error'; break;
    default:        cls='cloud-off';     text = label || '☁️ Offline';
  }
  pill.classList.add(cls);
  pill.textContent = text;
  if (mini) mini.textContent = text === '☁️ Offline' ? '☁️ Sync: not configured' : text;
}

function updateCloudIndicator() {
  if (!window.CLOUD) return;
  const st = window.CLOUD.getState();
  if (!st.configured) { setCloudPill('off'); return; }
  if (st.pushing) { setCloudPill('sync', '☁️ Syncing…'); return; }
  if (window.CLOUD.pendingPush()) { setCloudPill('pending', '☁️ Saving soon…'); return; }
  if (st.lastError) { setCloudPill('err', '⚠️ Sync error'); return; }
  if (st.lastSyncedAt) {
    const t = st.lastSyncedAt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    setCloudPill('ok', `☁️ Saved ${t}`);
  } else {
    setCloudPill('ok', '☁️ Connected');
  }
}

function renderCloudStatusPanel() {
  const el = document.getElementById('cloudStatus');
  if (!el || !window.CLOUD) return;
  const st = window.CLOUD.getState();
  const rows = [];
  rows.push(`<div class="b-row"><span>Configured</span><span class="${st.configured?'b-ok':'b-warn'}">${st.configured?'✅ Yes':'⚠️ No — niche form bharo'}</span></div>`);
  if (st.configured) {
    rows.push(`<div class="b-row"><span>Repository</span><span>${st.cfg.owner}/${st.cfg.repo} · ${st.cfg.branch}</span></div>`);
    rows.push(`<div class="b-row"><span>Data file</span><span>${st.cfg.path}</span></div>`);
    rows.push(`<div class="b-row"><span>Last pulled</span><span>${st.lastPullAt ? st.lastPullAt.toLocaleString('en-IN') : '—'}</span></div>`);
    rows.push(`<div class="b-row"><span>Last synced (push)</span><span class="${st.lastSyncedAt?'b-ok':''}">${st.lastSyncedAt ? st.lastSyncedAt.toLocaleString('en-IN') : '—'}</span></div>`);
    rows.push(`<div class="b-row"><span>Push status</span><span>${st.pushing ? '⏳ Pushing…' : (window.CLOUD.pendingPush() ? '🟡 Pending (3s debounce)' : '✅ Idle')}</span></div>`);
    if (st.lastError) rows.push(`<div class="b-row"><span>Last error</span><span class="b-err">${st.lastError}</span></div>`);
  }
  el.innerHTML = rows.join('');
}

function initCloudUI() {
  if (!window.CLOUD) return;
  // Pre-fill config form
  const c = window.CLOUD.getRawCfg();
  if (c) {
    const o=$('cloud_owner'), r=$('cloud_repo'), b=$('cloud_branch'), p=$('cloud_path'), t=$('cloud_token');
    if (o) o.value = c.owner;
    if (r) r.value = c.repo;
    if (b) b.value = c.branch || 'main';
    if (p) p.value = c.path  || 'data/db.json';
    if (t) t.placeholder = '•••••• (already saved — paste again to update)';
  }
  window.CLOUD.onChange(() => { updateCloudIndicator(); renderCloudStatusPanel(); });
  updateCloudIndicator();
  renderCloudStatusPanel();
}

async function cloudSaveConfig() {
  const owner = ($('cloud_owner').value||'').trim();
  const repo  = ($('cloud_repo').value||'').trim();
  const branch= ($('cloud_branch').value||'main').trim() || 'main';
  const path  = ($('cloud_path').value||'data/db.json').trim() || 'data/db.json';
  let token   = ($('cloud_token').value||'').trim();
  if (!owner || !repo) return toast('Username aur Repo name bharo','error');
  // If user left token blank but already had one saved, keep the old one
  if (!token) {
    const old = window.CLOUD.getRawCfg();
    if (old?.token) token = old.token;
    else return toast('Personal Access Token bharo','error');
  }
  const cfg = { owner, repo, branch, path, token };
  try {
    await window.CLOUD.testConnection(cfg);
  } catch(err) {
    return toast('❌ ' + err.message, 'error');
  }
  window.CLOUD.saveCfg(cfg);
  toast('✅ Connected to GitHub','success');
  // Immediately pull (or push if remote is empty)
  try {
    const d = await window.CLOUD.pull();
    if (d) {
      if (!confirm('Cloud me pehle se data hai. Cloud ka data is device pe load karu? (Cancel = is device ka data cloud pe push karu)')) {
        const payload = await buildCloudPayload();
        await window.CLOUD.pushNow(payload);
        toast('☁️ Local data cloud pe push ho gaya','success');
      } else {
        await applyCloudPayload(d);
        await loadAll();
        loadSettingsForm(); renderDashboard(); renderCustomers(); renderProjects();
        renderQuotations(); renderInvoices(); renderPayments(); renderReceipts(); renderExpenses();
        toast('☁️ Cloud data is device pe load ho gaya','success');
      }
    } else {
      // remote empty → push current
      const payload = await buildCloudPayload();
      await window.CLOUD.pushNow(payload);
      toast('☁️ Pehli baar cloud me upload ho gaya','success');
    }
  } catch(err) {
    toast('Cloud sync error: '+err.message,'error');
  }
  renderCloudStatusPanel();
  $('cloud_token').value = '';
}

async function cloudTest() {
  if (!window.CLOUD.isConfigured()) return toast('Pehle config save karo','error');
  try {
    await window.CLOUD.testConnection();
    toast('✅ Connection OK','success');
  } catch(err) {
    toast('❌ '+err.message,'error');
  }
}

async function cloudPullNow() {
  if (!window.CLOUD.isConfigured()) return toast('Pehle config save karo','error');
  if (!confirm('Cloud se latest data pull karke is device ka data replace karu?')) return;
  try {
    setCloudPill('sync','⏳ Pulling…');
    const d = await window.CLOUD.pull();
    if (!d) { toast('Cloud me data file nahi hai','error'); return; }
    await applyCloudPayload(d);
    await loadAll();
    loadSettingsForm(); renderDashboard(); renderCustomers(); renderProjects();
    renderQuotations(); renderInvoices(); renderPayments(); renderReceipts(); renderExpenses();
    toast('☁️ Pull complete','success');
    updateCloudIndicator();
  } catch(err) { toast('Pull failed: '+err.message,'error'); setCloudPill('err'); }
}

async function cloudPushNow() {
  if (!window.CLOUD.isConfigured()) return toast('Pehle config save karo','error');
  try {
    setCloudPill('sync','⏳ Pushing…');
    const payload = await buildCloudPayload();
    await window.CLOUD.pushNow(payload);
    toast('☁️ Push complete','success');
    updateCloudIndicator();
  } catch(err) { toast('Push failed: '+err.message,'error'); setCloudPill('err'); }
}

function cloudDisconnect() {
  if (!confirm('Cloud sync disconnect karu? (Token is device se hat jayega, data safe hi rahega)')) return;
  window.CLOUD.clearCfg();
  toast('Disconnected','success');
  ['cloud_owner','cloud_repo','cloud_branch','cloud_path','cloud_token'].forEach(id => { if($(id)) $(id).value = id==='cloud_branch'?'main':(id==='cloud_path'?'data/db.json':''); });
  $('cloud_token').placeholder = 'ghp_xxxxxxxxxxxxxxxxxxxx';
  setCloudPill('off');
  renderCloudStatusPanel();
}

function cloudShowSetupGuide() {
  const p = document.getElementById('cloudGuidePanel');
  if (!p) return;
  p.style.display = (p.style.display === 'none' || !p.style.display) ? 'block' : 'none';
  if (p.style.display === 'block') p.scrollIntoView({behavior:'smooth', block:'start'});
}
