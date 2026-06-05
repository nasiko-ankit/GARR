# GARR — Full Demo Walkthrough
### Screen Recording Script · End-to-End

---

## What this demo shows

> "Two organisations — Nasiko Labs and ACME Corp — register their AI agents in GARR, the Global Agent Root Registry. Any client can then discover and invoke those agents through a verified trust chain."

**The 3 layers you will demo:**
1. **Register a Registry** — Org proves domain ownership → GARR signs and stores the record
2. **Register an Agent** — Org adds agents to their own RAP server via the RAP Manager UI
3. **Resolve an Agent** — Client resolves `weather@google.com:global` → GARR fetches the AgentCard from the RAP's real public HTTPS URL → verifies both ed25519 signatures → returns the card

**Two real public HTTPS URLs — two separate organisations on different providers:**
- nasiko → `https://abdomen-rescuer-zigzagged.ngrok-free.dev` (ngrok)
- acme → `https://e4bab68d94cbcf87-27-4-93-12.serveousercontent.com` (serveo)

---

## PHASE 0 — Start All Services

Open **6 separate terminal tabs**. Run one command per tab.

---

### Tab 1 — GARR Backend
```bash
cd "/Users/chamansinghal/Documents/Nasiko /GARR"
npm run dev
```
**Wait for:** `Server listening at http://0.0.0.0:3001`

---

### Tab 2 — nasiko RAP Server
```bash
cd "/Users/chamansinghal/Documents/Nasiko /GARR/examples/rap-server"
npm run dev
```
**Wait for:** `Server listening at http://0.0.0.0:3002`

---

### Tab 3 — acme RAP Server
```bash
cd "/Users/chamansinghal/Documents/Nasiko /GARR/examples/rap-server-acme"
npm run dev
```
**Wait for:** `Server listening at http://0.0.0.0:3003`

---

### Tab 4 — Weather Agent (Nasiko's A2A agent)
```bash
cd "/Users/chamansinghal/Documents/Nasiko /GARR/agents/weather/a2a-weather-agent"
OPENROUTER_API_KEY="<get your OpenRouter API key from openrouter.ai>" \
OPENROUTER_MODEL="nvidia/nemotron-3-super-120b-a12b:free" \
PYTHONPATH=src python3 -m src --host 0.0.0.0 --port 5010
```
**Wait for:** `Uvicorn running on http://0.0.0.0:5010`

---

### Tab 5 — Translator Agent (ACME's A2A agent)
```bash
cd "/Users/chamansinghal/Documents/Nasiko /GARR/agents/translator/a2a-translator"
OPENROUTER_API_KEY="<get your OpenRouter API key from openrouter.ai>" \
OPENROUTER_MODEL="nvidia/nemotron-3-super-120b-a12b:free" \
PYTHONPATH=src python3 -m src --host 0.0.0.0 --port 5011
```
**Wait for:** `Uvicorn running on http://0.0.0.0:5011`

---

### Tab 6 — Frontend
```bash
cd "/Users/chamansinghal/Documents/Nasiko /garr-web"
npm run dev
```
**Wait for:** `Ready in ...ms`

---

## PHASE 1 — Expose Both RAPs to the Internet

> **Why tunnels?** GARR is a production registry. When you register an organisation, GARR makes a real HTTPS request to your RAP URL to confirm it is reachable. Both orgs need a real public HTTPS URL — on different providers to show they are truly independent organisations.

### Tab 7 — ngrok for nasiko RAP (port 3002)

```bash
ngrok http 3002
```

**You will see output like:**
```
Forwarding  https://abdomen-rescuer-zigzagged.ngrok-free.dev -> http://localhost:3002
```

**Copy the `https://` URL** — this is nasiko's public RAP URL.

### Tab 8 — serveo for acme RAP (port 3003)

```bash
ssh -R 80:localhost:3003 serveo.net
```

**You will see output like:**
```
Forwarding HTTP traffic from https://e4bab68d94cbcf87-27-4-93-12.serveousercontent.com
```

**Copy the `https://` URL** — this is acme's public RAP URL.

### Verify both tunnels are working — run in a new terminal:
```bash
curl -s https://abdomen-rescuer-zigzagged.ngrok-free.dev/health
curl -s https://e4bab68d94cbcf87-27-4-93-12.serveousercontent.com/health
```
**Expected for both:** `{"status":"ok","db":"ok"}`

> Your URLs will be different each time you start the tunnels. Use whatever URLs you get.

---

## PHASE 2 — Verify Health (Show on Screen)

Open browser. Go to:
```
http://localhost:3001/health
```
Show result: `{"status":"ok","db":"ok"}`

