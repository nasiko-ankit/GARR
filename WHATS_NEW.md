# What's New — Nanda Index Demo

A short, plain-language summary of the changes shipped in this update. For step-by-step setup, see **DEMO_SETUP.md**.

---

## In one line

The demo now matches the product narrative end-to-end: an organisation can be onboarded, an agent can be added to it, and two agents in different organisations can exchange their signed AgentCards — all from the web UI, no command line needed once the services are running.

---

## What's different in the demo experience

- **New starting point.** Open `/demo` in the browser. You get a single dashboard with three step cards: **Register a Registry**, **Register an Agent**, **A2A Card Exchange**. Everything else hangs off this page.
- **A clear "demo mode" banner** is now visible on every demo page so the audience always knows what's running locally vs. what would be live.
- **A backend health check** runs the moment the demo page loads — if Postgres or the seed is missing, the page tells you exactly which command to run instead of failing silently.
- **The reference scenario is now the product example.** The seeded organisations are **`google.demo`** (with `search-agent`) and **`meta.demo`** (with `products-agent`), matching the `search@google ↔ products@meta` story.

## What's different on each page

- **A2A Card Exchange page** — completely rebuilt as a side-by-side view of the two agents. Click one button and both sides resolve in parallel; each column shows the index lookup, the registry fetch, the signature check, and the final invocation URL. The previous mock-only invocation step has been removed (it was always fictional).
- **Register Agent page** — now wired to the real system. The registry dropdown comes from the live Nanda Index. When you submit, the chosen organisation's registry actually signs the AgentCard with its real Ed25519 key, and the new agent is immediately discoverable. A one-click deep-link takes you to A2A Card Exchange with the new agent pre-filled, proving the end-to-end loop.
- **Register Registry page** — same two-step flow as before (generate keypair → sign challenge → verify), with updated copy and friendlier error messages for the new failure modes the backend can now report.

## What's different under the hood (kept brief)

- Each organisation's Registry Access Point can now **accept new agents at runtime** instead of being a fixed list — that's what makes the Register Agent step actually work end-to-end.
- The Registry Access Points now allow direct browser access so the UI can interact with them without going through a proxy.
- One real API endpoint on the Nanda Index (`/api/v1/resolve`) is now used everywhere it should be — the UI used to fake it with a search call, which couldn't surface signature failures.

## What was removed

- The old fictional "mock registries" handshake step on the cross-registry page — it was a placeholder before the real resolver landed; now it's gone.
- Three demo organisations (acme, globex, initech) replaced by two (google, meta) so the seed matches the product story.

## What's the same

- The cryptography: every signature in the demo is genuine, every key is real, every verification runs end-to-end.
- All the existing read endpoints (`/api/v1/owners/:id`, `/api/v1/search`, `/global_agent_root.json`) still work and can be probed with curl for verification.
- The two-step registration flow (challenge nonce + signed verify) is unchanged.

---

## Files added in this update

- `DEMO_SETUP.md` — step-by-step setup guide
- `WHATS_NEW.md` — this file

## How to verify the changes locally

Follow **DEMO_SETUP.md** sections 1–7. The whole walkthrough takes around 5 minutes from a clean checkout.
