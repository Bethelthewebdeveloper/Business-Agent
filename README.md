# Business AI Agent

A multi-business customer agent with a dashboard, website chat, order collection, human handoff, follow-up reminders, and an official WhatsApp Business Cloud API integration.

**What the agent is:** a local rule-based engine (Python): keyword intent matching, saved conversation state, and only the information each business configures. It is **not** a language model. It needs **no AI API key**. If it lacks information it says so and creates a handoff instead of guessing. The `respond()` function in `python-agent/agent.py` is the single place a hosted model could be plugged in later.

**What is not included:** no payment gateway, no checkout, no subscriptions, and no waitlist.

## Architecture
```
frontend (HTML/CSS/vanilla JS) -> Node.js backend -> SQLite (node:sqlite)
                                      |-> Python agent service (127.0.0.1:5001)
                                      |-> WhatsApp Cloud API (Meta Graph API)
```
Website chat, the simulator and real WhatsApp all go through the same `backend/pipeline.js` and the same Python agent.

### Deliberate deviations from the original brief (and why)
- **No Express and no npm packages.** The backend uses Node's built-in `http`, `crypto` and `node:sqlite` (Node 22.5+), so `npm install` is not needed and there are no supply-chain dependencies. Routing, rate limiting, sessions and validation live in `backend/`.
- **No Flask.** The Python service uses only the standard library.
- **No Chart.js.** Charts are plain HTML/CSS bars.
- Login and registration are separate pages; each business has one owner account (no memberships table).
- The waitlist and its admin view were removed on request, so there is no administrator account to set up.

## Run locally (Windows + VS Code)
Requirements: **Node.js 22.5 or newer** and **Python 3.9+** (nothing else to install).
1. Open the folder in VS Code, then open a terminal (Ctrl+`).
2. `Copy-Item .env.example .env` (PowerShell) or `copy .env.example .env` (cmd). If `python` is not found, set `PYTHON_BIN=py` in `.env`.
3. `npm start` (starts the Node server **and** the Python agent together).
4. Open http://localhost:3000, create an account, open **Knowledge Base**, add products (or "Load sample catalogue"), then test in **AI Agent** (simulator) or through the website chat link on the Overview page.

To run the Python agent yourself: set `AGENT_AUTOSTART=0`, then in a second terminal `cd python-agent` and `python app.py`.
macOS/Linux: `cp .env.example .env` and `PYTHON_BIN=python3`.

## Tests
```
npm test            # backend: 11 test groups using the real server, the real Python agent and a local stand-in for Meta's Graph API
npm run test:agent  # Python agent unit tests
```
Set `PYTHON_BIN=python3` first if needed. Tests use a temporary database. The Graph API stand-in is a test double: it checks our request handling, **not** that Meta accepts your account.

## WhatsApp setup (real messages)
Requirements vary by account; follow Meta's current docs: https://developers.facebook.com/docs/whatsapp/cloud-api/
1. Create/select a Meta developer app (Business type) and add the **WhatsApp** product.
2. Note your **Phone Number ID** and **WhatsApp Business Account ID**; create an access token with `whatsapp_business_messaging` permission (a system-user token for production).
3. In `.env` set `META_APP_SECRET` (App settings > Basic > App Secret). Without it real webhooks are rejected (503); simulation still works.
4. Make the server reachable over **HTTPS**. Development: a tunnel (e.g. `ngrok http 3000` or Cloudflare Tunnel), then set `PUBLIC_BASE_URL=https://<your-tunnel>`. Production: any HTTPS host/reverse proxy with `NODE_ENV=production` (enables Secure cookies).
5. Dashboard > **Channels & Integrations** > **Connect WhatsApp**: enter the IDs and token (stored server-side only, never returned by the API).
6. The dashboard shows your **Callback URL** (`/webhook/whatsapp`) and **Verify token**. Enter both in Meta's WhatsApp > Configuration and subscribe to the `messages` field.
7. Click **Run connection check**, enable automated replies if wanted, and send a test message to your number.

Notes: "accepted by API" is shown as exactly that, not "delivered"; delivery states update only when Meta's status webhooks arrive. WhatsApp follow-ups are blocked outside the 24-hour customer-service window (approved templates are not implemented). Embedded signup is not implemented; credentials are entered manually.

## Security summary
scrypt password hashing; random session tokens (only their hash is stored) in HttpOnly SameSite=Lax cookies; JSON-only mutations; the business is always derived from the session; per-IP rate limits; webhook HMAC-SHA256 signature verification; idempotent webhook processing; secrets in a separate table; CSP and security headers.

## Troubleshooting
- *"agent service is not reachable"*: Python did not start. Check `PYTHON_BIN` in `.env` or start `python-agent/app.py` manually.
- *`node:sqlite` not found*: upgrade to Node 22.5+.
- *Port in use*: change `PORT` / `AGENT_URL` in `.env`.
- *Meta webhook verification fails*: the verify token must match the dashboard; the URL must be public HTTPS and reach `/webhook/whatsapp`.
- *Messages arrive but no replies*: check automated replies are on, the connection check passed, and "Recent integration error" on the Channels page.

## Known limitations
One owner per business; SQLite only; no template messages; no embedded signup; the agent understands English keywords only; in-memory rate limits reset on restart.