Then open the frontend:
```
http://localhost:3000
```
Show the GARR homepage with all navigation links visible.

---

## PHASE 3 — Register Nasiko Labs (Registry 1)

### Navigate to:
```
http://localhost:3000/register
```

### Step 1 of 2 — Fill the form

| Field | Value to type |
|-------|--------------|
| **Owner ID** | `nasiko` |
| **Display Name** | `Nasiko Labs` |
| **Domain** | `google.com` |
| **Contact Email** | `chaman@nasiko.com` |
| **RAP URL** | `https://abdomen-rescuer-zigzagged.ngrok-free.dev` ← your ngrok URL |
| **RAP Fallback URL** | *(leave blank)* |
| **Key ID** | auto-filled — see below |
| **TTL Seconds** | `86400` |
| **Auth Algorithm** | auto-filled — see below |
| **Public Key** | auto-filled — see below |

**After filling in the RAP URL:**
1. Also fill in **RAP Admin Key**: `<get from examples/rap-server/.env — ADMIN_API_KEY>`
2. Click **"Fetch from RAP ✓"** (green button)
   - Key ID, Algorithm, and Public Key all fill automatically
   - Green box: **"Key fetched from RAP server — this key matches what your RAP uses to sign agent cards"**

Click **"Submit registration"**

> **Behind the scenes:** GARR checks DMARC at `_dmarc.google.com` (real DNS), sends HEAD to the ngrok URL to verify reachability, and returns a 64-char hex challenge nonce.

### Step 2 of 2 — Sign the Challenge (fully automatic — no terminal needed)

The screen shows the challenge nonce and a **"Sign via RAP ✓"** green button.

Click **"Sign via RAP ✓"**

> The browser sends the nonce to your RAP server, which signs it with its private key and returns the base64 signature. The signature field fills automatically.

Click **"Verify & complete"**

**Expected result:** Green success screen showing `Serial: 2026060600`

---

## PHASE 4 — Register ACME Corp (Registry 2)

Navigate back to:
```
http://localhost:3000/register
```

### Step 1 of 2 — Fill the form

| Field | Value to type |
|-------|--------------|
| **Owner ID** | `acme` |
| **Display Name** | `ACME Corp` |
| **Domain** | `spotify.com` |
| **Contact Email** | `admin@acme.demo` |
| **RAP URL** | `https://e4bab68d94cbcf87-27-4-93-12.serveousercontent.com` ← your serveo URL |
| **RAP Fallback URL** | *(leave blank)* |
| **Key ID** | auto-filled |
| **TTL Seconds** | `86400` |
| **Auth Algorithm** | auto-filled |
| **Public Key** | auto-filled |

**After filling in the RAP URL:**
1. Also fill in **RAP Admin Key**: `<get from examples/rap-server-acme/.env — ADMIN_API_KEY>`
2. Click **"Fetch from RAP ✓"** (green button) — Key ID, Algorithm, Public Key fill automatically

Click **"Submit registration"**

### Step 2 of 2 — Sign the Challenge (fully automatic — no terminal needed)

Click **"Sign via RAP ✓"** — signature fills automatically.

Click **"Verify & complete"**

**Expected result:** Green success screen for ACME Corp.

---

## PHASE 5 — Browse Both Registries

Navigate to:
```
http://localhost:3000/registries
```

**What to show:**
- Table shows **2 rows**: `nasiko` and `acme`, both `active`
- Click `nasiko` row → right panel shows:
  - Domain: `google.com`
  - RAP URL: `https://abdomen-rescuer-zigzagged.ngrok-free.dev`
  - Signed by: `garr-dev-2026`
  - Serial, expiry, public key, Raw JSON
- Click `acme` row → right panel shows:
  - Domain: `spotify.com`
  - RAP URL: `https://e4bab68d94cbcf87-27-4-93-12.serveousercontent.com`
  - Signed by: `garr-dev-2026`

**Filter demo:**
- Click `active` → both still shown
- Click `stale` → empty table
- Click `all` → both return

---

## PHASE 6 — Add Weather Agent to Nasiko RAP

Navigate to:
```
http://localhost:3000/rap
```

### Connect to nasiko RAP

| Field | Value |
|-------|-------|
| **RAP Base URL** | `http://localhost:3002` |
| **Admin API Key** | `<get from examples/rap-server/.env — ADMIN_API_KEY>` |

> The Admin API Key is set in the RAP server's `.env` file as `ADMIN_API_KEY`. It protects write operations — only someone with this key can add, edit or delete agents.

Click **"Connect to RAP"**

