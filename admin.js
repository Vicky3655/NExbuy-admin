// ============================================================
// Nexbuy Admin — now backed by real data via the admin-api Edge
// Function, instead of a hardcoded PIN and a localStorage array that
// had no connection to the live app at all.
//
// The passphrase is never checked in this file. It's sent to
// admin-api on every request, which compares it against the
// ADMIN_SECRET secret server-side — the only place that comparison
// happens. This file only ever sees whatever the admin typed in.
// ============================================================

// TODO: same project as app.js — Project Settings -> API
const SUPABASE_URL = "https://tartoasyifwxgfgfurep.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcnRvYXN5aWZ3eGdmZ2Z1cmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MDQzODcsImV4cCI6MjA5OTk4MDM4N30.TUjeSDs0zCCPiPtGjOBxghjOIyZfkga8nLoV39Fbj6k";

let adminUsers = [];
let adminProducts = [];

// Kept only for this tab session (sessionStorage clears when the tab
// closes) — resent with every admin-api call since there's no separate
// login/session token, just the passphrase itself.
let adminSecret = sessionStorage.getItem('nexbuy_admin_secret') || null;

// ================= LIVE NOTIFICATIONS STATE =================
// Everything here is derived purely from admin-api's existing
// list-users / list-products responses — no new backend endpoints,
// just polling the same data the dashboard already fetches and
// diffing it against what this session has already seen.
let notifications = [];
const knownProductIds = new Set();
const knownPendingUserIds = new Set();
let hasNotifBaseline = false; // becomes true once we've seen one full data set
let pollTimer = null;
let isRefreshing = false;
const POLL_INTERVAL_MS = 25000; // how often we quietly check for new listings/sellers

async function callAdminApi(action, extra) {
  if (SUPABASE_URL.includes('YOUR-PROJECT-REF') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
    throw new Error('admin.js still has placeholder Supabase values — set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/admin-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ adminSecret, action, ...extra })
    });
  } catch (err) {
    throw new Error(`Could not reach Supabase (${err.message}).`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data.error || data.message || `HTTP ${response.status}`;
    throw new Error(reason);
  }
  return data;
}

