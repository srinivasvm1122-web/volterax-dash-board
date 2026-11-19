# VOLTERAX — Private Admin Dashboard

> A standalone, secure, and professional operations dashboard for the **VOLTERAX** engineering platform.
> Live Website: [https://volterax-platform.onrender.com](https://volterax-platform.onrender.com)

---

## ⚡ 1. Overview & Architecture

The **VOLTERAX Private Admin Dashboard** is built as a **completely independent project** that connects securely to the live VOLTERAX platform via server-side API requests.

### Key Architectural Highlights:
- **Zero Frontend Secrets**: Sensitive credentials (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, session keys, database tokens) are **never** exposed in frontend HTML or JavaScript.
- **Server-Side Live Bridge**: All communication with the live Render website runs securely through server-to-server requests using verified session cookies (`vx_admin`).
- **Complete Isolation**: The main website's code and live MongoDB database are preserved intact with zero modifications, zero downtime, and zero deployment conflicts.
- **Pre-Loaded Projects CMS**: Contains the complete, curated catalog of **30 real hardware engineering projects** extracted directly from the VOLTERAX store (Robotics, IoT, Agri-Tech, Safety, and Embedded Systems).
- **Private Access Control**: Public sign-ups are strictly disabled. Only the Master Owner can authorize, approve, or revoke administrative access.

---

## 🛡️ 2. Security & Access Model

| Layer | Implementation |
|---|---|
| **Authentication** | Server-side cryptographic password verification using Node.js `crypto.scryptSync` with unique 16-byte cryptographic salts. |
| **Session Management** | Cryptographically random 32-byte tokens (`crypto.randomBytes(32)`), transmitted strictly via `HttpOnly`, `SameSite=Lax`, and `Secure` (production) cookies. |
| **Role-Based Access (RBAC)** | **Owner**: Full access, can authorize/revoke admins, access security audit logs, export full backups.<br>**Admin**: Full day-to-day management of orders, projects, messages, and customers.<br>**Operator**: Read-only oversight and order processing. |
| **Audit Registry** | All admin logins, order updates, project changes, and credential modifications are permanently timestamped with IP addresses in the audit registry. |

---

## 🚀 3. Dashboard Features

1. **Overview**:
   - Real-time telemetry: Total live customers, active hardware projects (30), custom customer orders, live gross revenue (₹ INR), and order conversion rate.
   - Live Bridge Status pill with instant ping latency indicator.
   - Interactive Canvas chart tracking financial volume and order growth.
   - Recent live customer orders feed.
2. **Users Management**:
   - Complete directory of registered customer accounts.
   - Search by customer name, 10-digit mobile number, or referral code.
   - One-click phone calling and WhatsApp contact shortcuts.
   - Customer status annotations (Active / Flagged).
3. **Projects Management (CMS)**:
   - Full CMS for the VOLTERAX hardware catalog.
   - Add new hardware project concepts with title, category, code, pricing (₹), visual image URL, and technical description.
   - Edit existing project concepts and toggle status (Active / Draft).
   - Category filtering across **Robotics**, **IoT & Automation**, **Agri-Tech**, **Safety Systems**, and **Embedded Systems**.
4. **Orders Management**:
   - Real-time order pipeline with live synchronization to `https://volterax-platform.onrender.com`.
   - Update order status with one click (`pending`, `confirmed`, `processing`, `completed`, `cancelled`).
   - Create custom project commission orders directly into the live database.
   - Inspect technical requirements and component build specs.
5. **Messages, Enquiries & Feedback**:
   - **Project Leads**: Review custom project inquiries, customer phone numbers, and engineering briefs with one-click WhatsApp web links and internal note tracking (`new`, `contacted`, `quoted`, `closed`).
   - **Customer Feedback**: Real-time customer reviews with star ratings (1-5 gold stars) and one-click "Mark as Read" live syncing.
6. **Analytics & Business Intelligence**:
   - Financial intelligence: Average Order Value (AOV), Conversion Rate, and Gross Revenue.
   - Interactive Canvas donut chart for order status distribution.
   - Interactive Canvas bar chart for projects by tech domain.
   - Top Referrals Leaderboard identifying super-connectors.
7. **Admin Management (Owner Only)**:
   - Authorize new administrators with customized roles and temporary passwords.
   - Revoke or suspend administrative accounts instantly.
   - Live Security Audit Log streaming all administrative events.
8. **Settings & Data Backup**:
   - Live API Bridge diagnostics and connection re-test tool.
   - Personal admin password updater.
   - **1-Click Full JSON Backup**: Download a complete snapshot of projects, admins, orders, and audit logs.

---

## 💻 4. Local Development

### 1. Prerequisites
- Node.js (version 18.0.0 or higher)

### 2. Setup & Installation
```bash
# Navigate to the dashboard directory
cd "c:\Users\srini\OneDrive\Desktop\volterx dashboard"

# Install dependencies (Self-contained, standard Node.js runtime)
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env` (a ready-to-run `.env` is already configured for local testing):
```env
PORT=4000
NODE_ENV=development

# Master Owner Account
OWNER_EMAIL=admin@volterax.in
OWNER_PASSWORD=VolteraxOwner@2026!
OWNER_NAME=Volterax Founder

# Live VOLTERAX API Bridge
LIVE_API_URL=https://volterax-platform.onrender.com
LIVE_ADMIN_EMAIL=admin@volterax.in
LIVE_ADMIN_PASSWORD=REPLACE_WITH_YOUR_RENDER_ADMIN_PASSWORD
```

> **Note**: To connect the live API bridge to your live Render website, place your live website's `ADMIN_PASSWORD` (configured in your Render environment) into `LIVE_ADMIN_PASSWORD`.

### 4. Start the Dashboard
```bash
npm start
```

Open your browser at:  
👉 **`http://localhost:4000`**

- **Default Master Owner Email**: `admin@volterax.in`
- **Default Master Owner Password**: `VolteraxOwner@2026!`

---

## ☁️ 5. Step-by-Step Render Deployment Guide

Follow these steps to deploy this dashboard on Render as a **completely separate Web Service** while keeping your main website untouched:

### Step 1: Push to GitHub
1. Create a new, separate repository on GitHub (e.g. `volterax-admin-dashboard`).
2. Push this project code:
   ```bash
   cd "c:\Users\srini\OneDrive\Desktop\volterx dashboard"
   git init
   git add .
   git commit -m "Initial commit: VOLTERAX Private Admin Dashboard"
   git branch -M main
   git remote add origin https://github.com/<your-username>/volterax-admin-dashboard.git
   git push -u origin main
   ```

### Step 2: Create Web Service on Render
1. Log in to your [Render Dashboard](https://dashboard.render.com).
2. Click **New +** in the top right and select **Web Service**.
3. Select your new `volterax-admin-dashboard` repository.
4. Configure the service settings:
   - **Name**: `volterax-admin` (will give you a URL like `https://volterax-admin.onrender.com`)
   - **Region**: Choose the same region as your main site (e.g. Oregon or Singapore)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free` (or `Starter`)

### Step 3: Add Environment Variables in Render
In the **Environment Variables** section of your new Render Web Service, add:

| Key | Recommended Value | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Enables production security and secure cookies |
| `PORT` | `10000` | Port automatically routed by Render |
| `OWNER_EMAIL` | `admin@volterax.in` | Master owner login email |
| `OWNER_PASSWORD` | `<your_strong_admin_password>` | Master owner login password |
| `OWNER_NAME` | `Volterax Founder` | Display name for the master owner |
| `LIVE_API_URL` | `https://volterax-platform.onrender.com` | Target URL of your main website |
| `LIVE_ADMIN_EMAIL` | `admin@volterax.in` | Existing admin email on main website |
| `LIVE_ADMIN_PASSWORD` | `<main_website_admin_password>` | The `ADMIN_PASSWORD` of your main site |
| `SESSION_SECRET` | `<random_alphanumeric_string>` | Salt for session cookie verification |

### Step 4: Deploy & Access
1. Click **Create Web Service**.
2. Render will build and deploy the dashboard in under 2 minutes.
3. Access your private admin dashboard at:  
   👉 **`https://volterax-admin.onrender.com`**

---

## 🔒 6. Operational Verification Checklist

- [x] **Completely Separate**: Independent codebase, independent process, independent deployment.
- [x] **Main Website Intact**: `https://volterax-platform.onrender.com` remains completely untouched.
- [x] **No Public Signups**: Public registration route does not exist.
- [x] **No Secrets in Frontend**: Zero API keys or database connection strings in client-side code.
- [x] **Live Bridge Verified**: Communicates directly with main platform via server-side session cookies.
- [x] **All 8 Modules Operational**: Overview, Users, Projects CMS (30 concepts), Orders, Messages, Analytics, Admin Access, and Settings.
- [x] **Full Backup Export**: Instant JSON snapshot download available in Settings.

---

© VOLTERAX Engineering. All rights reserved.