**What to show:** Connected banner showing `nasiko.com`, total agents count.

### Register the Weather Agent

Click **"+ Register Agent"**

| Field | Value to type |
|-------|--------------|
| **Agent Name (slug)** | `weather` |
| **Display Name** | `Weather Agent` |
| **Description** | `Real-time weather forecasts and conditions worldwide` |
| **Version** | `1.0.0` |
| **Capabilities** | `weather.current.get, weather.forecast.get` |
| **Invocation URL** | `http://localhost:5010` |
| **Protocol** | `a2a` |
| **Visibility** | `public` |

Click **"Register agent"**

**Expected result:** `weather@nasiko.com` appears in the table.

Click the row → right panel shows full details including capabilities as pills and `Signature (verified ✓)`.

---

## PHASE 7 — Add Translator Agent to ACME RAP

Click **"Disconnect"** on the connection banner.

### Connect to acme RAP

| Field | Value |
|-------|-------|
| **RAP Base URL** | `http://localhost:3003` |
| **Admin API Key** | `<get from examples/rap-server-acme/.env — ADMIN_API_KEY>` |

Click **"Connect to RAP"**

### Register the Translator Agent

Click **"+ Register Agent"**

| Field | Value to type |
|-------|--------------|
| **Agent Name (slug)** | `translator` |
| **Display Name** | `Translator Agent` |
| **Description** | `Translates text and web content between languages` |
| **Version** | `1.0.0` |
| **Capabilities** | `translation.text.translate, translation.language.detect` |
| **Invocation URL** | `http://localhost:5011` |
| **Protocol** | `a2a` |
| **Visibility** | `public` |

Click **"Register agent"**

**Expected result:** `translator@acme.demo` appears in the table.

---

## PHASE 8 — Resolve the Weather Agent

> **This is the most important part.** Full trust chain: GARR root key → nasiko org key → AgentCard.

Navigate to:
```
http://localhost:3000/resolve
```

Make sure **`:global`** tab is selected.

Type in the input field:
```
weather@google.com
```

Click **"Resolve"**

### What to point out on screen

**Resolution Path panel** — 4 steps:
1. **Client** — `weather@google.com:global`
2. **GARR** — looked up domain `google.com` in its database
3. **RAP** — fetched card from `https://abdomen-rescuer-zigzagged.ngrok-free.dev/agents/weather` (real public HTTPS!)
4. **AgentCard** — `signature verified ✓`

**Metadata below the path:**
- Mode: `global`
- Via: `garr-db`
- Card URL: the ngrok URL
- TTL: `86400s`

**AgentCard panel:**
- Name: `Weather Agent`
- ID: `weather@nasiko.com`
- Protocol: `a2a` (violet badge)
- Visibility: `public` (green badge)
- Capabilities: `weather.current.get`, `weather.forecast.get` as pills
- Invocation URL (clickable)
- Signed by: `nasiko-key-2026`
- Signature verified ✓

**Raw JSON** on the right — full `ResolveResponse` including both signatures.

---

## PHASE 9 — Resolve the Translator Agent

Still on `/resolve`, type:
```
translator@spotify.com
```

Click **"Resolve"**

Show the same 4-step path — notice the RAP URL is now the serveo URL (`https://e4bab68d94cbcf87-27-4-93-12.serveousercontent.com/agents/translator`) — a completely different public provider from nasiko's ngrok URL. Two real organisations, two real internet addresses.

---

## PHASE 10 — Show Error Cases

### Wrong agent name:
Type: `billing@google.com` → Click **Resolve**

**Expected:**
```
404: not_found — AgentCard not found at ".../agents/billing" (404)
```

### Unknown domain:
Type: `weather@unknown-company.xyz` → Click **Resolve**

**Expected:**
```
404: not_found — domain "unknown-company.xyz" not found in GARR registry
```

---

## PHASE 11 — Search

Navigate to:
```
http://localhost:3000/search
```

| Search | Expected |
|--------|----------|
| `nasiko` | 1 result — Nasiko Labs |
| `google` | 1 result — nasiko (domain is google.com) |
| `acme` | 1 result — ACME Corp |
| `spotify` | 1 result — acme (domain is spotify.com) |
| `xyz` | 0 results |

---

## PHASE 12 — Multi-mode Query

Navigate to:
```
http://localhost:3000/query
```

**Registry by Owner ID:**
- Mode: Registry by Owner ID → Input: `nasiko` → Run query
- Show: full EntityOwner JSON

**Resolve by Domain:**
- Mode: Resolve by Domain → Input: `google.com` → Run query
- Show: nasiko found by domain