// ================= 1. PIN / PASSPHRASE AUTHENTICATION =================
async function unlockAdmin(e) {
  e.preventDefault();
  const entered = document.getElementById('admin-pin-input').value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  adminSecret = entered;
  try {
    // list-users doubles as the "is this passphrase correct" check —
    // if it's wrong, admin-api rejects it before touching any data.
    const { users } = await callAdminApi('list-users');
    adminUsers = users;
    sessionStorage.setItem('nexbuy_admin_secret', adminSecret);

    document.getElementById('admin-lock-screen').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    showToast("SuperAdmin Access Granted!");
    await refreshAdminData();
    startNotifPolling();
  } catch (err) {
    adminSecret = null;
    showToast(err.message || "Incorrect Admin Passphrase. Access Denied!");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function lockAdmin() {
  adminSecret = null;
  sessionStorage.removeItem('nexbuy_admin_secret');
  stopNotifPolling();
  resetNotifState();
  document.getElementById('admin-app').classList.add('hidden');
  document.getElementById('admin-lock-screen').classList.remove('hidden');
  document.getElementById('admin-pin-input').value = "";
  showToast("Admin Portal Locked.");
}

// Auto-login if a passphrase is already cached for this tab session —
// still re-validated against admin-api, not just trusted blindly.
document.addEventListener('DOMContentLoaded', async () => {
  if (!adminSecret) return;
  try {
    const { users } = await callAdminApi('list-users');
    adminUsers = users;
    document.getElementById('admin-lock-screen').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    await refreshAdminData();
    startNotifPolling();
  } catch {
    // Cached passphrase no longer works — fall back to the lock screen.
    adminSecret = null;
    sessionStorage.removeItem('nexbuy_admin_secret');
  }
});

// ================= 2. TAB SWITCHER =================
function switchAdminTab(panelId) {
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(panelId).classList.add('active');

  const tabIndex = {
    'monitor-tab': 0,
    'users-tab': 1,
    'products-tab': 2
  };
  document.querySelectorAll('.tab-btn')[tabIndex[panelId]].classList.add('active');

  if (panelId === 'users-tab') filterUsersList();
  if (panelId === 'products-tab') filterProductsList();
  if (panelId === 'monitor-tab') calculateMonitorStats();
}

// ================= 3. MINI MARKET MONITOR & STATS =================
function calculateMonitorStats() {
  const gmv = adminProducts
    .filter(p => p.approved)
    .reduce((sum, item) => sum + Number(item.price || 0), 0);

  const pendingProducts = adminProducts.filter(p => !p.approved).length;
  const pendingUsers = adminUsers.filter(u => !u.can_sell).length;
  const activeListings = adminProducts.filter(p => p.approved && !p.sold).length;
  const allowedSellers = adminUsers.filter(u => u.can_sell).length;

  document.getElementById('stat-gmv').innerText = `₦${gmv.toLocaleString()}`;
  document.getElementById('stat-revenue').innerText = `${pendingProducts + pendingUsers}`;
  document.getElementById('stat-listings-count').innerText = activeListings;
  document.getElementById('stat-sellers-count').innerText = `${allowedSellers} / ${adminUsers.length}`;

  renderLocationDistribution();
}

async function refreshAdminData(options) {
  const silent = !!(options && options.silent);
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    const [{ users }, { products }] = await Promise.all([
      callAdminApi('list-users'),
      callAdminApi('list-products')
    ]);

    detectNewPendingItems(users, products);

    adminUsers = users;
    adminProducts = products;
    calculateMonitorStats();
    filterUsersList();
    filterProductsList();
    if (!silent) showToast("Admin data synced with UNN nodes.");
  } catch (err) {
    if (!silent) showToast(err.message || "Could not refresh admin data.");
  } finally {
    isRefreshing = false;
  }
}

// ================= 4. SELLER APPROVAL =================
function renderUsersList(usersToRender) {
  const container = document.getElementById('users-card-list');

  if (usersToRender.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">No student users found.</div>`;
    return;
  }

  container.innerHTML = usersToRender.map(user => `
    <div class="user-row-card">
      <div class="user-main-info">
        <div>
          <h5>${user.display_name || 'UNN Student'}</h5>
          <p><i class="fa-solid fa-location-dot"></i> ${user.location || 'No hostel set'} • <i class="fa-brands fa-telegram"></i> ${user.telegram_username ? '@' + user.telegram_username : 'no username'}</p>
        </div>
        <span class="tier-badge ${user.can_sell ? 'pro' : 'free'}">
          ${user.can_sell ? 'Approved' : 'Pending'}
        </span>
      </div>

      <div class="user-controls" style="grid-template-columns: 1fr;">
        <button class="btn-ctrl ${user.can_sell ? 'block' : 'allow'}" onclick="toggleSellPermission('${user.id}', ${!user.can_sell})">
          <i class="fa-solid ${user.can_sell ? 'fa-circle-xmark' : 'fa-circle-check'}"></i>
          <span>${user.can_sell ? 'Suspend Selling' : 'Approve to Sell'}</span>
        </button>
      </div>
    </div>
  `).join('');
}

async function toggleSellPermission(userId, nextCanSell) {
  try {
    const { user } = await callAdminApi('set-can-sell', { userId, canSell: nextCanSell });
    adminUsers = adminUsers.map(u => (u.id === userId ? user : u));
    filterUsersList();
    calculateMonitorStats();
    showToast(`${user.display_name}: selling ${nextCanSell ? 'APPROVED' : 'SUSPENDED'}.`);
  } catch (err) {
    showToast(err.message || "Couldn't update that user.");
  }
}

function filterUsersList() {
  const q = document.getElementById('user-search').value.toLowerCase();
  const filtered = adminUsers.filter(u =>
    (u.display_name || '').toLowerCase().includes(q) ||
    (u.location || '').toLowerCase().includes(q) ||
    (u.telegram_username || '').toLowerCase().includes(q)
  );
  renderUsersList(filtered);
}

// ================= 5. LISTING APPROVAL =================
function renderProductsFeed(productsToRender) {
  const grid = document.getElementById('admin-products-grid');

  if (productsToRender.length === 0) {
    grid.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">No products to moderate.</div>`;
    return;
  }

  grid.innerHTML = productsToRender.map(item => {
    const statusLabel = item.sold ? 'Sold' : (item.approved ? 'Live' : 'Pending');
    const statusStyle = item.sold
      ? 'background: rgba(34,197,94,0.15); color: var(--neon-green);'
      : '';

    let actionButtons;
    if (item.sold) {
      actionButtons = `<span class="btn-action-icon" style="color: var(--neon-green); border-color: var(--neon-green); cursor: default;"><i class="fa-solid fa-circle-check"></i> Sold</span>`;
    } else if (item.approved) {
      actionButtons = `
        <button class="btn-action-icon" style="color: var(--neon-cyan); border-color: var(--neon-cyan);" onclick="savePrice('${item.id}')"><i class="fa-solid fa-floppy-disk"></i> Save Price</button>
        <button class="btn-action-icon" style="color: var(--neon-magenta); border-color: var(--neon-magenta);" onclick="markSold('${item.id}')"><i class="fa-solid fa-bullhorn"></i> Confirm Payment</button>
      `;
    } else {
      actionButtons = `<button class="btn-action-icon" style="color: var(--neon-green); border-color: var(--neon-green);" onclick="approveProduct('${item.id}')"><i class="fa-solid fa-check"></i> Approve</button>`;
    }

    return `
    <div class="admin-prod-card">
      <img src="${item.image}" alt="${item.title}" class="admin-prod-thumb" onerror="this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80'">
      <div class="admin-prod-info">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
          <h5>${item.title}</h5>
          <span class="tier-badge ${item.approved && !item.sold ? 'pro' : 'free'}" style="white-space:nowrap; ${statusStyle}">${statusLabel}</span>
        </div>
        <p>${item.seller ? item.seller.display_name : 'Unknown seller'} • ${item.location}</p>
        <p style="font-size:10px; color:var(--neon-cyan); margin-top:2px;"><i class="fa-brands fa-telegram"></i> Seller contact: ${item.contact}</p>
        <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">Seller asked ₦${Number(item.price).toLocaleString()}</div>
        <div style="display:flex; align-items:center; gap:4px; margin-top:6px; background:rgba(255,255,255,0.06); border:1px solid var(--border-glass); border-radius:8px; padding:6px 10px;">
          <span style="font-size:12px; color:var(--text-muted);">₦</span>
          <input type="number" id="price-${item.id}" value="${item.price}" min="0" step="1" ${item.sold ? 'disabled' : ''}
                 style="background:transparent; border:none; outline:none; color:#fff; font-size:13px; font-weight:700; width:100%;">
        </div>
      </div>
      <div class="admin-prod-actions">
        ${actionButtons}
        <button class="btn-action-icon delete" onclick="deleteItemAdmin('${item.id}')">
          <i class="fa-solid fa-trash"></i> Remove
        </button>
      </div>
    </div>
  `;
  }).join('');
}

async function markSold(id) {
  if (!confirm("Confirm payment received for this item? This marks it SOLD and announces it to your Telegram group.")) return;
  try {
    const { product, announcementSent, announcementError } = await callAdminApi('mark-sold', { productId: id });
    adminProducts = adminProducts.map(p => (p.id === id ? { ...p, ...product } : p));
    filterProductsList();
    calculateMonitorStats();
    showToast(announcementSent
      ? `"${product.title}" marked SOLD and announced to the group!`
      : `Marked SOLD, but the announcement didn't send: ${announcementError || 'unknown reason'}`);
  } catch (err) {
    showToast(err.message || "Couldn't mark that as sold.");
  }
}

async function approveProduct(id) {
  const input = document.getElementById(`price-${id}`);
  const price = input ? input.value : undefined;
  try {
    const { product } = await callAdminApi('approve-product', { productId: id, price });
    adminProducts = adminProducts.map(p => (p.id === id ? { ...p, ...product } : p));
    filterProductsList();
    calculateMonitorStats();
    showToast(`"${product.title}" approved at ₦${Number(product.price).toLocaleString()} and now live.`);
  } catch (err) {
    showToast(err.message || "Couldn't approve that listing.");
  }
}

async function savePrice(id) {
  const input = document.getElementById(`price-${id}`);
  const price = input ? input.value : undefined;
  try {
    const { product } = await callAdminApi('update-price', { productId: id, price });
    adminProducts = adminProducts.map(p => (p.id === id ? { ...p, ...product } : p));
    filterProductsList();
    calculateMonitorStats();
    showToast(`Price updated to ₦${Number(product.price).toLocaleString()}.`);
  } catch (err) {
    showToast(err.message || "Couldn't update price.");
  }
}

async function deleteItemAdmin(id) {
  if (!confirm("Remove this listing from UNN Marketplace?")) return;
  try {
    await callAdminApi('delete-product', { productId: id });
    adminProducts = adminProducts.filter(p => p.id !== id);
    filterProductsList();
    calculateMonitorStats();
    showToast("Listing deleted by Admin.");
  } catch (err) {
    showToast(err.message || "Couldn't delete that listing.");
  }
}

function filterProductsList() {
  const q = document.getElementById('product-search').value.toLowerCase();
  const filtered = adminProducts.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.location.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q)
  );
  renderProductsFeed(filtered);
}

