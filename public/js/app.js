/* ==============================================================
   VOLTERAX PRIVATE ADMIN DASHBOARD — CORE CLIENT RUNTIME
   ============================================================== */

// Global fetch interceptor for 401 Unauthorized handling
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await originalFetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
  if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/me')) {
    window.location.href = '/';
  }
  return res;
};

let currentAdmin = null;
let activeTab = 'overview';
let cachedProjects = [];
let cachedOrders = [];
let cachedUsers = [];
let cachedMessages = { leads: [], feedback: [] };

// DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  setupSidebar();
  setupHashRouting();
  await checkAuth();
  await refreshCurrentTab();

  // Background auto-refresh every 20s
  setInterval(() => {
    refreshCurrentTab(true);
  }, 20000);
});

// ---------------- Authentication & Profile ----------------
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) throw new Error('Not logged in');
    const data = await res.json();
    currentAdmin = data.admin;

    document.getElementById('current-user-name').textContent = currentAdmin.name || currentAdmin.email;
    document.getElementById('current-user-role').textContent = currentAdmin.role.toUpperCase();
    document.getElementById('current-user-avatar').textContent = (currentAdmin.name || currentAdmin.email)[0].toUpperCase();

    // Show Admin Team nav if Owner
    if (currentAdmin.role === 'owner') {
      const navAdmins = document.getElementById('nav-admins');
      if (navAdmins) navAdmins.style.display = 'flex';
    }
  } catch (err) {
    window.location.href = '/';
  }
}

async function logoutAdmin() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/';
  }
}

// ---------------- Navigation & Routing ----------------
function setupSidebar() {
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });

    // Close on outside click on mobile
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 900 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }
}

function setupHashRouting() {
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '') || 'overview';
    switchTab(hash);
  });

  const initial = window.location.hash.replace('#', '') || 'overview';
  switchTab(initial);
}

function switchTab(tabId) {
  activeTab = tabId;

  // Update Nav links
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('data-tab') === tabId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Update Sections
  document.querySelectorAll('.page-section').forEach(sec => {
    sec.classList.remove('active');
  });

  const targetSec = document.getElementById(`sec-${tabId}`);
  if (targetSec) {
    targetSec.classList.add('active');
  }

  // Close mobile sidebar
  const sidebar = document.getElementById('sidebar');
  if (sidebar && window.innerWidth <= 900) {
    sidebar.classList.remove('open');
  }

  // Load section data
  refreshCurrentTab();
}

async function refreshCurrentTab(silent = false) {
  const btn = document.getElementById('btn-refresh');
  if (btn && !silent) {
    btn.innerHTML = '<span>⏳</span> SYNCING...';
    btn.disabled = true;
  }

  try {
    switch (activeTab) {
      case 'overview':
        await loadOverview();
        break;
      case 'users':
        await loadUsers();
        break;
      case 'projects':
        await loadProjects();
        break;
      case 'orders':
        await loadOrders();
        break;
      case 'messages':
        await loadMessages();
        break;
      case 'analytics':
        await loadAnalytics();
        break;
      case 'admins':
        if (currentAdmin && currentAdmin.role === 'owner') {
          await loadAdmins();
          await loadAuditLogs();
        }
        break;
      case 'settings':
        await loadSettings();
        break;
    }
  } catch (err) {
    if (!silent) showToast(err.message, 'error');
  } finally {
    if (btn && !silent) {
      btn.innerHTML = '<span>↻</span> SYNC NOW';
      btn.disabled = false;
    }
  }
}

// ---------------- 1. Overview ----------------
async function loadOverview() {
  const res = await fetch('/api/dashboard/overview');
  if (!res.ok) throw new Error('Failed to load overview data');
  const d = await res.json();

  // Update Bridge Status Pill
  updateBridgeStatusUI(d.bridgeStatus);

  // Update Stat values
  const live = d.live || {};
  document.getElementById('ov-users').textContent = live.customers || 0;
  document.getElementById('ov-projects').textContent = d.local?.activeProjectsCount || 30;
  document.getElementById('ov-orders').textContent = live.orders || 0;
  document.getElementById('ov-revenue').textContent = formatMoney(live.revenuePaise || 0);
  document.getElementById('ov-messages').textContent = (live.leads || 0) + (live.feedback || 0);

  const conversion = live.customers > 0 ? ((live.orders / live.customers) * 100).toFixed(1) : 0;
  document.getElementById('ov-conversion').textContent = `${conversion}%`;

  document.getElementById('overview-sync-time').textContent = `SYNCED: ${new Date().toLocaleTimeString()}`;

  // Update Sidebar badge counts
  document.getElementById('badge-users').textContent = live.customers || 0;
  document.getElementById('badge-orders').textContent = live.orders || 0;
  document.getElementById('badge-projects').textContent = d.local?.projectsCount || 30;
  document.getElementById('badge-messages').textContent = (live.leads || 0) + (live.feedback || 0);

  // Draw Overview Canvas Chart
  drawOverviewChart(live.orders || 0, live.revenuePaise || 0);

  // Load Recent Orders
  loadRecentOrders();
}

function updateBridgeStatusUI(status) {
  const pill = document.getElementById('bridge-status-pill');
  const dot = document.getElementById('bridge-status-dot');
  const text = document.getElementById('bridge-status-text');
  const infoStatus = document.getElementById('bridge-info-status');
  const infoLatency = document.getElementById('bridge-info-latency');

  if (!pill) return;

  if (status && status.connected) {
    pill.style.background = 'rgba(16, 185, 129, 0.08)';
    pill.style.borderColor = 'rgba(16, 185, 129, 0.25)';
    pill.style.color = '#34D399';
    dot.style.background = '#10B981';
    text.textContent = `LIVE BRIDGE: ONLINE (${status.latencyMs || 0}ms)`;

    if (infoStatus) {
      infoStatus.textContent = 'ONLINE / VERIFIED';
      infoStatus.className = 'badge emerald sm';
    }
    if (infoLatency) {
      infoLatency.textContent = `${status.latencyMs || 0} ms`;
    }
  } else {
    pill.style.background = 'rgba(245, 158, 11, 0.08)';
    pill.style.borderColor = 'rgba(245, 158, 11, 0.3)';
    pill.style.color = '#FBBF24';
    dot.style.background = '#F59E0B';
    text.textContent = 'LIVE BRIDGE: CACHED / STANDBY';

    if (infoStatus) {
      infoStatus.textContent = status?.error ? 'AUTH REQUIRED IN .ENV' : 'STANDBY';
      infoStatus.className = 'badge amber sm';
    }
    if (infoLatency) {
      infoLatency.textContent = status?.latencyMs ? `${status.latencyMs} ms` : '-- ms';
    }
  }
}

