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

  if (panelId === 'users-tab') renderUsersList(adminUsers);
  if (panelId === 'products-tab') renderProductsFeed(adminProducts);
  if (panelId === 'monitor-tab') calculateMonitorStats();
}

// ================= 3. MINI MARKET MONITOR & STATS =================
function calculateMonitorStats() {
  const gmv = adminProducts
    .filter(p => p.approved)
    .reduce((sum, item) => sum + Number(item.price || 0), 0);

  const pendingProducts = adminProducts.filter(p => !p.approved).length;
  const pendingUsers = adminUsers.filter(u => !u.can_sell).length;
  const approvedListings = adminProducts.filter(p => p.approved).length;
  const allowedSellers = adminUsers.filter(u => u.can_sell).length;

  document.getElementById('stat-gmv').innerText = `₦${gmv.toLocaleString()}`;
  document.getElementById('stat-revenue').innerText = `${pendingProducts + pendingUsers}`;
  document.getElementById('stat-listings-count').innerText = approvedListings;
  document.getElementById('stat-sellers-count').innerText = `${allowedSellers} / ${adminUsers.length}`;
}

async function refreshAdminData() {
  try {
    const [{ users }, { products }] = await Promise.all([
      callAdminApi('list-users'),
      callAdminApi('list-products')
    ]);
    adminUsers = users;
    adminProducts = products;
    calculateMonitorStats();
    renderUsersList(adminUsers);
    renderProductsFeed(adminProducts);
    showToast("Admin data synced with UNN nodes.");
  } catch (err) {
    showToast(err.message || "Could not refresh admin data.");
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
    renderUsersList(adminUsers);
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

  grid.innerHTML = productsToRender.map(item => `
    <div class="admin-prod-card">
      <img src="${item.image}" alt="${item.title}" class="admin-prod-thumb" onerror="this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80'">
      <div class="admin-prod-info">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
          <h5>${item.title}</h5>
          <span class="tier-badge ${item.approved ? 'pro' : 'free'}" style="white-space:nowrap;">${item.approved ? 'Live' : 'Pending'}</span>
        </div>
        <p>${item.seller ? item.seller.display_name : 'Unknown seller'} • ${item.location}</p>
        <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">Seller asked ₦${Number(item.price).toLocaleString()}</div>
        <div style="display:flex; align-items:center; gap:4px; margin-top:6px; background:rgba(255,255,255,0.06); border:1px solid var(--border-glass); border-radius:8px; padding:6px 10px;">
          <span style="font-size:12px; color:var(--text-muted);">₦</span>
          <input type="number" id="price-${item.id}" value="${item.price}" min="0" step="1"
                 style="background:transparent; border:none; outline:none; color:#fff; font-size:13px; font-weight:700; width:100%;">
        </div>
      </div>
      <div class="admin-prod-actions">
        ${item.approved
          ? `<button class="btn-action-icon" style="color: var(--neon-cyan); border-color: var(--neon-cyan);" onclick="savePrice('${item.id}')"><i class="fa-solid fa-floppy-disk"></i> Save Price</button>`
          : `<button class="btn-action-icon" style="color: var(--neon-green); border-color: var(--neon-green);" onclick="approveProduct('${item.id}')"><i class="fa-solid fa-check"></i> Approve</button>`
        }
        <button class="btn-action-icon delete" onclick="deleteItemAdmin('${item.id}')">
          <i class="fa-solid fa-trash"></i> Remove
        </button>
      </div>
    </div>
  `).join('');
}

async function approveProduct(id) {
  const input = document.getElementById(`price-${id}`);
  const price = input ? input.value : undefined;
  try {
    const { product } = await callAdminApi('approve-product', { productId: id, price });
    adminProducts = adminProducts.map(p => (p.id === id ? { ...p, ...product } : p));
    renderProductsFeed(adminProducts);
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
    renderProductsFeed(adminProducts);
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
    renderProductsFeed(adminProducts);
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

// ================= 6. HELPERS =================
function showToast(text) {
  const toast = document.getElementById('toast');
  toast.innerText = text;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2400);
}