// ================= 6. TRADE ACTIVITY BY HOSTEL AREA (LIVE) =================
// Pulls straight from adminProducts (already fetched from admin-api's
// list-products) instead of the old hardcoded 40/35/15/10 split.
const LOCATION_CHART_COLORS = [
  'var(--gradient-main)',
  'var(--neon-magenta)',
  'var(--neon-cyan)',
  'var(--neon-amber)',
  'var(--neon-green)'
];
const LOCATION_CHART_MAX_ROWS = 4;

function renderLocationDistribution() {
  const container = document.getElementById('hostel-progress-list');
  const badge = document.getElementById('trade-activity-badge');
  if (!container) return;

  // "Trade activity" mirrors the GMV definition above: every listing
  // that's been approved, whether it's still live or already sold.
  const tradedProducts = adminProducts.filter(p => p.approved);

  if (badge) {
    badge.textContent = tradedProducts.length > 0
      ? `${tradedProducts.length} listing${tradedProducts.length === 1 ? '' : 's'} tracked`
      : 'Nsukka Campus';
  }

  if (tradedProducts.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:12px;">No approved listings yet — this fills in once you approve your first item.</div>`;
    return;
  }

  const counts = {};
  tradedProducts.forEach(p => {
    const key = (p.location || '').trim() || 'Unspecified Location';
    counts[key] = (counts[key] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, LOCATION_CHART_MAX_ROWS);
  const rest = sorted.slice(LOCATION_CHART_MAX_ROWS);

  const rows = [...top];
  if (rest.length > 0) {
    const otherCount = rest.reduce((sum, [, c]) => sum + c, 0);
    rows.push([`Other Areas (${rest.length})`, otherCount]);
  }

  const total = tradedProducts.length;

  container.innerHTML = rows.map(([label, count], i) => {
    const pct = Math.round((count / total) * 100);
    const color = LOCATION_CHART_COLORS[i % LOCATION_CHART_COLORS.length];
    return `
      <div class="progress-row">
        <div class="row-meta">
          <span>${label}</span>
          <strong>${pct}% <span style="color:var(--text-muted); font-weight:500;">(${count})</span></strong>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%; background:${color};"></div></div>
      </div>
    `;
  }).join('');
}

// ================= 7. LIVE NOTIFICATIONS =================
// Diffs each fresh admin-api response against what this session has
// already seen and raises a notification for anything genuinely new.
function detectNewPendingItems(newUsers, newProducts) {
  const pendingProducts = newProducts.filter(p => !p.approved);
  const pendingUsers = newUsers.filter(u => !u.can_sell);

  if (!hasNotifBaseline) {
    // First data pull after unlocking: record the existing backlog
    // silently so the admin isn't blasted with toasts for items that
    // were already sitting there before they logged in.
    pendingProducts.forEach(p => knownProductIds.add(p.id));
    pendingUsers.forEach(u => knownPendingUserIds.add(u.id));
    hasNotifBaseline = true;
    return;
  }

  pendingProducts.forEach(p => {
    if (knownProductIds.has(p.id)) return;
    knownProductIds.add(p.id);
    pushNotification({
      icon: 'fa-boxes-stacked',
      title: 'New listing to review',
      message: `${p.title} • ₦${Number(p.price || 0).toLocaleString()} • ${p.location || 'no hostel set'}`,
      targetTab: 'products-tab',
      targetSearch: p.title
    });
  });

  pendingUsers.forEach(u => {
    if (knownPendingUserIds.has(u.id)) return;
    knownPendingUserIds.add(u.id);
    pushNotification({
      icon: 'fa-user-plus',
      title: 'New seller request',
      message: `${u.display_name || 'UNN Student'} wants selling access`,
      targetTab: 'users-tab',
      targetSearch: u.display_name || ''
    });
  });

  // Stop tracking anything that's left the pending state (approved,
  // rejected, suspended elsewhere) so the "known" sets don't grow forever.
  const stillPendingProductIds = new Set(pendingProducts.map(p => p.id));
  [...knownProductIds].forEach(id => {
    if (!stillPendingProductIds.has(id)) knownProductIds.delete(id);
  });
  const stillPendingUserIds = new Set(pendingUsers.map(u => u.id));
  [...knownPendingUserIds].forEach(id => {
    if (!stillPendingUserIds.has(id)) knownPendingUserIds.delete(id);
  });
}

function pushNotification({ icon, title, message, targetTab, targetSearch }) {
  notifications.unshift({
    id: `n${Date.now()}${Math.random().toString(16).slice(2)}`,
    icon: icon || 'fa-bell',
    title,
    message,
    targetTab,
    targetSearch,
    time: new Date()
  });
  if (notifications.length > 20) notifications.length = 20;
  renderNotifPanel();
  updateNotifBadge();
  showToast(`🔔 ${title}: ${message}`);
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const count = notifications.length;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderNotifPanel() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  if (notifications.length === 0) {
    list.innerHTML = `<div class="notif-empty">You're all caught up — no notifications yet.</div>`;
    return;
  }

  list.innerHTML = notifications.map(n => `
    <button class="notif-item" onclick="openNotification('${n.id}')">
      <div class="notif-icon"><i class="fa-solid ${n.icon}"></i></div>
      <div class="notif-body">
        <strong>${n.title}</strong>
        <span>${n.message}</span>
        <small>${timeAgo(n.time)}</small>
      </div>
    </button>
  `).join('');
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (panel) panel.classList.toggle('hidden');
}

function openNotification(id) {
  const notif = notifications.find(n => n.id === id);
  if (!notif) return;
  notifications = notifications.filter(n => n.id !== id);
  updateNotifBadge();
  renderNotifPanel();
  const panel = document.getElementById('notif-panel');
  if (panel) panel.classList.add('hidden');

  if (notif.targetTab) {
    switchAdminTab(notif.targetTab);
    if (notif.targetTab === 'products-tab' && notif.targetSearch) {
      const input = document.getElementById('product-search');
      if (input) { input.value = notif.targetSearch; filterProductsList(); }
    }
    if (notif.targetTab === 'users-tab' && notif.targetSearch) {
      const input = document.getElementById('user-search');
      if (input) { input.value = notif.targetSearch; filterUsersList(); }
    }
  }
}

function clearNotifications() {
  notifications = [];
  updateNotifBadge();
  renderNotifPanel();
}

function resetNotifState() {
  notifications = [];
  knownProductIds.clear();
  knownPendingUserIds.clear();
  hasNotifBaseline = false;
  updateNotifBadge();
  renderNotifPanel();
  const panel = document.getElementById('notif-panel');
  if (panel) panel.classList.add('hidden');
}

function startNotifPolling() {
  stopNotifPolling();
  pollTimer = setInterval(() => {
    if (document.hidden) return; // don't burn calls while the tab isn't visible
    refreshAdminData({ silent: true });
  }, POLL_INTERVAL_MS);
}

function stopNotifPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Catch up immediately when the admin comes back to this tab, rather
// than waiting up to POLL_INTERVAL_MS for the next tick.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && adminSecret) {
    refreshAdminData({ silent: true });
  }
});

// Close the notification dropdown on outside click / Escape.
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  const bellBtn = document.getElementById('btn-notif');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(e.target) && bellBtn && !bellBtn.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const panel = document.getElementById('notif-panel');
    if (panel) panel.classList.add('hidden');
  }
});

// ================= 8. HELPERS =================
function showToast(text) {
  const toast = document.getElementById('toast');
  toast.innerText = text;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2400);
}
