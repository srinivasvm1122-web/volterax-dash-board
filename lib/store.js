const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'admin-store.json');
const SEED_FILE = path.join(__dirname, 'seed-projects.json');

let store = null;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user || !user.passwordHash || !user.passwordSalt) return false;
  const computed = crypto.scryptSync(password, user.passwordSalt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}

function defaultStore(ownerConfig = {}) {
  let seededProjects = [];
  try {
    if (fs.existsSync(SEED_FILE)) {
      seededProjects = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[Store] Failed to load seed projects:', err.message);
  }

  const ownerEmail = (ownerConfig.email || 'admin@volterax.in').toLowerCase();
  const ownerPassword = ownerConfig.password || 'VolteraxOwner@2026!';
  const hp = hashPassword(ownerPassword);

  const initialOwner = {
    id: 'ADM-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    email: ownerEmail,
    name: ownerConfig.name || 'Volterax Owner',
    role: 'owner', // 'owner' | 'admin' | 'operator'
    status: 'active', // 'active' | 'revoked'
    passwordHash: hp.hash,
    passwordSalt: hp.salt,
    createdAt: new Date().toISOString(),
    lastLoginAt: null
  };

  return {
    admins: [initialOwner],
    projects: seededProjects,
    leadNotes: {},
    customerNotes: {},
    auditLogs: [
      {
        id: 'LOG-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        timestamp: new Date().toISOString(),
        adminEmail: 'system',
        adminRole: 'system',
        action: 'STORE_INITIALIZED',
        details: 'VOLTERAX Private Admin Dashboard data store initialized with pre-seeded hardware catalog.',
        ip: '127.0.0.1'
      }
    ],
    settings: {
      platformName: 'VOLTERAX Hardware Systems',
      liveApiUrl: process.env.LIVE_API_URL || 'https://volterax-vr1c.vercel.app',
      contactPhone: '+91 99000 00000',
      notificationEmail: 'support@volterax.in',
      currency: 'INR',
      maintenanceMode: false,
      autoSyncInterval: 30, // seconds
      updatedAt: new Date().toISOString()
    }
  };
}

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[Store] Failed to persist admin-store.json:', err.message);
  }
}

function initStore(ownerConfig = {}) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_FILE)) {
    try {
      store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      console.error('[Store] Error reading existing store file, resetting fallback:', err.message);
      store = defaultStore(ownerConfig);
      saveStore();
    }
  } else {
    store = defaultStore(ownerConfig);
    saveStore();
  }

  // Ensure mandatory structure
  if (!Array.isArray(store.admins)) store.admins = [];
  if (!Array.isArray(store.projects)) store.projects = [];
  if (!store.leadNotes) store.leadNotes = {};
  if (!store.customerNotes) store.customerNotes = {};
  if (!Array.isArray(store.auditLogs)) store.auditLogs = [];
  if (!store.settings) store.settings = defaultStore(ownerConfig).settings;

  // Ensure owner exists
  const ownerEmail = (ownerConfig.email || 'admin@volterax.in').toLowerCase();
  let owner = store.admins.find(a => a.email === ownerEmail);
  if (!owner) {
    const hp = hashPassword(ownerConfig.password || 'VolteraxOwner@2026!');
    owner = {
      id: 'ADM-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      email: ownerEmail,
      name: ownerConfig.name || 'Volterax Owner',
      role: 'owner',
      status: 'active',
      passwordHash: hp.hash,
      passwordSalt: hp.salt,
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    };
    store.admins.unshift(owner);
    saveStore();
  }

  return store;
}

// ---------------- Admin Management ----------------
function getAdmins() {
  return store.admins.map(a => ({
    id: a.id,
    email: a.email,
    name: a.name,
    role: a.role,
    status: a.status,
    createdAt: a.createdAt,
    lastLoginAt: a.lastLoginAt
  }));
}

function getAdminByEmail(email) {
  if (!email) return null;
  return store.admins.find(a => a.email.toLowerCase() === email.toLowerCase().trim()) || null;
}

function getAdminById(id) {
  return store.admins.find(a => a.id === id) || null;
}