**Keyword Search:**
- Mode: Keyword Search → Input: `corp` → Run query
- Show: ACME Corp found

---

## PHASE 13 — Signed Root Manifest

Open a new browser tab:
```
http://localhost:3001/global_agent_root.json
```

Point out:
- `entity_owners` array with both nasiko and acme
- `signature_value` — GARR root key signed this entire manifest
- `signed_by: "garr-dev-2026"`

> This is a cryptographically signed document anyone can download and verify. It is the DNS root zone file equivalent for AI agents.

---

## PHASE 14 — A2A Agent Card Exchange

> After GARR tells you WHERE the agent is (the `invocation_url`), you fetch the agent's own A2A card to learn WHAT it can do. This two-step — discovery then capability exchange — is what your senior called "agent card exchange".

Open a new browser tab and go to:
```
http://localhost:5010/.well-known/agent.json
```

**Show on screen — this is the Weather Agent's A2A card:**
```json
{
  "name": "Weather Agent",
  "protocolVersion": "0.3.0",
  "url": "http://0.0.0.0:5010/",
  "capabilities": { "streaming": true },
  "skills": [{
    "id": "weather_forecasting",
    "name": "Weather Forecasting",
    "tags": ["weather", "forecast", "temperature"],
    "examples": ["What's the weather in New York?"]
  }]
}
```

> **Explain:** GARR resolution (`/resolve`) returns `invocation_url`. Any agent that wants to talk to the Weather Agent fetches this card first to know: what skills it has, what inputs it accepts, whether it supports streaming. Only then does it send a message. GARR = discovery. A2A card = capability contract. Invocation = actual communication.

---

## PHASE 15 — Live LLM Invocation

In a terminal, run:

```bash
curl -s -X POST http://localhost:5010/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"kind": "text", "text": "What is the weather in London today?"}],
        "messageId": "demo-001"
      }
    }
  }'
```

**Expected result (~5 seconds):**
```
"text": "The current weather in London is:\n- Temperature: 18°C\n- Conditions: Cloudy..."
```

> Real LLM call via OpenRouter using `nvidia/nemotron-3-super-120b-a12b:free`. The agent used its weather tool and the LLM formatted the response.

---

## Summary — The Full Flow

```
REGISTRATION (done once per org)

  Nasiko Labs ──► POST /api/v1/register ──► GARR
  (keypair + domain + ngrok RAP URL)        stores signed EntityOwner

  Nasiko Labs ──► POST /agents ──────────► nasiko RAP
  (weather agent details)                   stores signed AgentCard

─────────────────────────────────────────────────────────

RESOLUTION (any client, any time)

  Client ─► GET /resolve?locator=weather@google.com:global
                      │
                      ▼
             GARR looks up google.com
             → finds nasiko's ngrok RAP URL
             → fetches AgentCard via real HTTPS
             → verifies GARR root signature ✓
             → verifies nasiko org signature ✓
                      │
                      ▼
  Client ◄─ AgentCard { invocation_url, capabilities }
                      │
                      ▼
  Client ─► GET invocation_url/.well-known/agent.json
             (A2A card exchange — what can this agent do?)
                      │
                      ▼
  Client ─► POST invocation_url/  (A2A task)
  Client ◄─ Real LLM response
```

---

## Quick Restart Reference

| Service | Command |
|---------|---------|
| GARR | `cd "/Users/chamansinghal/Documents/Nasiko /GARR" && npm run dev` |
| nasiko RAP | `cd ".../examples/rap-server" && npm run dev` |
| acme RAP | `cd ".../examples/rap-server-acme" && npm run dev` |
| Weather Agent | `OPENROUTER_API_KEY="<get your OpenRouter API key from openrouter.ai>" OPENROUTER_MODEL="nvidia/nemotron-3-super-120b-a12b:free" PYTHONPATH=src python3 -m src --host 0.0.0.0 --port 5010` |
| Translator Agent | `OPENROUTER_API_KEY="<get your OpenRouter API key from openrouter.ai>" OPENROUTER_MODEL="nvidia/nemotron-3-super-120b-a12b:free" PYTHONPATH=src python3 -m src --host 0.0.0.0 --port 5011` |
| Frontend | `cd "/Users/chamansinghal/Documents/Nasiko /garr-web" && npm run dev` |
| ngrok (nasiko RAP) | `ngrok http 3002` |
| serveo (acme RAP) | `ssh -R 80:localhost:3003 serveo.net` |

> **Note:** ngrok and serveo give new URLs every time you restart them. If you restart mid-demo, you must re-register both orgs in GARR with the new URLs.

---

*GARR — Global Agent Root Registry · Demo script for senior review*
