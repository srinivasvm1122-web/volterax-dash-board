const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Load environment variables from .env if present
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[match[1]] = val;
      }
    }
  }
} catch (e) {
  console.error('[Dashboard] Error reading .env:', e.message);
}

const {
  initStore,
  getAdmins,
  getAdminById,
  createAdmin,
  updateAdminStatus,
  updateAdminPassword,
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  logAction,
  getAuditLogs,
  getLeadNotes,
  updateLeadNote,
  getCustomerNotes,
  updateCustomerNote,
  getSettings,
  updateSettings,
  exportFullBackup
} = require('./lib/store');

const {
  parseCookies,
  buildCookie,
  authenticate,
  login,
  logout,
  requireAuth,
  requireOwner
} = require('./lib/auth');

const bridge = require('./lib/bridge');

// Initialize Store with master Owner credentials
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'srinivasvm1122@gmail.com').toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || Buffer.from('ODEwNTIyNzY0NA==','base64').toString('utf8');
const OWNER_NAME = process.env.OWNER_NAME || 'Srinivas V M';

initStore({
  email: OWNER_EMAIL,
  password: OWNER_PASSWORD,
  name: OWNER_NAME
});

// Configure Live Bridge
bridge.updateCredentials(
  process.env.LIVE_ADMIN_EMAIL || OWNER_EMAIL,
  process.env.LIVE_ADMIN_PASSWORD || OWNER_PASSWORD,
  process.env.LIVE_API_URL || 'https://volterax-vr1c.vercel.app'
);

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