function createAdmin({ email, name, role, password }, actorEmail = 'system') {
  const cleanEmail = String(email || '').toLowerCase().trim();
  if (!cleanEmail || !name || !password) {
    throw new Error('Email, name, and temporary password are required.');
  }
  if (store.admins.some(a => a.email === cleanEmail)) {
    throw new Error('An admin with this email address already exists.');
  }

  const validRoles = ['admin', 'operator'];
  const assignedRole = validRoles.includes(role) ? role : 'admin';

  const hp = hashPassword(password);
  const newAdmin = {
    id: 'ADM-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    email: cleanEmail,
    name: String(name).trim(),
    role: assignedRole,
    status: 'active',
    passwordHash: hp.hash,
    passwordSalt: hp.salt,
    createdAt: new Date().toISOString(),
    lastLoginAt: null
  };

  store.admins.push(newAdmin);
  logAction(actorEmail, 'ADMIN_CREATED', `Created new ${assignedRole} account for ${cleanEmail}`);
  saveStore();

  return {
    id: newAdmin.id,
    email: newAdmin.email,
    name: newAdmin.name,
    role: newAdmin.role,
    status: newAdmin.status,
    createdAt: newAdmin.createdAt
  };
}

function updateAdminStatus(id, newStatus, actorEmail = 'system') {
  const admin = store.admins.find(a => a.id === id);
  if (!admin) throw new Error('Admin not found.');
  if (admin.role === 'owner') throw new Error('Cannot revoke or suspend the master Owner account.');

  if (!['active', 'revoked'].includes(newStatus)) {
    throw new Error('Invalid status.');
  }

  admin.status = newStatus;
  logAction(actorEmail, 'ADMIN_STATUS_CHANGED', `Changed status of ${admin.email} to ${newStatus}`);
  saveStore();
  return admin;
}

function updateAdminPassword(id, newPassword, actorEmail = 'system') {
  const admin = store.admins.find(a => a.id === id);
  if (!admin) throw new Error('Admin not found.');
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }

  const hp = hashPassword(newPassword);
  admin.passwordHash = hp.hash;
  admin.passwordSalt = hp.salt;
  logAction(actorEmail, 'ADMIN_PASSWORD_CHANGED', `Password updated for ${admin.email}`);
  saveStore();
  return true;
}

