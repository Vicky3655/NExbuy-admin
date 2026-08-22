// Default UNN SuperAdmin Master PIN
const SUPERADMIN_PIN = "1960";

// Fallback Default UNN Users Database (Synced with Nexbuy App)
const fallbackUsers = [
  {
    id: "usr_1",
    name: "Chidubem Okeke",
    location: "Mary Slessor Hostel",
    phone: "08123456789",
    canSell: true,
    isMonetized: true,
    tier: "Pro Vendor (₦2,500/mo)"
  },
  {
    id: "usr_2",
    name: "Emeka Alozie",
    location: "Franco Hostel (UNN)",
    phone: "08087654321",
    canSell: true,
    isMonetized: false,
    tier: "Free Student"
  },
  {
    id: "usr_3",
    name: "Ngozi Eze",
    location: "Nkrumah Hostel",
    phone: "09011223344",
    canSell: false, // Suspended by admin
    isMonetized: false,
    tier: "Restricted"
  }
];

// Fallback Default UNN Products
const fallbackProducts = [
  {
    id: 1,
    sellerId: "usr_1",
    title: "GST 101 & 103 Textbook Pack",
    price: 3500,
    category: "Academics",
    location: "Mary Slessor Hostel",
    contact: "08123456789",
    image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80",
    desc: "Complete first year package with summarized past questions.",
    boosted: true
  },
  {
    id: 2,
    sellerId: "usr_2",
    title: "HP Pavilion 15 (8GB RAM / 256 SSD)",
    price: 185000,
    category: "Gadgets",
    location: "Franco Hostel (UNN)",
    contact: "08087654321",
    image: "https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=400&q=80",
    desc: "Battery health is good. Suitable for coding and assignments.",
    boosted: false
  },
  {
    id: 3,
    sellerId: "usr_1",
    title: "Vintage Denim Jacket",
    price: 7000,
    category: "Fashion",
    location: "Nkrumah Hostel",
    contact: "09011223344",
    image: "https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=400&q=80",
    desc: "Oversized, UNN campus style.",
    boosted: false
  }
];

// Load live data from shared LocalStorage
let adminUsers = JSON.parse(localStorage.getItem('nexbuy_users')) || fallbackUsers;
let adminProducts = JSON.parse(localStorage.getItem('nexbuy_products')) || fallbackProducts;

// ================= 1. PIN AUTHENTICATION =================
function unlockAdmin(e) {
  e.preventDefault();
  const enteredPin = document.getElementById('admin-pin-input').value.trim();

  if (enteredPin === SUPERADMIN_PIN) {
    document.getElementById('admin-lock-screen').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    sessionStorage.setItem('nexbuy_admin_auth', 'true');
    showToast("SuperAdmin Access Granted!");
    refreshAdminData();
  } else {
    showToast("Incorrect Admin PIN. Access Denied!");
  }
}

function lockAdmin() {
  sessionStorage.removeItem('nexbuy_admin_auth');
  document.getElementById('admin-app').classList.add('hidden');
  document.getElementById('admin-lock-screen').classList.remove('hidden');
  document.getElementById('admin-pin-input').value = "";
  showToast("Admin Portal Locked.");
}

// Auto-login if session exists
document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('nexbuy_admin_auth') === 'true') {
    document.getElementById('admin-lock-screen').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    refreshAdminData();
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
  // Pull fresh state from LocalStorage in case student app made changes
  adminUsers = JSON.parse(localStorage.getItem('nexbuy_users')) || fallbackUsers;
  adminProducts = JSON.parse(localStorage.getItem('nexbuy_products')) || fallbackProducts;

  // 1. Gross Merchandise Value
  const gmv = adminProducts.reduce((sum, item) => sum + Number(item.price || 0), 0);
  
  // 2. Monetization Platform Revenue (Pro Vendors ₦2,500/mo + Boosted Ads ₦500 each)
  const proVendors = adminUsers.filter(u => u.isMonetized).length;
  const boostedListings = adminProducts.filter(p => p.boosted).length;
  const totalRevenue = (proVendors * 2500) + (boostedListings * 500);

  // 3. Allowed Sellers
  const allowedSellers = adminUsers.filter(u => u.canSell).length;

  document.getElementById('stat-gmv').innerText = `₦${gmv.toLocaleString()}`;
  document.getElementById('stat-revenue').innerText = `₦${totalRevenue.toLocaleString()}`;
  document.getElementById('stat-listings-count').innerText = adminProducts.length;
  document.getElementById('stat-sellers-count').innerText = `${allowedSellers} / ${adminUsers.length}`;
}

function refreshAdminData() {
  calculateMonitorStats();
  renderUsersList(adminUsers);
  renderProductsFeed(adminProducts);
  showToast("Admin data synced with UNN nodes.");
}

