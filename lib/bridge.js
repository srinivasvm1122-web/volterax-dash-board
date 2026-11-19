const https = require('https');
const http = require('http');
const { URL } = require('url');

class VolteraxLiveBridge {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.LIVE_API_URL || 'https://volterax-platform.onrender.com';
    this.adminEmail = config.adminEmail || process.env.LIVE_ADMIN_EMAIL || 'admin@volterax.in';
    this.adminPassword = config.adminPassword || process.env.LIVE_ADMIN_PASSWORD || '';
    this.cookieJar = null;
    this.lastLoginTime = null;
    this.cooldownUntil = Date.now() + 10 * 60 * 1000; // Enforce wait until 11:54 to respect 15-min cooldown
    this.lastStatus = {
      connected: false,
      lastCheck: null,
      error: null,
      latencyMs: null
    };
    this.cache = {
      summary: null,
      customers: null,
      orders: null,
      feedback: null,
      leads: null
    };
  }

  updateCredentials(email, password, baseUrl) {
    if (email) this.adminEmail = email;
    if (password) this.adminPassword = password;
    if (baseUrl) this.baseUrl = baseUrl;
    this.cookieJar = null;
    this.lastLoginTime = null;
  }

  request(pathname, options = {}) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(pathname, this.baseUrl);
      const isHttps = fullUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers = {
        'Accept': 'application/json',
        'User-Agent': 'VOLTERAX-Private-Admin-Bridge/1.0',
        ...(options.headers || {})
      };

      if (this.cookieJar) {
        headers['Cookie'] = this.cookieJar;
      }

      let payload = null;
      if (options.body) {
        payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const reqOptions = {
        method: options.method || 'GET',
        headers,
        timeout: options.timeout || 15000
      };

      const req = transport.request(fullUrl, reqOptions, (res) => {
        // Collect Set-Cookie headers
        const setCookie = res.headers['set-cookie'];
        if (setCookie && Array.isArray(setCookie)) {
          const vxAdminCookie = setCookie.find(c => c.startsWith('vx_admin='));
          if (vxAdminCookie) {
            this.cookieJar = vxAdminCookie.split(';')[0];
          }
        }

        let rawData = '';
        res.on('data', chunk => { rawData += chunk; });
        res.on('end', () => {
          let data = null;
          try {
            data = rawData ? JSON.parse(rawData) : null;
          } catch (_) {
            data = { raw: rawData };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, data, headers: res.headers });
          } else {
            const errorMsg = data && data.error ? data.error : `HTTP ${res.statusCode} from live server`;
            const err = new Error(errorMsg);
            err.statusCode = res.statusCode;
            err.data = data;
            reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Live bridge request timed out after 15s.'));
      });

      req.on('error', (err) => {
        reject(new Error(`Live bridge connection failed: ${err.message}`));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  async login() {
    if (this.cooldownUntil && Date.now() < this.cooldownUntil) {
      const remainingMins = Math.ceil((this.cooldownUntil - Date.now()) / 60000);
      throw new Error(`Official login is cooling down. Please wait ${remainingMins} minute(s) before retry.`);
    }

    if (!this.adminPassword) {
      throw new Error('LIVE_ADMIN_PASSWORD is not configured in .env');
    }

    const t0 = Date.now();
    try {
      const res = await this.request('/api/admin/login', {
        method: 'POST',
        body: {
          email: this.adminEmail,
          password: this.adminPassword
        }
      });

      this.cooldownUntil = 0;
      this.lastLoginTime = Date.now();
      this.lastStatus = {
        connected: true,
        lastCheck: new Date().toISOString(),
        error: null,
        latencyMs: Date.now() - t0
      };
      return res.data;
    } catch (err) {
      this.cookieJar = null;
      if (err.statusCode === 429 || (err.message && err.message.includes('15 minutes'))) {
        this.cooldownUntil = Date.now() + 16 * 60 * 1000;
      }
      this.lastStatus = {
        connected: false,
        lastCheck: new Date().toISOString(),
        error: err.message,
        latencyMs: Date.now() - t0
      };
      throw err;
    }
  }

  async ensureAuth() {
    // If not authenticated or logged in > 6 hours ago, log in
    if (!this.cookieJar || !this.lastLoginTime || (Date.now() - this.lastLoginTime > 6 * 3600 * 1000)) {
      await this.login();
    }
  }

  async authenticatedRequest(pathname, options = {}) {
    try {
      await this.ensureAuth();
      const res = await this.request(pathname, options);
      return res.data;
    } catch (err) {
      // If 401, re-try login once
      if (err.statusCode === 401) {
        this.cookieJar = null;
        try {
          await this.login();
          const retryRes = await this.request(pathname, options);
          return retryRes.data;
        } catch (retryErr) {
          throw retryErr;
        }
      }
      throw err;
    }
  }

  // ---------------- Live Data Readers ----------------
  async getSummary() {
    try {
      const data = await this.authenticatedRequest('/api/admin/summary');
      this.cache.summary = { data, timestamp: new Date().toISOString() };
      return data;
    } catch (err) {
      if (this.cache.summary) {
        return { ...this.cache.summary.data, _cached: true, _cacheTime: this.cache.summary.timestamp, _error: err.message };
      }
      throw err;
    }
  }

  async getCustomers() {
    try {
      const data = await this.authenticatedRequest('/api/admin/customers');
      this.cache.customers = { data, timestamp: new Date().toISOString() };
      return data;
    } catch (err) {
      if (this.cache.customers) return this.cache.customers.data;
      throw err;
    }
  }

  async getOrders() {
    try {
      const data = await this.authenticatedRequest('/api/admin/orders');
      this.cache.orders = { data, timestamp: new Date().toISOString() };
      return data;
    } catch (err) {
      if (this.cache.orders) return this.cache.orders.data;
      throw err;
    }
  }

  async getFeedback() {
    try {
      const data = await this.authenticatedRequest('/api/admin/feedback');
      this.cache.feedback = { data, timestamp: new Date().toISOString() };
      return data;
    } catch (err) {
      if (this.cache.feedback) return this.cache.feedback.data;
      throw err;
    }
  }

  async getLeads() {
    try {
      const data = await this.authenticatedRequest('/api/admin/leads');
      this.cache.leads = { data, timestamp: new Date().toISOString() };
      return data;
    } catch (err) {
      if (this.cache.leads) return this.cache.leads.data;
      throw err;
    }
  }

  // ---------------- Live Data Mutators ----------------
  async createOrder(orderPayload) {
    return await this.authenticatedRequest('/api/admin/order', {
      method: 'POST',
      body: orderPayload
    });
  }

  async updateOrder(orderId, updatePayload) {
    return await this.authenticatedRequest(`/api/admin/order/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      body: updatePayload
    });
  }

  async updateFeedbackStatus(feedbackId, status) {
    return await this.authenticatedRequest(`/api/admin/feedback/${encodeURIComponent(feedbackId)}`, {
      method: 'PATCH',
      body: { status }
    });
  }

  async updateLeadStatus(leadId, status) {
    return await this.authenticatedRequest(`/api/admin/lead/${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      body: { status }
    });
  }

  // ---------------- Bridge Status & Diagnostics ----------------
  async testConnection() {
    const t0 = Date.now();
    try {
      await this.login();
      const latency = Date.now() - t0;
      this.lastStatus = {
        connected: true,
        baseUrl: this.baseUrl,
        adminEmail: this.adminEmail,
        lastCheck: new Date().toISOString(),
        latencyMs: latency,
        error: null
      };
      return this.lastStatus;
    } catch (err) {
      this.lastStatus = {
        connected: false,
        baseUrl: this.baseUrl,
        adminEmail: this.adminEmail,
        lastCheck: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        error: err.message
      };
      return this.lastStatus;
    }
  }

  getStatus() {
    return {
      baseUrl: this.baseUrl,
      adminEmail: this.adminEmail,
      hasPassword: Boolean(this.adminPassword),
      isAuthenticated: Boolean(this.cookieJar),
      ...this.lastStatus
    };
  }
}

// Singleton bridge instance
const bridge = new VolteraxLiveBridge();

module.exports = bridge;