// Helpers
function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...extraHeaders
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let bodyStr = '';
    req.on('data', chunk => {
      bodyStr += chunk;
      if (bodyStr.length > 5 * 1024 * 1024) { // 5MB limit
        req.destroy();
        reject(new Error('Payload too large.'));
      }
    });
    req.on('end', () => {
      try {
        resolve(bodyStr ? JSON.parse(bodyStr) : {});
      } catch (err) {
        reject(new Error('Malformed JSON payload.'));
      }
    });
    req.on('error', reject);
  });
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    '127.0.0.1'
  );
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) {
    return sendJson(res, 404, { error: 'Static resource not found.' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  fs.createReadStream(filePath).pipe(res);
}

// Main HTTP Router
async function handleRequest(req, res) {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method;
    const ip = getClientIp(req);

    // ==============================================================
    // 1. PUBLIC AUTHENTICATION ROUTES
    // ==============================================================
    if (method === 'POST' && pathname === '/api/auth/login') {
      const { email, password } = await parseBody(req);
      try {
        const sessionInfo = login(email, password, ip);
        const cookieHeader = buildCookie('vx_dash_session', sessionInfo.token, sessionInfo.maxAge);
        return sendJson(res, 200, { ok: true, admin: sessionInfo.admin }, { 'Set-Cookie': cookieHeader });
      } catch (err) {
        return sendJson(res, 401, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      const auth = authenticate(req);
      const cookies = parseCookies(req);
      if (cookies.vx_dash_session) {
        logout(cookies.vx_dash_session, auth?.admin?.email);
      }
      return sendJson(res, 200, { ok: true }, {
        'Set-Cookie': buildCookie('vx_dash_session', '', 0)
      });
    }

    if (method === 'GET' && pathname === '/api/auth/me') {
      const auth = authenticate(req);
      if (!auth) {
        return sendJson(res, 401, { error: 'Not authenticated.' });
      }
      return sendJson(res, 200, {
        admin: {
          id: auth.admin.id,
          email: auth.admin.email,
          name: auth.admin.name,
          role: auth.admin.role,
          createdAt: auth.admin.createdAt,
          lastLoginAt: auth.admin.lastLoginAt
        }
      });
    }

    // ==============================================================
    // 2. DASHBOARD DATA ROUTES (Protected by requireAuth)
    // ==============================================================
    if (pathname.startsWith('/api/dashboard/')) {
      const admin = requireAuth(req, res);
      if (!admin) return; // Response handled by requireAuth

      // --- Overview ---
      if (method === 'GET' && pathname === '/api/dashboard/overview') {
        let liveSummary = null;
        let bridgeError = null;

        try {
          liveSummary = await bridge.getSummary();
        } catch (err) {
          bridgeError = err.message;
        }

        const projects = getProjects();
        const admins = getAdmins();

        return sendJson(res, 200, {
          live: liveSummary || {
            customers: 0,
            orders: 0,
            feedback: 0,
            leads: 0,
            revenuePaise: 0
          },
          bridgeStatus: {
            ...bridge.getStatus(),
            error: bridgeError
          },
          local: {
            projectsCount: projects.length,
            activeProjectsCount: projects.filter(p => p.status === 'active').length,
            adminsCount: admins.length,
            recentAuditLogs: getAuditLogs(5)
          },
          timestamp: new Date().toISOString()
        });
      }

      // --- Customers / Users Management ---
      if (method === 'GET' && pathname === '/api/dashboard/customers') {
        let customers = [];
        let error = null;

        try {
          customers = await bridge.getCustomers();
        } catch (err) {
          error = err.message;
        }

        const notes = getCustomerNotes();
        const enriched = customers.map(c => ({
          ...c,
          statusAnnotation: notes[c.id]?.status || 'active',
          internalNotes: notes[c.id]?.notes || ''
        }));

        return sendJson(res, 200, {
          customers: enriched,
          bridgeError: error,
          bridgeStatus: bridge.getStatus()
        });
      }

      if (method === 'PATCH' && pathname.startsWith('/api/dashboard/customers/')) {
        const customerId = pathname.split('/').pop();
        const payload = await parseBody(req);
        const updated = updateCustomerNote(customerId, payload, admin.email);
        return sendJson(res, 200, { ok: true, customerId, annotation: updated });
      }

      // --- Orders Management ---
      if (method === 'GET' && pathname === '/api/dashboard/orders') {
        let orders = [];
        let error = null;

        try {
          orders = await bridge.getOrders();
        } catch (err) {
          error = err.message;
        }

        return sendJson(res, 200, {
          orders,
          bridgeError: error,
          bridgeStatus: bridge.getStatus()
        });
      }

      if (method === 'POST' && pathname === '/api/dashboard/orders') {
        const orderData = await parseBody(req);
        try {
          const result = await bridge.createOrder(orderData);
          logAction(admin.email, 'ORDER_CREATED_LIVE', `Created live order for customer ${orderData.userId || orderData.mobile}`, ip);
          return sendJson(res, 201, { ok: true, result });
        } catch (err) {
          return sendJson(res, 400, { error: `Failed to create order on live platform: ${err.message}` });
        }
      }

      if (method === 'PATCH' && pathname.startsWith('/api/dashboard/orders/')) {
        const orderId = pathname.split('/').pop();
        const orderData = await parseBody(req);
        try {
          const result = await bridge.updateOrder(orderId, orderData);
          logAction(admin.email, 'ORDER_UPDATED_LIVE', `Updated order ${orderId} status to ${orderData.status || 'modified'}`, ip);
          return sendJson(res, 200, { ok: true, result });
        } catch (err) {
          return sendJson(res, 400, { error: `Failed to update order on live platform: ${err.message}` });
        }
      }

      // --- Projects CMS ---
      if (method === 'GET' && pathname === '/api/dashboard/projects') {
        const search = parsedUrl.searchParams.get('search') || '';
        const category = parsedUrl.searchParams.get('category') || '';
        const status = parsedUrl.searchParams.get('status') || '';
        const projects = getProjects({ search, category, status });
        return sendJson(res, 200, { projects, total: projects.length });
      }

      if (method === 'POST' && pathname === '/api/dashboard/projects') {
        const projectData = await parseBody(req);
        try {
          const created = createProject(projectData, admin.email);
          return sendJson(res, 201, { ok: true, project: created });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      if (method === 'PATCH' && pathname.startsWith('/api/dashboard/projects/')) {
        const projectId = pathname.split('/').pop();
        const projectData = await parseBody(req);
        try {
          const updated = updateProject(projectId, projectData, admin.email);
          return sendJson(res, 200, { ok: true, project: updated });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      if (method === 'DELETE' && pathname.startsWith('/api/dashboard/projects/')) {
        const projectId = pathname.split('/').pop();
        try {
          const deleted = deleteProject(projectId, admin.email);
          return sendJson(res, 200, { ok: true, deleted });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      // --- Messages: Feedback & Leads ---
      if (method === 'GET' && pathname === '/api/dashboard/messages') {
        let feedback = [];
        let leads = [];
        let error = null;

        try {
          [feedback, leads] = await Promise.all([
            bridge.getFeedback().catch(e => { error = e.message; return []; }),
            bridge.getLeads().catch(e => { error = e.message; return []; })
          ]);
        } catch (err) {
          error = err.message;
        }

        const leadNotes = getLeadNotes();
        const enrichedLeads = leads.map(l => ({
          ...l,
          internalStatus: leadNotes[l.id]?.internalStatus || 'new',
          internalNotes: leadNotes[l.id]?.notes || '',
          updatedAt: leadNotes[l.id]?.updatedAt || l.createdAt
        }));

        return sendJson(res, 200, {
          feedback,
          leads: enrichedLeads,
          bridgeError: error,
          bridgeStatus: bridge.getStatus()
        });
      }

      if (method === 'PATCH' && pathname.startsWith('/api/dashboard/feedback/')) {
        const feedbackId = pathname.split('/').pop();
        const { status } = await parseBody(req);
        try {
          const result = await bridge.updateFeedbackStatus(feedbackId, status);
          logAction(admin.email, 'FEEDBACK_UPDATED', `Marked feedback ${feedbackId} as ${status}`, ip);
          return sendJson(res, 200, { ok: true, result });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      if (method === 'PATCH' && pathname.startsWith('/api/dashboard/leads/')) {
        const leadId = pathname.split('/').pop();
        const payload = await parseBody(req);
        try {
          const status = payload.internalStatus || payload.status;
          let liveResult = null;
          if (status) {
            try {
              liveResult = await bridge.updateLeadStatus(leadId, status);
            } catch (bErr) {
              console.warn('[Dashboard] Live lead update warning:', bErr.message);
            }
          }
          const note = updateLeadNote(leadId, payload, admin.email);
          return sendJson(res, 200, { ok: true, lead: note, live: liveResult });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      // --- Analytics ---
      if (method === 'GET' && pathname === '/api/dashboard/analytics') {
        let orders = [];
        let customers = [];
        let summary = null;

        try {
          [orders, customers, summary] = await Promise.all([
            bridge.getOrders().catch(() => []),
            bridge.getCustomers().catch(() => []),
            bridge.getSummary().catch(() => null)
          ]);
        } catch (_) {}

        const projects = getProjects();
        const totalRevenue = orders.reduce((sum, o) => sum + Number(o.amount_paise || 0), 0);
        const completedOrders = orders.filter(o => o.status === 'completed');
        const conversionRate = customers.length > 0 ? ((orders.length / customers.length) * 100).toFixed(1) : 0;
        const avgOrderValue = orders.length > 0 ? Math.round(totalRevenue / orders.length / 100) : 0;

        // Group orders by status
        const statusDistribution = {
          pending: orders.filter(o => o.status === 'pending').length,
          confirmed: orders.filter(o => o.status === 'confirmed').length,
          processing: orders.filter(o => o.status === 'processing').length,
          completed: completedOrders.length,
          cancelled: orders.filter(o => o.status === 'cancelled').length
        };

        // Group projects by category
        const categoryCounts = {};
        projects.forEach(p => {
          const cat = p.category || 'OTHER';
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });

        // Referral Leaderboard
        const refMap = {};
        customers.forEach(c => {
          if (c.referredBy) {
            refMap[c.referredBy] = (refMap[c.referredBy] || 0) + 1;
          }
        });
        const topReferrers = Object.entries(refMap)
          .map(([code, count]) => {
            const referrer = customers.find(u => u.ref === code || u.referralCode === code);
            return {
              code,
              count,
              name: referrer ? referrer.name : 'Unknown User',
              mobile: referrer ? referrer.mobile : ''
            };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        return sendJson(res, 200, {
          metrics: {
            totalRevenuePaise: totalRevenue,
            avgOrderValue,
            conversionRate: Number(conversionRate),
            totalCustomers: customers.length,
            totalOrders: orders.length,
            totalProjects: projects.length
          },
          statusDistribution,
          categoryDistribution: categoryCounts,
          topReferrers,
          timestamp: new Date().toISOString()
        });
      }

      // --- Live Bridge Diagnostics & Reconnect ---
      if (method === 'GET' && pathname === '/api/dashboard/bridge/status') {
        return sendJson(res, 200, bridge.getStatus());
      }

      if (method === 'POST' && pathname === '/api/dashboard/bridge/test') {
        const status = await bridge.testConnection();
        return sendJson(res, 200, status);
      }

      // --- Admin Management (Strictly Owner Only) ---
      if (pathname.startsWith('/api/dashboard/admins')) {
        const owner = requireOwner(req, res);
        if (!owner) return;

        if (method === 'GET' && pathname === '/api/dashboard/admins') {
          return sendJson(res, 200, { admins: getAdmins() });
        }

        if (method === 'POST' && pathname === '/api/dashboard/admins') {
          const adminData = await parseBody(req);
          try {
            const created = createAdmin(adminData, owner.email);
            return sendJson(res, 201, { ok: true, admin: created });
          } catch (err) {
            return sendJson(res, 400, { error: err.message });
          }
        }

        if (method === 'PATCH' && pathname.includes('/status')) {
          const parts = pathname.split('/');
          const targetId = parts[parts.indexOf('admins') + 1];
          const { status } = await parseBody(req);
          try {
            const updated = updateAdminStatus(targetId, status, owner.email);
            return sendJson(res, 200, { ok: true, admin: updated });
          } catch (err) {
            return sendJson(res, 400, { error: err.message });
          }
        }

        if (method === 'PATCH' && pathname.includes('/password')) {
          const parts = pathname.split('/');
          const targetId = parts[parts.indexOf('admins') + 1];
          const { password } = await parseBody(req);
          try {
            updateAdminPassword(targetId, password, owner.email);
            return sendJson(res, 200, { ok: true, message: 'Password updated successfully.' });
          } catch (err) {
            return sendJson(res, 400, { error: err.message });
          }
        }
      }

      // --- Audit Logs (Owner Only) ---
      if (method === 'GET' && pathname === '/api/dashboard/audit-logs') {
        const owner = requireOwner(req, res);
        if (!owner) return;
        return sendJson(res, 200, { logs: getAuditLogs(200) });
      }

      // --- Settings ---
      if (method === 'GET' && pathname === '/api/dashboard/settings') {
        return sendJson(res, 200, {
          settings: getSettings(),
          bridgeStatus: bridge.getStatus(),
          isOwner: admin.role === 'owner'
        });
      }

      if (method === 'PATCH' && pathname === '/api/dashboard/settings') {
        const owner = requireOwner(req, res);
        if (!owner) return;
        const settingsData = await parseBody(req);
        const updated = updateSettings(settingsData, owner.email);
        return sendJson(res, 200, { ok: true, settings: updated });
      }

      // --- Full System Backup / Export (Owner Only) ---
      if (method === 'GET' && pathname === '/api/dashboard/export') {
        const owner = requireOwner(req, res);
        if (!owner) return;
        const backup = exportFullBackup();
        const filename = `volterax-backup-${new Date().toISOString().slice(0, 10)}.json`;
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        });
        return res.end(JSON.stringify(backup, null, 2));
      }
    }

    // ==============================================================
    // 3. STATIC FILES & CLIENT PAGES
    // ==============================================================
    const publicDir = path.join(__dirname, 'public');

    if (method === 'GET') {
      if (pathname === '/' || pathname === '/login') {
        return serveStatic(res, path.join(publicDir, 'index.html'));
      }
      if (pathname === '/dashboard') {
        return serveStatic(res, path.join(publicDir, 'dashboard.html'));
      }

      // Serve static assets from public folder
      const safePath = path.normalize(path.join(publicDir, pathname)).replace(/^(\.\.[\/\\])+/, '');
      if (safePath.startsWith(publicDir) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        return serveStatic(res, safePath);
      }
    }

    // Fallback 404
    sendJson(res, 404, { error: 'Endpoint or resource not found.' });
  } catch (err) {
    console.error('[Dashboard Error]', err);
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
}

// Start Server
const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log('==============================================================');
  console.log(`⚡ VOLTERAX PRIVATE ADMIN DASHBOARD RUNNING`);
  console.log(`📡 Local URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`🔐 Master Owner: ${OWNER_EMAIL}`);
  console.log(`🌐 Live API Target: ${bridge.baseUrl}`);
  console.log('==============================================================');
});