// ================= 4. USER PERMISSION & MONETIZATION =================
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
          <h5>${user.name}</h5>
          <p><i class="fa-solid fa-location-dot"></i> ${user.location} • <i class="fa-solid fa-phone"></i> ${user.phone}</p>
        </div>
        <span class="tier-badge ${user.isMonetized ? 'pro' : 'free'}">
          ${user.tier}
        </span>
      </div>

      <div class="user-controls">
        <!-- Permission Control -->
        <button class="btn-ctrl ${user.canSell ? 'allow' : 'block'}" onclick="toggleSellPermission('${user.id}')">
          <i class="fa-solid ${user.canSell ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
          <span>${user.canSell ? 'Sell Allowed' : 'Sell Suspended'}</span>
        </button>

        <!-- Monetization Control -->
        <button class="btn-ctrl monetize ${user.isMonetized ? 'active-tier' : ''}" onclick="toggleMonetization('${user.id}')">
          <i class="fa-solid fa-gem"></i>
          <span>${user.isMonetized ? 'Pro (₦2,500/mo)' : 'Monetize User'}</span>
        </button>
      </div>
    </div>
  `).join('');
}

// Action: Grant or Revoke Selling Permission
function toggleSellPermission(userId) {
  const user = adminUsers.find(u => u.id === userId);
  if (user) {
    user.canSell = !user.canSell;
    syncData();
    renderUsersList(adminUsers);
    calculateMonitorStats();
    showToast(`${user.name}: Selling permission ${user.canSell ? 'GRANTED' : 'REVOKED'}.`);
  }
}

// Action: Toggle Monetize / Pro Vendor status
function toggleMonetization(userId) {
  const user = adminUsers.find(u => u.id === userId);
  if (user) {
    user.isMonetized = !user.isMonetized;
    user.tier = user.isMonetized ? "Pro Vendor (₦2,500/mo)" : "Free Student";
    syncData();
    renderUsersList(adminUsers);
    calculateMonitorStats();
    showToast(`${user.name}: Set to ${user.tier}. Revenue updated.`);
  }
}

// Action: Filter Users via search
function filterUsersList() {
  const q = document.getElementById('user-search').value.toLowerCase();
  const filtered = adminUsers.filter(u => 
    u.name.toLowerCase().includes(q) || 
    u.location.toLowerCase().includes(q) || 
    u.phone.includes(q)
  );
  renderUsersList(filtered);
}

// Action: Add new verified student manual entry
function openAddUserModal() {
  const name = prompt("Enter Student Full Name:");
  if (!name) return;
  const location = prompt("Enter Hostel Location (e.g. Franco, Mary Slessor, Hilltop):", "Mary Slessor Hostel");
  const phone = prompt("Enter WhatsApp Phone:", "08012345678");

  const newUser = {
    id: "usr_" + Date.now(),
    name,
    location: location || "UNN Campus",
    phone: phone || "08000000000",
    canSell: true,
    isMonetized: false,
    tier: "Free Student"
  };

  adminUsers.unshift(newUser);
  syncData();
  renderUsersList(adminUsers);
  calculateMonitorStats();
  showToast(`Student ${name} added and verified.`);
}

// ================= 5. PRODUCT MODERATION FEED =================
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
        <h5>${item.title}</h5>
        <p>${item.location} • ${item.category}</p>
        <div class="admin-prod-price">₦${Number(item.price).toLocaleString()}</div>
      </div>
      <div class="admin-prod-actions">
        <button class="btn-action-icon boost" onclick="toggleBoostItem(${item.id})">
          <i class="fa-solid fa-bolt"></i> ${item.boosted ? 'Boosted' : 'Boost (₦500)'}
        </button>
        <button class="btn-action-icon delete" onclick="deleteItemAdmin(${item.id})">
          <i class="fa-solid fa-trash"></i> Remove
        </button>
      </div>
    </div>
  `).join('');
}

function deleteItemAdmin(id) {
  if (confirm("Remove this listing from UNN Marketplace?")) {
    adminProducts = adminProducts.filter(p => p.id !== id);
    syncData();
    renderProductsFeed(adminProducts);
    calculateMonitorStats();
    showToast("Listing deleted by Admin.");
  }
}

function toggleBoostItem(id) {
  const item = adminProducts.find(p => p.id === id);
  if (item) {
    item.boosted = !item.boosted;
    syncData();
    renderProductsFeed(adminProducts);
    calculateMonitorStats();
    showToast(`Listing ${item.boosted ? 'BOOSTED (+₦500 Platform Fee)' : 'UNBOOSTED'}.`);
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

function boostAllMonetizedSellers() {
  let count = 0;
  adminProducts.forEach(p => {
    const seller = adminUsers.find(u => u.id === p.sellerId);
    if (seller && seller.isMonetized) {
      p.boosted = true;
      count++;
    }
  });
  syncData();
  renderProductsFeed(adminProducts);
  calculateMonitorStats();
  showToast(`Auto-boosted ${count} listings for Pro Vendors.`);
}

// ================= 6. STORAGE SYNC & HELPERS =================
function syncData() {
  localStorage.setItem('nexbuy_users', JSON.stringify(adminUsers));
  localStorage.setItem('nexbuy_products', JSON.stringify(adminProducts));
}

function showToast(text) {
  const toast = document.getElementById('toast');
  toast.innerText = text;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2400);
}