// ---------------- Projects CMS ----------------
function getProjects(filter = {}) {
  let list = [...store.projects];
  if (filter.category) {
    const cat = filter.category.toLowerCase();
    list = list.filter(p => p.category && p.category.toLowerCase().includes(cat));
  }
  if (filter.status) {
    list = list.filter(p => p.status === filter.status);
  }
  if (filter.search) {
    const q = filter.search.toLowerCase();
    list = list.filter(p =>
      (p.title && p.title.toLowerCase().includes(q)) ||
      (p.code && p.code.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    );
  }
  return list;
}

function getProjectById(id) {
  return store.projects.find(p => p.id === id || p.code === id) || null;
}

function createProject(data, actorEmail = 'system') {
  if (!data.title) throw new Error('Project title is required.');
  
  const nextNum = store.projects.length + 1;
  const code = data.code || `VX / ${String(nextNum).padStart(2, '0')}`;
  const id = 'VX-' + String(nextNum).padStart(2, '0') + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

  const newProj = {
    id,
    code,
    title: String(data.title).trim(),
    category: String(data.category || 'EMBEDDED SYSTEMS').trim().toUpperCase(),
    description: String(data.description || '').trim(),
    image: String(data.image || 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80').trim(),
    price: Number(data.price || 4999),
    status: data.status === 'draft' ? 'draft' : 'active',
    featured: Boolean(data.featured),
    tags: Array.isArray(data.tags) ? data.tags : ['hardware', 'prototype'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.projects.unshift(newProj);
  logAction(actorEmail, 'PROJECT_CREATED', `Added new project: ${newProj.title} (${newProj.code})`);
  saveStore();
  return newProj;
}

function updateProject(id, data, actorEmail = 'system') {
  const cleanId = String(id || '').toUpperCase().replace(/\s+/g, '');
  const p = store.projects.find(x => 
    (x.id && x.id.toUpperCase().replace(/\s+/g, '') === cleanId) ||
    (x.code && x.code.toUpperCase().replace(/\s+/g, '') === cleanId)
  );
  if (!p) throw new Error('Project not found: ' + id);

  if (data.title !== undefined) p.title = String(data.title).trim();
  if (data.category !== undefined) p.category = String(data.category).trim().toUpperCase();
  if (data.description !== undefined) p.description = String(data.description).trim();
  if (data.image !== undefined) p.image = String(data.image).trim();
  if (data.price !== undefined) p.price = Number(data.price);
  if (data.status !== undefined) p.status = data.status;
  if (data.featured !== undefined) p.featured = Boolean(data.featured);
  if (Array.isArray(data.tags)) p.tags = data.tags;
  p.updatedAt = new Date().toISOString();

  logAction(actorEmail, 'PROJECT_UPDATED', `Updated project ${p.code} (${p.title}) price to ₹${p.price}`);
  saveStore();
  return p;
}

function deleteProject(id, actorEmail = 'system') {
  const cleanId = String(id || '').toUpperCase().replace(/\s+/g, '');
  const idx = store.projects.findIndex(x => 
    (x.id && x.id.toUpperCase().replace(/\s+/g, '') === cleanId) ||
    (x.code && x.code.toUpperCase().replace(/\s+/g, '') === cleanId)
  );
  if (idx === -1) throw new Error('Project not found.');
  const removed = store.projects.splice(idx, 1)[0];
  logAction(actorEmail, 'PROJECT_DELETED', `Deleted project ${removed.code} (${removed.title})`);
  saveStore();
  return removed;
}

function syncStoreProjects(liveProjects) {
  if (!Array.isArray(liveProjects) || !store) return;
  liveProjects.forEach(lp => {
    const cleanId = String(lp.id || lp.code || '').toUpperCase().replace(/\s+/g, '');
    const existing = store.projects.find(x => 
      (x.id && x.id.toUpperCase().replace(/\s+/g, '') === cleanId) ||
      (x.code && x.code.toUpperCase().replace(/\s+/g, '') === cleanId)
    );
    if (existing) {
      if (lp.price !== undefined) existing.price = Number(lp.price);
      if (lp.title) existing.title = lp.title;
      if (lp.description) existing.description = lp.description;
      if (lp.image) existing.image = lp.image;
      if (lp.category) existing.category = lp.category;
      if (lp.status) existing.status = lp.status;
    } else {
      store.projects.push(lp);
    }
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://arwwwcfgxiuhrkqevdov.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_zkN2gnKmhUXwbGiuorYyKQ_-mURTLot';

let pgPool = null;
try {
  const { Pool } = require('pg');
  const dbUrl = process.env.DATABASE_URL || Buffer.from('cG9zdGdyZXNxbDovL3Bvc3RncmVzOiUyM0NoYW5kYW4uMzYwQGRiLmFyd3d3Y2ZneGl1aHJrcWV2ZG92LnN1cGFiYXNlLmNvOjU0MzIvcG9zdGdyZXM=','base64').toString('utf8');
  pgPool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
} catch (e) {
  console.warn('[Dashboard Store] pg not available:', e.message);
}

async function syncProjectToSupabase(project, isDelete = false) {
  if (pgPool && project) {
    try {
      if (isDelete) {
        await pgPool.query('DELETE FROM projects WHERE id = $1 OR code = $1', [project.id]);
        if (project.code) await pgPool.query('DELETE FROM projects WHERE code = $1 OR id = $1', [project.code]);
      } else {
        await pgPool.query(`
          INSERT INTO projects (id, code, title, category, price, image, specs, features, badge, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            category = EXCLUDED.category,
            price = EXCLUDED.price,
            image = EXCLUDED.image,
            code = EXCLUDED.code;
        `, [project.id, project.code || project.id, project.title, project.category || 'HARDWARE', Number(project.price || 0), project.image || '', JSON.stringify(project.specs || []), JSON.stringify(project.features || []), project.badge || '', project.createdAt || new Date()]);
      }
    } catch (pgErr) {
      console.warn('[Dashboard Store pg sync notice]', pgErr.message);
    }
  }
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY || !project) return;
    const pId = encodeURIComponent(project.id || project.code);
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };

    if (isDelete) {
      await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${pId}`, {
        method: 'DELETE',
        headers
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${pId}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          title: project.title,
          category: project.category,
          price: Number(project.price || 0),
          description: project.description,
          image: project.image,
          status: project.status || 'active',
          featured: Boolean(project.featured)
        })
      });
    }

    // Also synchronize into volterax_store row 'main' so REST reads get identical prices
    try {
      const storeRes = await fetch(`${SUPABASE_URL}/rest/v1/volterax_store?id=eq.main&select=*`, {
        headers
      });
      if (storeRes.ok) {
        const rows = await storeRes.json();
        if (rows && rows.length > 0 && rows[0].data) {
          const storeData = rows[0].data;
          if (Array.isArray(storeData.projects)) {
            const cleanId = (project.id || '').toUpperCase().replace(/\s+/g, '');
            const cleanCode = (project.code || '').toUpperCase().replace(/\s+/g, '');
            const idx = storeData.projects.findIndex(p => {
              const pid = (p.id || '').toUpperCase().replace(/\s+/g, '');
              const pcode = (p.code || '').toUpperCase().replace(/\s+/g, '');
              return (cleanId && pid === cleanId) || (cleanCode && pcode === cleanCode);
            });
            if (isDelete && idx !== -1) {
              storeData.projects.splice(idx, 1);
            } else if (!isDelete && idx !== -1) {
              storeData.projects[idx] = { ...storeData.projects[idx], ...project };
            } else if (!isDelete && idx === -1) {
              storeData.projects.unshift(project);
            }
            await fetch(`${SUPABASE_URL}/rest/v1/volterax_store?id=eq.main`, {
              method: 'PATCH',
              headers: { ...headers, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ data: storeData, updated_at: new Date().toISOString() })
            });
          }
        }
      }
    } catch (storeErr) {
      console.warn('[Dashboard store sync notice]', storeErr.message);
    }
  } catch (err) {
    console.error('[Supabase Direct Sync Notice]', err.message);
  }
}

// ---------------- Audit & Activity Logging ----------------
function logAction(adminEmail, action, details, ip = '127.0.0.1') {
  if (!store) return;
  const entry = {
    id: 'LOG-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    timestamp: new Date().toISOString(),
    adminEmail: adminEmail || 'unknown',
    action: action || 'ACTION',
    details: details || '',
    ip: ip || '127.0.0.1'
  };
  store.auditLogs.unshift(entry);
  if (store.auditLogs.length > 500) {
    store.auditLogs = store.auditLogs.slice(0, 500);
  }
  saveStore();
}

function getAuditLogs(limit = 100) {
  return store.auditLogs.slice(0, limit);
}

// ---------------- Lead & Customer Notes ----------------
function getLeadNotes() {
  return store.leadNotes || {};
}

function updateLeadNote(leadId, { internalStatus, notes }, actorEmail = 'system') {
  if (!store.leadNotes[leadId]) {
    store.leadNotes[leadId] = { internalStatus: 'new', notes: '', history: [] };
  }
  if (internalStatus) store.leadNotes[leadId].internalStatus = internalStatus;
  if (notes !== undefined) store.leadNotes[leadId].notes = notes;
  store.leadNotes[leadId].updatedAt = new Date().toISOString();
  store.leadNotes[leadId].updatedBy = actorEmail;

  logAction(actorEmail, 'LEAD_NOTE_UPDATED', `Updated lead status/notes for ${leadId} to ${internalStatus || 'updated'}`);
  saveStore();
  return store.leadNotes[leadId];
}

function getCustomerNotes() {
  return store.customerNotes || {};
}

function updateCustomerNote(customerId, { status, notes }, actorEmail = 'system') {
  if (!store.customerNotes[customerId]) {
    store.customerNotes[customerId] = { status: 'active', notes: '' };
  }
  if (status) store.customerNotes[customerId].status = status;
  if (notes !== undefined) store.customerNotes[customerId].notes = notes;
  store.customerNotes[customerId].updatedAt = new Date().toISOString();

  logAction(actorEmail, 'CUSTOMER_NOTE_UPDATED', `Updated customer annotations for ${customerId}`);
  saveStore();
  return store.customerNotes[customerId];
}

// ---------------- Settings & Export ----------------
function getSettings() {
  return store.settings;
}

function updateSettings(data, actorEmail = 'system') {
  store.settings = {
    ...store.settings,
    ...data,
    updatedAt: new Date().toISOString()
  };
  logAction(actorEmail, 'SETTINGS_UPDATED', 'Updated dashboard settings');
  saveStore();
  return store.settings;
}

function exportFullBackup() {
  return {
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    store
  };
}

module.exports = {
  initStore,
  hashPassword,
  verifyPassword,
  getAdmins,
  getAdminByEmail,
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
  exportFullBackup,
  syncStoreProjects,
  syncProjectToSupabase
};
