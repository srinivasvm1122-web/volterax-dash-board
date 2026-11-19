const crypto = require('crypto');
const { getAdminByEmail, getAdminById, verifyPassword, logAction, initStore } = require('./store');

const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
const SESSION_SECRET = process.env.SESSION_SECRET || 'vx_master_secret_f83a9921bc824e8e91024bd3230a6e7192';

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;

  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts.shift().trim();
    const val = decodeURIComponent(parts.join('='));
    list[name] = val;
  });

  return list;
}

function buildCookie(name, value, maxAgeSeconds) {
  const isProd = process.env.NODE_ENV === 'production';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; ${isProd ? 'Secure;' : ''}`;
}

function createSessionToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (Date.now() > payload.expires) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function authenticate(req) {
  const cookies = parseCookies(req);
  const token = cookies.vx_dash_session;
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const admin = getAdminById(payload.adminId) || getAdminByEmail(payload.email);
  if (!admin || admin.status === 'revoked') {
    return null;
  }

  return { admin, sessionToken: token };
}

function login(email, password, ip = '127.0.0.1') {
  const admin = getAdminByEmail(email);
  if (!admin) {
    logAction(email || 'anonymous', 'LOGIN_FAILED', 'Failed login attempt: unknown email', ip);
    throw new Error('Invalid email or password.');
  }

  if (admin.status === 'revoked') {
    logAction(admin.email, 'LOGIN_BLOCKED', 'Attempted login to revoked admin account', ip);
    throw new Error('Your admin access has been revoked by the system owner.');
  }

  const isValid = verifyPassword(password, admin);
  if (!isValid) {
    logAction(admin.email, 'LOGIN_FAILED', 'Failed login attempt: incorrect password', ip);
    throw new Error('Invalid email or password.');
  }

  admin.lastLoginAt = new Date().toISOString();
  const expires = Date.now() + SESSION_TTL;

  const token = createSessionToken({
    adminId: admin.id,
    email: admin.email,
    role: admin.role,
    expires
  });

  logAction(admin.email, 'LOGIN_SUCCESS', `Admin logged in successfully (${admin.role})`, ip);

  return {
    token,
    maxAge: Math.floor(SESSION_TTL / 1000),
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role
    }
  };
}

function logout(token, adminEmail = 'unknown') {
  logAction(adminEmail, 'LOGOUT', 'Admin signed out');
}

function requireAuth(req, res) {
  const auth = authenticate(req);
  if (!auth) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'Set-Cookie': buildCookie('vx_dash_session', '', 0)
    });
    res.end(JSON.stringify({ error: 'Authentication required. Please sign in.' }));
    return null;
  }
  return auth.admin;
}

function requireOwner(req, res) {
  const admin = requireAuth(req, res);
  if (!admin) return null;

  if (admin.role !== 'owner') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Access denied: Master Owner permission required for this action.' }));
    return null;
  }
  return admin;
}

module.exports = {
  parseCookies,
  buildCookie,
  authenticate,
  login,
  logout,
  requireAuth,
  requireOwner
};