async function testLiveBridge() {
  showToast('Testing live platform connection...', 'info');
  try {
    const res = await fetch('/api/dashboard/bridge/test', { method: 'POST' });
    const data = await res.json();
    updateBridgeStatusUI(data);

    if (data.connected) {
      showToast(`✓ Live connection successful! Latency: ${data.latencyMs}ms`, 'success');
      refreshCurrentTab();
    } else {
      showToast(`Bridge standby: ${data.error || 'Official login is cooling down'}`, 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadRecentOrders() {
  try {
    const res = await fetch('/api/dashboard/orders');
    if (!res.ok) return;
    const d = await res.json();
    const orders = (d.orders || []).slice(0, 5);
    const tbody = document.getElementById('ov-recent-orders');

    if (!tbody) return;

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 24px;">No customer orders placed yet.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td><strong style="color: var(--cyan); font-family: var(--font-mono);">${safe(o.order_id || o.id)}</strong></td>
        <td>
          <b>${safe(o.user || 'Unknown')}</b><br>
          <span style="font-size: 11px; color: #34D399; font-family: var(--font-mono); font-weight: 600;">${safe(o.mobile || o.phone || (o.shipping_address && o.shipping_address.phone) || '—')}</span>
        </td>
        <td>${safe(o.title || 'VOLTERAX PROJECT')}</td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: #34D399;">${formatMoney(o.amount_paise || 0)}</td>
        <td>${renderStatusBadge(o.status)}</td>
        <td style="font-size: 11px; color: var(--text-muted);">${formatDate(o.createdAt || o.updatedAt)}</td>
      </tr>
    `).join('');
  } catch (_) {}
}

// ---------------- 2. Users Management ----------------
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 24px;">Fetching live customer directory...</td></tr>';

  const res = await fetch('/api/dashboard/customers');
  if (!res.ok) throw new Error('Failed to load customers');
  const d = await res.json();

  cachedUsers = d.customers || [];
  document.getElementById('users-count-tag').textContent = `${cachedUsers.length} REGISTERED`;
  renderUsersTable(cachedUsers);
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 24px;">No customer logins or accounts found.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>
        <b style="color: #FFF; font-size: 13px;">${safe(u.name || 'Customer')}</b><br>
        <span class="badge ${u.statusAnnotation === 'flagged' ? 'crimson' : 'emerald'} sm" style="font-size: 9px; margin-top: 3px;">
          ${u.statusAnnotation === 'flagged' ? 'FLAGGED' : 'VERIFIED'}
        </span>
      </td>
      <td>
        <div>
          <a href="tel:${safe(u.mobile)}" style="color: #FFF; font-family: var(--font-mono); font-weight: 700; font-size: 13px; text-decoration: none;">
            ðŸ“ž ${safe(u.mobile || 'â€”')}
          </a>
          ${u.mobile ? `
            <br>
            <a href="https://wa.me/91${safe(u.mobile)}?text=Hello%20${encodeURIComponent(u.name || '')},%20greetings%20from%20VOLTERAX!" target="_blank" style="font-size: 11px; color: #34D399; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 3px; margin-top: 2px;">
              ðŸ’¬ WhatsApp â†—
            </a>
          ` : ''}
        </div>
      </td>
      <td>
        <div>
          <span style="color: #00E5FF; font-family: var(--font-mono); font-size: 12px; font-weight: 600;">
            âœ‰ï¸  ${safe(u.email || 'â€”')}
          </span>
          ${u.email ? `
            <br>
            <a href="mailto:${safe(u.email)}" style="font-size: 11px; color: #C084FC; text-decoration: none; font-weight: 600; margin-top: 2px; display: inline-block;">
              â†— Send Gmail
            </a>
          ` : ''}
        </div>
      </td>
      <td>
        <span style="font-family: var(--font-mono); font-size: 11px; color: var(--cyan); background: rgba(0,229,255,0.08); padding: 2px 6px; border-radius: 4px;">
          ${safe(u.id)}
        </span>
      </td>
      <td style="font-size: 12px; color: var(--text-muted);">${formatDate(u.createdAt)}</td>
      <td style="font-size: 12px; color: ${u.lastLoginAt ? '#34D399' : 'var(--text-muted)'};">
        ${u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}
      </td>
      <td>
        <strong style="color: #A855F7; font-family: var(--font-mono); font-size: 11px;">
          ${safe(u.ref || u.referralCode || 'â€”')}
        </strong>
      </td>
      <td>
        <div style="display:flex; gap:5px; align-items:center;">
          ${u.mobile ? `
            <a class="btn sm" href="https://wa.me/91${safe(u.mobile)}?text=Hello%20${encodeURIComponent(u.name || '')},%20greetings%20from%20VOLTERAX!" target="_blank" style="background:rgba(16,185,129,0.15); border:1px solid #10b981; color:#34D399; padding:4px 8px; font-size:11px; border-radius:5px; text-decoration:none;" title="Chat on WhatsApp">
              Chat
            </a>
          ` : ''}
          ${u.email ? `
            <a class="btn sm" href="mailto:${safe(u.email)}" style="background:rgba(168,85,247,0.15); border:1px solid #a855f7; color:#c084fc; padding:4px 8px; font-size:11px; border-radius:5px; text-decoration:none;" title="Email via Gmail">
              Email
            </a>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function filterUsers() {
  const q = document.getElementById('users-search').value.toLowerCase().trim();
  if (!q) {
    renderUsersTable(cachedUsers);
    return;
  }
  const filtered = cachedUsers.filter(u =>
    (u.name && u.name.toLowerCase().includes(q)) ||
    (u.mobile && u.mobile.includes(q)) ||
    (u.email && u.email.toLowerCase().includes(q)) ||
    (u.id && u.id.toLowerCase().includes(q)) ||
    (u.ref && u.ref.toLowerCase().includes(q))
  );
  renderUsersTable(filtered);
}

async function toggleCustomerFlag(userId, newStatus) {
  try {
    const res = await fetch(`/api/dashboard/customers/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error('Failed to update customer');
    showToast(`Customer status updated to ${newStatus}`, 'success');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------------- 3. Projects CMS ----------------
async function loadProjects() {
  const container = document.getElementById('projects-container');
  container.innerHTML = '<div style="color: var(--text-dim); padding: 24px;">Loading project concepts...</div>';

  const res = await fetch('/api/dashboard/projects');
  if (!res.ok) throw new Error('Failed to load projects');
  const d = await res.json();

  cachedProjects = d.projects || [];
  renderProjectsGrid(cachedProjects);
}

function renderProjectsGrid(projects) {
  const container = document.getElementById('projects-container');
  if (projects.length === 0) {
    container.innerHTML = '<div style="color: var(--text-dim); padding: 24px;">No projects match your filter.</div>';
    return;
  }

  container.innerHTML = projects.map(p => {
    const imgSrc = p.image || 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80';
    return `
    <article class="project-item-card">
      <div class="project-thumb">
        <img src="${safe(imgSrc)}" alt="${safe(p.title)}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80';">
        <span class="project-code-tag">${safe(p.code || p.id)}</span>
        <span class="project-category-tag">${safe(p.category)}</span>
      </div>
      <div class="project-body">
        <h3 class="project-title">${safe(p.title)}</h3>
        <p class="project-desc">${safe(p.description)}</p>
        <div class="project-foot">
          <div class="project-price">₹${Number(p.price || 0).toLocaleString('en-IN')}</div>
          <div style="display: flex; gap: 6px;">
            <button class="btn sm" onclick="editProject('${p.id}')">Edit</button>
            <button class="btn sm danger" onclick="deleteProjectItem('${p.id}')">✕</button>
          </div>
        </div>
      </div>
    </article>
  `;}).join('');
}

function filterProjectsByCategory(cat, btn) {
  document.querySelectorAll('#project-category-tabs .filter-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (cat === 'ALL') {
    renderProjectsGrid(cachedProjects);
    return;
  }
  const filtered = cachedProjects.filter(p => p.category && p.category.includes(cat));
  renderProjectsGrid(filtered);
}

function filterProjectsBySearch() {
  const q = document.getElementById('projects-search').value.toLowerCase().trim();
  if (!q) {
    renderProjectsGrid(cachedProjects);
    return;
  }
  const filtered = cachedProjects.filter(p =>
    (p.title && p.title.toLowerCase().includes(q)) ||
    (p.code && p.code.toLowerCase().includes(q)) ||
    (p.description && p.description.toLowerCase().includes(q)) ||
    (p.category && p.category.toLowerCase().includes(q))
  );
  renderProjectsGrid(filtered);
}

function editProject(id) {
  const p = cachedProjects.find(x => x.id === id);
  if (!p) return;

  document.getElementById('modal-project-title').textContent = 'Edit Hardware Concept';
  document.getElementById('proj-edit-id').value = p.id;
  document.getElementById('proj-title').value = p.title;
  document.getElementById('proj-category').value = p.category;
  document.getElementById('proj-code').value = p.code;
  document.getElementById('proj-price').value = p.price;
  document.getElementById('proj-image').value = p.image;
  document.getElementById('proj-desc').value = p.description;
  document.getElementById('proj-status').value = p.status || 'active';

  openModal('modal-add-project');
}

async function submitProjectForm(e) {
  e.preventDefault();
  const editId = document.getElementById('proj-edit-id').value;
  const isEditing = Boolean(editId);

  const payload = {
    title: document.getElementById('proj-title').value,
    category: document.getElementById('proj-category').value,
    code: document.getElementById('proj-code').value,
    price: Number(document.getElementById('proj-price').value),
    image: document.getElementById('proj-image').value,
    description: document.getElementById('proj-desc').value,
    status: document.getElementById('proj-status').value
  };

  try {
    const url = isEditing ? `/api/dashboard/projects/${encodeURIComponent(editId)}` : '/api/dashboard/projects';
    const method = isEditing ? 'PATCH' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save project');

    closeModal('modal-add-project');
    showToast(`✓ Project "${payload.title}" saved successfully!`, 'success');
    loadProjects();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteProjectItem(id) {
  if (!confirm('Are you sure you want to delete this hardware project concept?')) return;
  try {
    const res = await fetch(`/api/dashboard/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete project');
    showToast('Project deleted successfully', 'success');
    loadProjects();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------------- 4. Orders Management ----------------
async function loadOrders() {
  const tbody = document.getElementById('orders-tbody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 24px;">Loading live orders...</td></tr>';

  const res = await fetch('/api/dashboard/orders');
  if (!res.ok) throw new Error('Failed to load orders');
  const d = await res.json();

  // Display only genuine orders with uploaded payment screenshots
  cachedOrders = (d.orders || []).filter(o => {
    const ss = o.payment_screenshot || o.payment_proof || (o.shipping_address && typeof o.shipping_address === 'object' ? o.shipping_address.payment_screenshot : null);
    return Boolean(ss && String(ss).trim().length > 15);
  });
  renderOrdersTable(cachedOrders);
}

function formatShippingAddr(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  const p = [];
  if (a.street) p.push(a.street);
  if (a.city) p.push(a.city);
  if (a.state) p.push(a.state);
  if (a.pincode) p.push('PIN: ' + a.pincode);
  return p.join(', ');
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('orders-tbody');
  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 24px;">No customer orders found.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td>
        <strong style="color: var(--cyan); font-family: var(--font-mono);">${safe(o.order_id || o.id)}</strong><br>
        <span style="font-size: 10px; color: var(--text-dim);">UID: ${safe(o.userId || '—')}</span>
      </td>
      <td>
        <b style="color: #FFF;">${safe(o.user || 'Customer')}</b>
      </td>
      <td>
        ${(() => {
          const m = o.mobile || o.phone || (o.shipping_address && typeof o.shipping_address === 'object' ? o.shipping_address.phone : '') || '';
          return `<a href="tel:${safe(m)}" style="color: #FFF; font-family: var(--font-mono); font-size: 12px; font-weight: 600;">${safe(m || '—')}</a><br>
          ${m ? `<a href="https://wa.me/91${safe(m)}?text=Hello%20${encodeURIComponent(o.user || '')},%20regarding%20your%20VOLTERAX%20build%20order%20${safe(o.order_id || o.id)}" target="_blank" style="font-size: 11px; color: #34D399; text-decoration: none; font-weight: 600;">💬 WhatsApp ↗</a>` : ''}`;
        })()}
      </td>
      <td>
        <b>${safe(o.title || 'VOLTERAX PROJECT')}</b>
        ${o.details ? `<p style="font-size: 11px; color: var(--text-muted); margin-top: 3px; max-width: 250px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${safe(o.details)}</p>` : ''}
        ${o.shipping_address ? `
          <div style="margin-top: 4px; font-size: 11px; color: var(--cyan); display: flex; align-items: center; gap: 4px;">
            <span>📍</span>
            <span title="${safe(formatShippingAddr(o.shipping_address))}" style="max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${safe(formatShippingAddr(o.shipping_address))}
            </span>
          </div>
        ` : `<span style="font-size: 10px; color: var(--text-dim); display: block; margin-top: 2px;">📍 No shipping address</span>`}
      </td>
      <td style="font-family: var(--font-mono); font-weight: 700; color: #34D399;">
        ${formatMoney(o.amount_paise || 0)}
      </td>
      <td>
        ${(() => {
          const ss = o.payment_screenshot || o.payment_proof || (o.shipping_address && typeof o.shipping_address === 'object' ? o.shipping_address.payment_screenshot : null);
          const isRej = (o.status === 'rejected' || o.payment_status === 'fake_receipt_rejected');
          if (ss) {
            return `
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <img src="${safe(ss)}" style="width:44px; height:44px; border-radius:8px; object-fit:cover; border:2px solid ${isRej ? '#ef4444' : '#10b981'}; cursor:pointer; box-shadow:0 3px 10px ${isRej ? 'rgba(239,68,68,0.35)' : 'rgba(16,185,129,0.35)'}; transition:transform .18s ease;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'" onclick="openPaymentScreenshotModal('${safe(o.order_id || o.id)}')" title="Click to view large payment screenshot" />
                <button type="button" class="btn sm" style="background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#34D399; font-weight:800; padding:6px 12px; font-size:12px; border-radius:6px; white-space:nowrap; cursor:pointer; display:inline-flex; align-items:center; gap:5px;" onclick="openPaymentScreenshotModal('${safe(o.order_id || o.id)}')">
                  📷 View Proof
                </button>
                ${isRej ? `
                  <span style="display:inline-block; padding:4px 8px; border-radius:6px; background:#ef4444; color:#fff; font-size:10px; font-weight:900; letter-spacing:0.5px;">FAKE REJECTED</span>
                ` : `
                  <button type="button" class="btn sm" style="background:rgba(239,68,68,0.18); border:1px solid #ef4444; color:#f87171; font-weight:800; padding:4px 8px; font-size:11px; border-radius:6px; cursor:pointer;" onclick="window.markOrderAsFakeReceipt('${safe(o.id || o.order_id)}')" title="Mark as Fake Receipt">⚠️ Fake</button>
                `}
              </div>
            `;
          } else {
            return `<span style="font-size:11px; color:#ef4444; font-weight:600; display:inline-flex; align-items:center; gap:3px;">⚠️ No Proof</span>`;
          }
        })()}
      </td>
      <td>
        <select class="select sm" style="padding: 4px 8px; font-size: 11px; width: auto; font-weight:700; ${o.status === 'rejected' ? 'background:rgba(239,68,68,0.2); border-color:#ef4444; color:#fca5a5;' : ''}" onchange="updateLiveOrderStatus('${o.id || o.order_id}', this.value)">
          <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>pending</option>
          <option value="confirmed" ${o.status === 'confirmed' ? 'selected' : ''}>confirmed</option>
          <option value="processing" ${o.status === 'processing' ? 'selected' : ''}>processing</option>
          <option value="completed" ${o.status === 'completed' ? 'selected' : ''}>completed</option>
          <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>cancelled</option>
          <option value="rejected" ${o.status === 'rejected' ? 'selected' : ''}>⚠️ rejected (fake receipt)</option>
        </select>
      </td>
      <td style="font-size: 12px; color: var(--text-muted);">${formatDate(o.createdAt || o.updatedAt)}</td>
      <td>
        <div style="display:flex; gap:5px; align-items:center;">
          <button class="btn sm" onclick="alert('TECHNICAL SPECS / ORDER DETAILS:\\n\\n' + (${JSON.stringify(o.details || 'No details provided.')}) + ((${JSON.stringify(o.shipping_address ? '\\n\\nDELIVERY ADDRESS:\\n' + formatShippingAddr(o.shipping_address) : '')})))">
            Specs
          </button>
          <button class="btn sm" style="background:rgba(239,68,68,0.15); border:1px solid #ef4444; color:#f87171; padding:5px 8px; font-size:11px; border-radius:5px; cursor:pointer;" onclick="deleteLiveOrder('${safe(o.id || o.order_id)}')" title="Delete Order">
            ðŸ—‘ï¸ 
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterOrdersByStatus(status, btn) {
  document.querySelectorAll('#order-status-tabs .filter-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (status === 'ALL') {
    renderOrdersTable(cachedOrders);
    return;
  }
  const filtered = cachedOrders.filter(o => {
    if (status === 'rejected') return o.status === 'rejected' || o.payment_status === 'fake_receipt_rejected';
    return o.status === status;
  });
  renderOrdersTable(filtered);
}

function filterOrdersBySearch() {
  const q = document.getElementById('orders-search').value.toLowerCase().trim();
  if (!q) {
    renderOrdersTable(cachedOrders);
    return;
  }
  const filtered = cachedOrders.filter(o =>
    (o.order_id && o.order_id.toLowerCase().includes(q)) ||
    (o.id && o.id.toLowerCase().includes(q)) ||
    (o.user && o.user.toLowerCase().includes(q)) ||
    (o.mobile && o.mobile.includes(q)) || (o.phone && o.phone.includes(q)) || (o.shipping_address && o.shipping_address.phone && o.shipping_address.phone.includes(q)) ||
    (o.title && o.title.toLowerCase().includes(q))
  );
  renderOrdersTable(filtered);
}

async function updateLiveOrderStatus(orderId, newStatus, extraData = {}) {
  try {
    showToast(`Syncing order ${orderId} to ${newStatus}...`, 'info');
    const bodyPayload = { status: newStatus, ...extraData };
    if (newStatus === 'rejected') {
      bodyPayload.payment_status = 'fake_receipt_rejected';
      if (!bodyPayload.payment_rejection_reason) {
        bodyPayload.payment_rejection_reason = 'Fake or invalid payment receipt uploaded. Transaction was not credited to our UPI account.';
      }
    }
    const res = await fetch(`/api/dashboard/orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update order');

    showToast(`✓ Order ${orderId} updated to ${newStatus} on live platform!`, 'success');
    await loadOrders();
  } catch (err) {
    showToast(err.message, 'error');
    loadOrders();
  }
}

window.markOrderAsFakeReceipt = async function(orderId) {
  if (!confirm(`Are you sure you want to mark order #${orderId} as FAKE RECEIPT / REJECTED?\n\nThis will prominently alert the customer on their account page that their payment receipt was fake/invalid.`)) return;
  try {
    await updateLiveOrderStatus(orderId, 'rejected', {
      payment_status: 'fake_receipt_rejected',
      payment_rejection_reason: 'Fake or invalid payment receipt uploaded. Transaction was not credited to our UPI account.'
    });
    showToast(`Order #${orderId} marked as FAKE RECEIPT and customer alerted.`, 'warning');
  } catch (err) {
    showToast('Failed to mark fake receipt: ' + err.message, 'error');
  }
};

async function deleteLiveOrder(orderId) {
  if (!confirm(`Are you sure you want to permanently delete order #${orderId}?`)) return;
  try {
    showToast(`Deleting order ${orderId}...`, 'info');
    const res = await fetch(`/api/dashboard/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete order');

    showToast(`✓ Order ${orderId} deleted permanently.`, 'success');
    await loadOrders();
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

async function submitOrderForm(e) {
  e.preventDefault();
  const userId = document.getElementById('order-user').value.trim();
  const title = document.getElementById('order-title').value.trim();
  const amount = Number(document.getElementById('order-amount').value);
  const status = document.getElementById('order-status').value;
  const details = document.getElementById('order-details').value.trim();

  const payload = {
    userId,
    title,
    amount_paise: Math.round(amount * 100),
    status,
    details
  };

  try {
    showToast('Submitting order to live platform...', 'info');
    const res = await fetch('/api/dashboard/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create order');

    closeModal('modal-add-order');
    showToast('✓ Order created and saved to live platform!', 'success');
    loadOrders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------------- 5. Messages & Enquiries ----------------
async function loadMessages() {
  const res = await fetch('/api/dashboard/messages');
  if (!res.ok) throw new Error('Failed to load messages');
  const d = await res.json();

  cachedMessages = {
    leads: d.leads || [],
    feedback: d.feedback || []
  };

  document.getElementById('count-leads').textContent = cachedMessages.leads.length;
  document.getElementById('count-feedback').textContent = cachedMessages.feedback.length;

  renderLeadsTable(cachedMessages.leads);
  renderFeedbackTable(cachedMessages.feedback);
}

function switchMessagesTab(tab) {
  const btnLeads = document.getElementById('tab-btn-leads');
  const btnFeedback = document.getElementById('tab-btn-feedback');
  const panelLeads = document.getElementById('panel-leads');
  const panelFeedback = document.getElementById('panel-feedback');

  if (tab === 'leads') {
    btnLeads.style.background = 'var(--cyan)';
    btnLeads.style.color = '#06070B';
    btnLeads.style.fontWeight = '700';
    btnFeedback.style.background = 'var(--bg-elevated)';
    btnFeedback.style.color = 'var(--text-main)';
    btnFeedback.style.fontWeight = '500';
    panelLeads.style.display = 'block';
    panelFeedback.style.display = 'none';
  } else {
    btnFeedback.style.background = 'var(--cyan)';
    btnFeedback.style.color = '#06070B';
    btnFeedback.style.fontWeight = '700';
    btnLeads.style.background = 'var(--bg-elevated)';
    btnLeads.style.color = 'var(--text-main)';
    btnLeads.style.fontWeight = '500';
    panelFeedback.style.display = 'block';
    panelLeads.style.display = 'none';
  }
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById('leads-tbody');
  if (leads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 24px;">No customer leads or briefs received yet.</td></tr>';
    return;
  }

  tbody.innerHTML = leads.map(l => `
    <tr>
      <td><b style="color: #FFF;">${safe(l.customer || l.name || 'Customer')}</b></td>
      <td>
        <a href="tel:${safe(l.mobile)}" style="color: #FFF; font-family: var(--font-mono); font-size: 12px;">${safe(l.mobile || '—')}</a>
      </td>
      <td style="max-width: 380px;">
        <div style="font-size: 13px; color: #FFF; white-space: pre-wrap;">${safe(l.message)}</div>
        ${l.internalNotes ? `<div style="margin-top: 6px; font-size: 11px; color: var(--cyan); background: rgba(0, 229, 255, 0.05); padding: 4px 8px; border-radius: 4px;">📝 Note: ${safe(l.internalNotes)}</div>` : ''}
      </td>
      <td style="font-size: 12px; color: var(--text-muted);">${formatDate(l.createdAt)}</td>
      <td>
        <span class="badge ${l.internalStatus === 'new' ? 'amber' : 'emerald'} sm">
          ${safe(l.internalStatus || 'new').toUpperCase()}
        </span>
      </td>
      <td>
        <div style="display: flex; gap: 6px;">
          ${l.mobile ? `<a href="https://wa.me/91${safe(l.mobile)}?text=Hello%20${encodeURIComponent(l.customer || '')},%20we%20received%20your%20VOLTERAX%20project%20brief" target="_blank" class="btn sm" style="color: #34D399;">WhatsApp ↗</a>` : ''}
          <button class="btn sm" onclick="openLeadNotesModal('${l.id}', '${safe(l.internalStatus || 'new')}', ${JSON.stringify(l.internalNotes || '')})">
            Notes
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderFeedbackTable(feedbacks) {
  const tbody = document.getElementById('feedback-tbody');
  if (feedbacks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 24px;">No customer feedback submitted yet.</td></tr>';
    return;
  }

  tbody.innerHTML = feedbacks.map(f => `
    <tr>
      <td style="color: #FBBF24; font-size: 15px;">
        ${'★'.repeat(f.rating || 5)}${'☆'.repeat(5 - (f.rating || 5))}
      </td>
      <td><b style="color: #FFF;">${safe(f.customer || f.name)}</b></td>
      <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-muted);">${safe(f.mobile || 'Guest')}</td>
      <td style="max-width: 340px; font-size: 13px;">${safe(f.feedbackText)}</td>
      <td style="font-size: 12px; color: var(--text-muted);">${formatDate(f.createdAt)}</td>
      <td>
        <span class="badge ${f.status === 'read' ? 'emerald' : 'amber'} sm">
          ${safe(f.status || 'new').toUpperCase()}
        </span>
      </td>
      <td>
        ${f.status !== 'read' ? `<button class="btn sm" onclick="markFeedbackRead('${f.id}')">Mark Read</button>` : '<span style="color: var(--text-dim); font-size: 11px;">✓ Read</span>'}
      </td>
    </tr>
  `).join('');
}

async function markFeedbackRead(id) {
  try {
    const res = await fetch(`/api/dashboard/feedback/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'read' })
    });
    if (!res.ok) throw new Error('Failed to update feedback');
    showToast('Feedback marked as read on live platform', 'success');
    loadMessages();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openLeadNotesModal(leadId, currentStatus, currentNotes) {
  document.getElementById('lead-note-id').value = leadId;
  document.getElementById('lead-status-select').value = currentStatus || 'new';
  document.getElementById('lead-notes-text').value = currentNotes || '';
  openModal('modal-lead-note');
}

async function submitLeadNote(e) {
  e.preventDefault();
  const id = document.getElementById('lead-note-id').value;
  const internalStatus = document.getElementById('lead-status-select').value;
  const notes = document.getElementById('lead-notes-text').value.trim();

  try {
    const res = await fetch(`/api/dashboard/leads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ internalStatus, notes })
    });
    if (!res.ok) throw new Error('Failed to save note');

    closeModal('modal-lead-note');
    showToast('Lead note updated successfully', 'success');
    loadMessages();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------------- 6. Analytics ----------------
async function loadAnalytics() {
  const res = await fetch('/api/dashboard/analytics');
  if (!res.ok) throw new Error('Failed to load analytics');
  const d = await res.json();

  document.getElementById('an-aov').textContent = `₹${(d.metrics?.avgOrderValue || 0).toLocaleString('en-IN')}`;
  document.getElementById('an-cr').textContent = `${d.metrics?.conversionRate || 0}%`;
  document.getElementById('an-rev').textContent = formatMoney(d.metrics?.totalRevenuePaise || 0);

  // Draw Charts
  drawStatusChart(d.statusDistribution || {});
  drawCategoryChart(d.categoryDistribution || {});

  // Top Referrers
  const tbody = document.getElementById('an-top-referrers');
  const top = d.topReferrers || [];
  if (top.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 24px;">No customer referrals registered yet.</td></tr>';
  } else {
    tbody.innerHTML = top.map(r => `
      <tr>
        <td><strong style="color: var(--cyan); font-family: var(--font-mono);">${safe(r.code)}</strong></td>
        <td><b>${safe(r.name)}</b></td>
        <td><a href="tel:${safe(r.mobile)}" style="color: #FFF;">${safe(r.mobile)}</a></td>
        <td><span class="badge emerald sm" style="font-size: 12px;">${r.count} users</span></td>
        <td><span class="badge cyan sm">SUPER CONNECTOR</span></td>
      </tr>
    `).join('');
  }
}

// ---------------- 7. Admin Management (Owner Only) ----------------
async function loadAdmins() {
  const tbody = document.getElementById('admins-tbody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 24px;">Loading administrative accounts...</td></tr>';

  const res = await fetch('/api/dashboard/admins');
  if (!res.ok) throw new Error('Failed to load admins');
  const d = await res.json();

  const admins = d.admins || [];
  tbody.innerHTML = admins.map(a => `
    <tr>
      <td><span style="font-family: var(--font-mono); font-size: 11px; color: var(--cyan);">${safe(a.id)}</span></td>
      <td><b style="color: #FFF;">${safe(a.name)}</b></td>
      <td>${safe(a.email)}</td>
      <td>
        <span class="badge ${a.role === 'owner' ? 'cyan' : 'purple'} sm">
          ${safe(a.role).toUpperCase()}
        </span>
      </td>
      <td>
        <span class="badge ${a.status === 'active' ? 'emerald' : 'crimson'} sm">
          ${safe(a.status).toUpperCase()}
        </span>
      </td>
      <td style="font-size: 12px; color: var(--text-muted);">${formatDate(a.createdAt)}</td>
      <td style="font-size: 12px; color: var(--text-muted);">${a.lastLoginAt ? formatDate(a.lastLoginAt) : 'Never'}</td>
      <td>
        ${a.role !== 'owner' ? `
          <button class="btn sm ${a.status === 'active' ? 'danger' : 'cyan'}" onclick="toggleAdminStatus('${a.id}', '${a.status === 'active' ? 'revoked' : 'active'}')">
            ${a.status === 'active' ? 'Revoke' : 'Activate'}
          </button>
        ` : '<span style="color: var(--text-dim); font-size: 11px;">Master</span>'}
      </td>
    </tr>
  `).join('');
}

async function loadAuditLogs() {
  const tbody = document.getElementById('audit-tbody');
  const res = await fetch('/api/dashboard/audit-logs');
  if (!res.ok) return;
  const d = await res.json();
  const logs = d.logs || [];

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 24px;">No audit events logged yet.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => `
    <tr>
      <td style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">${formatDate(l.timestamp)}</td>
      <td><b>${safe(l.adminEmail)}</b></td>
      <td><span class="badge cyan sm">${safe(l.action)}</span></td>
      <td style="font-size: 12px;">${safe(l.details)}</td>
      <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-dim);">${safe(l.ip)}</td>
    </tr>
  `).join('');
}

async function submitAdminForm(e) {
  e.preventDefault();
  const name = document.getElementById('admin-name').value.trim();
  const email = document.getElementById('admin-email').value.trim();
  const role = document.getElementById('admin-role').value;
  const password = document.getElementById('admin-password').value;

  try {
    const res = await fetch('/api/dashboard/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to authorize admin');

    closeModal('modal-invite-admin');
    showToast(`✓ Admin "${name}" successfully authorized!`, 'success');
    loadAdmins();
    loadAuditLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleAdminStatus(adminId, newStatus) {
  if (!confirm(`Are you sure you want to change this administrator's status to ${newStatus}?`)) return;
  try {
    const res = await fetch(`/api/dashboard/admins/${encodeURIComponent(adminId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update status');

    showToast(`Administrator status changed to ${newStatus}`, 'success');
    loadAdmins();
    loadAuditLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------------- 8. Settings ----------------
async function loadSettings() {
  const res = await fetch('/api/dashboard/settings');
  if (!res.ok) return;
  const d = await res.json();

  if (d.bridgeStatus) {
    document.getElementById('set-bridge-url').value = d.bridgeStatus.baseUrl || 'https://volterax-vr1c.vercel.app';
    document.getElementById('set-bridge-email').value = d.bridgeStatus.adminEmail || 'srinivasvm1122@gmail.com';
  }
}

async function changeAdminPassword(e) {
  e.preventDefault();
  const p1 = document.getElementById('new-password').value;
  const p2 = document.getElementById('confirm-password').value;

  if (p1 !== p2) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/dashboard/admins/${encodeURIComponent(currentAdmin.id)}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: p1 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update password');

    document.getElementById('form-change-password').reset();
    showToast('✓ Security password updated successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------------- Canvas Charts Engine ----------------
function drawOverviewChart(orderCount, revenuePaise) {
  const canvas = document.getElementById('overviewChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.parentElement.clientWidth - 44;
  const h = canvas.height = 230;

  ctx.clearRect(0, 0, w, h);

  // Background Grid Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 30 + (i * 35);
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(w - 20, y);
    ctx.stroke();
  }

  // Generate smooth trend wave
  const points = [];
  const count = 12;
  const stepX = (w - 70) / (count - 1);
  const maxVal = Math.max(revenuePaise / 100, 50000);

  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    const wave = Math.sin(progress * Math.PI) * 0.7 + (Math.random() * 0.2);
    const val = (revenuePaise / 100) * wave + (i * 2500);
    const y = h - 40 - (Math.min(val / maxVal, 1) * 130);
    points.push({ x: 45 + (i * stepX), y });
  }

  // Draw Gradient Area
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0, 229, 255, 0.35)');
  grad.addColorStop(1, 'rgba(0, 229, 255, 0.0)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, h - 35);
  for (let p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(points[points.length - 1].x, h - 35);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw Line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = '#00E5FF';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Glow Points
  for (let p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#06070B';
    ctx.fill();
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawStatusChart(dist) {
  const canvas = document.getElementById('statusChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.parentElement.clientWidth - 44;
  const h = canvas.height = 240;

  ctx.clearRect(0, 0, w, h);

  const statuses = [
    { label: 'Pending', count: dist.pending || 0, color: '#F59E0B' },
    { label: 'Confirmed', count: dist.confirmed || 0, color: '#3B82F6' },
    { label: 'Processing', count: dist.processing || 0, color: '#8B5CF6' },
    { label: 'Completed', count: dist.completed || 0, color: '#10B981' },
    { label: 'Cancelled', count: dist.cancelled || 0, color: '#EF4444' }
  ];

  const total = statuses.reduce((sum, s) => sum + s.count, 0) || 1;
  const centerX = w / 3;
  const centerY = h / 2;
  const radius = 65;

  let startAngle = -Math.PI / 2;

  // Donut Arc
  for (let s of statuses) {
    const sliceAngle = (s.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.arc(centerX, centerY, radius - 22, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    startAngle += sliceAngle;
  }

  // Center Count
  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 18px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total, centerX, centerY);

  // Legend
  ctx.textAlign = 'left';
  let legendY = 40;
  for (let s of statuses) {
    ctx.fillStyle = s.color;
    ctx.fillRect(w / 2 + 30, legendY, 12, 12);
    ctx.fillStyle = '#FFF';
    ctx.font = '12px var(--font-main)';
    ctx.fillText(`${s.label}: ${s.count}`, w / 2 + 50, legendY + 10);
    legendY += 32;
  }
}

function drawCategoryChart(cats) {
  const canvas = document.getElementById('categoryChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.parentElement.clientWidth - 44;
  const h = canvas.height = 240;

  ctx.clearRect(0, 0, w, h);

  const entries = Object.entries(cats).slice(0, 5);
  const maxVal = Math.max(...entries.map(e => e[1]), 5);
  let barY = 30;

  for (let [cat, count] of entries) {
    const barW = Math.max((count / maxVal) * (w - 180), 8);

    ctx.fillStyle = '#8E94A8';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(cat.slice(0, 16), 10, barY + 14);

    const grad = ctx.createLinearGradient(120, 0, 120 + barW, 0);
    grad.addColorStop(0, '#7928CA');
    grad.addColorStop(1, '#00E5FF');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(120, barY, barW, 18, 4);
    ctx.fill();

    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(count, 130 + barW, barY + 14);

    barY += 38;
  }
}

// ---------------- Modal & Toast Helpers ----------------
function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = 'flex';
    el.classList.add('open');
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    el.style.display = 'none';
  }
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️'}</span>
    <div style="flex: 1;">${safe(msg)}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ---------------- Formatters ----------------
function formatMoney(paise) {
  return '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) {
    return iso;
  }
}

function renderStatusBadge(status) {
  const s = String(status || 'pending').toLowerCase();
  let cls = 'amber';
  if (s === 'completed') cls = 'emerald';
  else if (s === 'confirmed' || s === 'processing') cls = 'cyan';
  else if (s === 'cancelled') cls = 'crimson';

  return `<span class="badge ${cls} sm">${safe(s.toUpperCase())}</span>`;
}

function safe(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}


// ---------------- Payment Screenshot Modal Handlers ----------------
let activeProofOrder = null;


// ---------------- Payment Screenshot Zoom & Lightbox Controls ----------------
let currentProofZoom = 1.0;

window.pssSetZoom = function(scale) {
  currentProofZoom = Math.max(0.6, Math.min(3.5, scale));
  const img = document.getElementById('pss-img-view');
  if (img) {
    img.style.transform = 'scale(' + currentProofZoom + ')';
    img.style.cursor = currentProofZoom > 1.05 ? 'zoom-out' : 'zoom-in';
  }
  const zoomLabel = document.getElementById('pss-zoom-label');
  if (zoomLabel) zoomLabel.textContent = Math.round(currentProofZoom * 100) + '%';
};

window.pssZoomIn = function() {
  window.pssSetZoom(currentProofZoom + 0.3);
};

window.pssZoomOut = function() {
  window.pssSetZoom(currentProofZoom - 0.3);
};

window.pssZoomReset = function() {
  window.pssSetZoom(1.0);
};

window.pssToggleZoom = function() {
  if (currentProofZoom > 1.1) {
    window.pssZoomReset();
  } else {
    window.pssSetZoom(1.85);
  }
};

window.pssOpenLightbox = function() {
  if (!activeProofOrder) return;
  const ss = activeProofOrder.payment_screenshot || activeProofOrder.payment_proof || (activeProofOrder.shipping_address && typeof activeProofOrder.shipping_address === 'object' ? activeProofOrder.shipping_address.payment_screenshot : null);
  if (!ss) return;
  const lb = document.getElementById('pss-lightbox-overlay');
  const lbImg = document.getElementById('pss-lightbox-img');
  const lbTitle = document.getElementById('pss-lightbox-title');
  if (lb && lbImg) {
    lbImg.src = ss;
    if (lbTitle) lbTitle.textContent = 'Payment Proof · Order #' + (activeProofOrder.order_id || activeProofOrder.id) + ' (' + (activeProofOrder.user || 'Customer') + ')';
    lb.style.display = 'flex';
  }
};

window.pssCloseLightbox = function() {
  const lb = document.getElementById('pss-lightbox-overlay');
  if (lb) lb.style.display = 'none';
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    window.pssCloseLightbox();
    closeModal('modal-payment-screenshot');
  }
});

window.openPaymentScreenshotModal = function(orderId) {
  const o = cachedOrders.find(item => (item.id === orderId || item.order_id === orderId));
  if (!o) return;

  activeProofOrder = o;
  window.pssZoomReset();

  const ss = o.payment_screenshot || o.payment_proof || (o.shipping_address && typeof o.shipping_address === 'object' ? o.shipping_address.payment_screenshot : null);

  const subEl = document.getElementById('pss-order-subtitle');
  if (subEl) subEl.textContent = 'Order #' + (o.order_id || o.id);

  const nameEl = document.getElementById('pss-cust-name');
  if (nameEl) nameEl.textContent = o.user || o.userName || 'Customer';

  const m = o.mobile || o.phone || (o.shipping_address && typeof o.shipping_address === 'object' && o.shipping_address.phone) || '';
  const phoneEl = document.getElementById('pss-cust-phone');
  if (phoneEl) phoneEl.textContent = m || 'Not provided';

  const amtEl = document.getElementById('pss-order-amt');
  if (amtEl) amtEl.textContent = formatMoney(o.amount_paise || 0);

  const statEl = document.getElementById('pss-order-status');
  if (statEl) {
    statEl.textContent = o.status || 'processing';
    statEl.style.color = (o.status === 'confirmed' || o.status === 'completed') ? '#10b981' : (o.status === 'cancelled' ? '#ef4444' : '#f59e0b');
  }

  const img = document.getElementById('pss-img-view');
  const openBtn = document.getElementById('pss-open-tab-btn');
  const downloadBtn = document.getElementById('pss-download-btn');
  const noProofMsg = document.getElementById('pss-no-proof-msg');
  const lbImg = document.getElementById('pss-lightbox-img');

  if (ss) {
    if (img) {
      img.src = ss;
      img.style.display = 'block';
    }
    if (lbImg) lbImg.src = ss;
    if (openBtn) {
      openBtn.href = ss;
      openBtn.style.display = 'inline-flex';
    }
    if (downloadBtn) {
      downloadBtn.href = ss;
      downloadBtn.download = 'payment_proof_' + (o.order_id || o.id) + '.png';
      downloadBtn.style.display = 'inline-flex';
    }
    if (noProofMsg) noProofMsg.style.display = 'none';
  } else {
    if (img) img.style.display = 'none';
    if (openBtn) openBtn.style.display = 'none';
    if (downloadBtn) downloadBtn.style.display = 'none';
    if (noProofMsg) noProofMsg.style.display = 'block';
  }

  openModal('modal-payment-screenshot');
};

window.approveCurrentOrderPayment = async function() {
  if (!activeProofOrder) return;
  const id = activeProofOrder.id || activeProofOrder.order_id;
  try {
    await updateLiveOrderStatus(id, 'confirmed');
    closeModal('modal-payment-screenshot');
    showToast(`✓ Order #${id} payment verified and marked confirmed!`, 'success');
  } catch (err) {
    showToast('Failed to approve order: ' + err.message, 'error');
  }
};

window.rejectCurrentOrderPayment = async function() {
  if (!activeProofOrder) return;
  const id = activeProofOrder.id || activeProofOrder.order_id;
  if (!confirm(`Are you sure you want to REJECT order #${id} as FAKE RECEIPT?\n\nThis will prominently show "REJECTED (FAKE RECEIPT)" with a red warning badge to the customer on their portal.`)) return;
  try {
    await updateLiveOrderStatus(id, 'rejected', {
      payment_status: 'fake_receipt_rejected',
      payment_rejection_reason: 'Fake or invalid payment receipt uploaded. Transaction was not credited to our UPI account.'
    });
    closeModal('modal-payment-screenshot');
    showToast(`Order #${id} marked as FAKE RECEIPT / REJECTED on live platform!`, 'warning');
  } catch (err) {
    showToast('Failed to reject order: ' + err.message, 'error');
  }
};
