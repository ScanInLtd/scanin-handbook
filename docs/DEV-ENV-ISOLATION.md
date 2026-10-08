# One Mac, many repos: separate Google Cloud / Firebase identity and ports per repo

**Audience:** everyone who works on more than one client/repo on the same machine
(e.g. Spotlock / Commodex and Scanin-Link), including AI agents running in parallel windows.

**Goal:** every repo always uses *its own* Google account, GCP project, ADC credentials,
Firebase account and ports, no matter what happens in another terminal, IDE or agent window.

---

## 1. Why things clash today

By default these are **global for the whole Mac user**:

| What | Where it lives | What goes wrong |
|---|---|---|
| gcloud active account + project | `~/.config/gcloud/` (active config) | `gcloud auth login` in repo B switches repo A too |
| ADC (Application Default Credentials) | `~/.config/gcloud/application_default_credentials.json` | Cloud SQL proxy, Node/Python Google libs in repo A suddenly use repo B's account → "permission denied", wrong quota project |
| Firebase CLI default login | `~/.config/configstore/firebase-tools.json` | `firebase deploy` deploys as the wrong account → "Failed to get Firebase project…" |
| Ports (`5432`, `3000`, `8080`…) | the OS | two repos' dev servers / DB proxies collide; one silently talks to the other's DB |

Two Devin windows = two shells, but **the same global files**. Isolation has to be explicit.

---

## 2. The model in one sentence

> **Each repo (or client) gets its own gcloud config folder via `CLOUDSDK_CONFIG`, its own
> expected account, explicit `--account` for Firebase, and its own port slot.**

`CLOUDSDK_CONFIG` moves *all* gcloud state (accounts, configurations, tokens **and the ADC
file**) into a folder you choose. But **not every client library looks for ADC there** —
verified: `cloud-sql-proxy` ignores it and silently falls back to the global
`~/.config/gcloud` ADC (= the wrong account, and it *seems* to work). So always pin the ADC file
too:

```bash
export CLOUDSDK_CONFIG=~/.config/gcloud-spotlock
export GOOGLE_APPLICATION_CREDENTIALS="$CLOUDSDK_CONFIG/application_default_credentials.json"
```

`GOOGLE_APPLICATION_CREDENTIALS` is honored by every Google library and tool. If the file is
missing they fail loudly ("no such file") instead of leaking another account — that's the point.

| Consumer | Uses |
|---|---|
| `gcloud`, `gsutil`, `bq` | `CLOUDSDK_CONFIG` |
| `cloud-sql-proxy`, Node `google-auth-library` / `firebase-admin` / `@googleapis/*`, Python `google-auth` | `GOOGLE_APPLICATION_CREDENTIALS` (pinned to the folder's ADC file) |
| `firebase-tools` CLI | **neither** (own login store) → always pass `--account` (§5) |

⚠️ **Never set either variable globally** in `~/.zshrc` — only per repo (script / `.envrc`).

### Naming convention

| Thing | Convention | Example |
|---|---|---|
| gcloud folder | `~/.config/gcloud-<client>` | `~/.config/gcloud-spotlock`, `~/.config/gcloud-scanin` |
| Expected account | `<you>@<client domain>` | `hillel@spotlock.co`, `you@scanin.link` |

One folder **per client account**, not necessarily per repo: `commodex-office` and
`spotlock-exposure` both use `gcloud-spotlock` (same account, same Cloud SQL instance).

---

## 3. One-time setup (per client)

```bash
# 1. Create the isolated folder and log in INTO it (browser opens twice: user + ADC)
export CLOUDSDK_CONFIG=~/.config/gcloud-spotlock
gcloud auth login hillel@spotlock.co --update-adc    # user login + ADC in one browser round
gcloud config set project spotlock-exposure          # default project for this client
gcloud auth application-default set-quota-project spotlock-exposure

# 2. Firebase CLI: add the account (other logins are kept)
npx firebase-tools login:add hillel@spotlock.co

# 3. Check
gcloud config list                                    # account + project
ls $CLOUDSDK_CONFIG/application_default_credentials.json
```

Repeat with `~/.config/gcloud-scanin` and the Scanin account for Scanin-Link repos.
Your old global `~/.config/gcloud` stays untouched (fine for ad-hoc work).

---

## 4. Interactive shells: `direnv` (recommended)

So that *every* command you (or an agent) type inside the repo uses the right identity:

```bash
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc   # once per machine
```

In each repo root, commit an `.envrc` (no secrets in it):

```bash
# .envrc — repo identity (committed)
source_env_if_exists .envrc.local                    # personal overrides (COMMODEX_* only)
export CLOUDSDK_CONFIG="${COMMODEX_CLOUDSDK_CONFIG:-$HOME/.config/gcloud-spotlock}"
export GOOGLE_APPLICATION_CREDENTIALS="$CLOUDSDK_CONFIG/application_default_credentials.json"
export CLOUDSDK_CORE_PROJECT="spotlock-exposure"     # gcloud default project in this repo
export WEB_PORT=3090 API_PORT=8090 DB_PORT=5490      # slot 90, see §8
```

Then `direnv allow` once. `cd` into the repo → variables load; `cd` out → they unload.

> Each person's account differs → put it in `.envrc.local` (git-ignored), e.g.
> `export COMMODEX_GCP_ACCOUNT=dana@spotlock.co`.
>
> ⚠️ **Override variables are prefixed with the repo name** (`COMMODEX_*`, `SCANIN_*`…). Never
> read generic names like `CLOUDSDK_CONFIG` / `REPO_GCP_ACCOUNT` *from the environment* in a
> script: a value exported in the terminal for another repo would leak in — and the preflight
> would then offer to log this repo's account into the *other* repo's folder.

---

## 5. Scripts (`go.sh` and friends): make them self-contained

Scripts must **not rely on direnv** being installed: they set the identity themselves, then
**check** it in preflight and offer the fix on the spot.

### 5.1 Header of every repo script

```bash
#!/bin/bash
cd "$(dirname "$0")"
# Repo identity — everything below (gcloud, proxy, API, tests, deploy) inherits it.
# Set unconditionally; overrides only via repo-prefixed names (never a generic CLOUDSDK_CONFIG
# that another repo may have exported in this terminal).
export CLOUDSDK_CONFIG="${COMMODEX_CLOUDSDK_CONFIG:-$HOME/.config/gcloud-spotlock}"
export GOOGLE_APPLICATION_CREDENTIALS="$CLOUDSDK_CONFIG/application_default_credentials.json"
REPO_GCP_ACCOUNT="${COMMODEX_GCP_ACCOUNT:-hillel@spotlock.co}"
GCP_PROJECT="spotlock-exposure"        # project of shared infra (Cloud SQL)
DEPLOY_PROJECT="commodex-office"       # project this repo deploys to
PORT_SLOT="${COMMODEX_PORT_SLOT:-90}"  # → web 3090, api 8090, db 5490 (§8)
WEB_PORT=$((3000 + PORT_SLOT)); API_PORT=$((8000 + PORT_SLOT)); DB_PORT=$((5400 + PORT_SLOT))
```

### 5.2 Preflight: check the *real* conditions

```bash
step "Google identity ($CLOUDSDK_CONFIG)"
acct=$(gcloud config get-value account 2>/dev/null)
if [ "$acct" != "$REPO_GCP_ACCOUNT" ]; then
  warn "gcloud here is '${acct:-none}', expected $REPO_GCP_ACCOUNT"
  ask "Log in as $REPO_GCP_ACCOUNT into this repo's config?" && gcloud auth login "$REPO_GCP_ACCOUNT"
fi
gcloud auth application-default print-access-token >/dev/null 2>&1 \
  && ok "ADC valid" \
  || { ask "Refresh ADC now?" && gcloud auth application-default login; }

step "Firebase CLI"
npx firebase-tools login:list | grep -qF "$REPO_GCP_ACCOUNT" \
  || { ask "Add $REPO_GCP_ACCOUNT to the Firebase CLI?" && npx firebase-tools login:add "$REPO_GCP_ACCOUNT"; }
```

### 5.3 Rules for commands inside scripts

| Tool | Always do |
|---|---|
| `gcloud …` | pass `--project <id>` explicitly (don't trust the default) |
| `firebase …` | pass `--project <id> --account "$REPO_GCP_ACCOUNT"` |
| `cloud-sql-proxy` | `--port $DB_PORT --quota-project <id>` |
| Node / Python with Google libs | nothing extra — they inherit `CLOUDSDK_CONFIG` from the script |
| `.env` files | `DB_PORT`, `PORT`, dev-server proxy target **must match the slot** |

Working reference: `commodex-office/go.sh` (`preflight`, `preflight_deploy`, `deploy_web`).

---

## 6. Tests and one-off commands

- **Unit tests that don't touch GCP** (`npm test`, `vitest`, `pytest`): nothing special.
- **Anything that touches GCP / DB** (migrations, seed, parse-against-DB, integration tests):
  run it **through the repo script** (`./go.sh test`, `./go.sh migrate`…) or in a direnv-loaded
  shell. Never in a random terminal.
- **Ad-hoc gcloud in a terminal without direnv:**
  `CLOUDSDK_CONFIG=~/.config/gcloud-spotlock gcloud …` (or `export` it for the session).
- **Quick sanity check** (put it in your prompt or run when unsure):
  `echo $CLOUDSDK_CONFIG && gcloud config get-value account`.

### AI agents (Devin, etc.)

Add to each repo's `AGENTS.md`:

```md
- Google identity: run gcloud/DB/deploy commands via ./go.sh, or prefix with
  `CLOUDSDK_CONFIG=$HOME/.config/gcloud-<client>`. Never run `gcloud auth login`,
  `gcloud config set account` or `firebase login` without that variable — it would switch
  the global account used by other repos/windows. Firebase CLI: always `--account`.
```

---

## 7. CI / Cloud Run

Nothing changes in production: Cloud Run and CI use **service accounts**, never personal
logins. This document is about developer machines only.

---

## 8. Ports: one slot per repo

Use a **two-digit slot `NN` per repo** and derive every port from it:

| Service | Port | Example (slot 90) |
|---|---|---|
| Web dev server (Vite/Next) | `30NN` | 3090 |
| API | `80NN` | 8090 |
| Cloud SQL proxy / local Postgres | `54NN` | 5490 |
| Extra (workers, emulators, Storybook) | `90NN`, `91NN` | 9090, 9190 |

### Slot registry (proposal — fill in and keep this table up to date)

| Slot | Client | Repo | Notes |
|---|---|---|---|
| 10 | Spotlock | spotlock-exposure (webapp + api) | |
| 11 | Spotlock | spotlock-exposure fetchers / workers | |
| 20 | Scanin-Link | scanin-web-platform (`ng serve` → 3020) | set in `angular.json` |
| 20 | Scanin-Link | scanin-svc-reports local web UI (`PORT=8021`) | `scanin-svc-reports/.envrc` |
| 20 | Scanin-Link | scanin-svc-watchdog local (`PORT=8022`) | `scanin-svc-watchdog/.envrc` |
| 21–29 | Scanin-Link | free | functions emulators still on firebase defaults (Firestore 8080) — move to 90NN when touched |
| 90 | Spotlock / Commodex | commodex-office | ✅ 3090 / 8090 / 5490 · `gcloud-spotlock` — reference implementation |
| 50–89 | free | | allocate in blocks of 10 per new client |

Rules:
- **Never use the framework defaults** (3000, 5173, 8080, 5432) in a repo that anyone runs next
  to another repo — they are where collisions happen.
- Ports live in **one place** (the script's `PORT_SLOT` and `.env`); the dev-server proxy
  (e.g. Vite `server.proxy`) reads the same value.
- Preflight checks the ports and offers to stop whatever holds them (`lsof -ti:<port>`).

---

## 9. Migrating an existing repo — checklist

- [ ] Pick the client folder (`~/.config/gcloud-<client>`) and do §3 once.
- [ ] Add `.envrc` (+ `.envrc.local` in `.gitignore`) — §4.
- [ ] Script header exports `CLOUDSDK_CONFIG` **and** `GOOGLE_APPLICATION_CREDENTIALS`, account, projects, port slot — §5.1.
- [ ] Prove isolation: with the new folder still empty, preflight must **fail** on the DB proxy
      ("no such file") — if it connects, something still reads the global ADC.
- [ ] Preflight checks account, ADC, Firebase account, ports — §5.2.
- [ ] All `gcloud` calls have `--project`; all `firebase` calls have `--project --account` — §5.3.
- [ ] Cloud SQL proxy on the slot's DB port; `.env` `DB_PORT` updated; dev proxy target updated.
- [ ] Register the slot in §8.
- [ ] Add the agent rule to `AGENTS.md` — §6.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Failed to get Firebase project X` | Firebase CLI used another login → `--account`, `login:add` |
| `Reauthentication required` | Workspace re-auth policy → just log in again (inside the right `CLOUDSDK_CONFIG`) |
| Cloud SQL proxy: `403` / `NOT_AUTHORIZED` | ADC of the wrong account → check `$GOOGLE_APPLICATION_CREDENTIALS`, refresh ADC |
| Proxy works although the repo folder is empty | `GOOGLE_APPLICATION_CREDENTIALS` not set → it silently uses the global ADC |
| `quota project` warnings | `gcloud auth application-default set-quota-project <id>` (inside the folder) |
| API talks to the wrong DB | two proxies / Postgres on the same port → use the slot's `54NN` |
| `Python 3.9 will be deprecated` / `importlib.metadata` errors | old Python bundled with gcloud → `gcloud components reinstall` (or `CLOUDSDK_PYTHON=$(which python3.12)`) |

---

---

## 11. ScanIn setup (done 2026-10-08, lessons from commodex applied)

| Piece | Where |
|---|---|
| gcloud + ADC | `~/.config/gcloud-scanin` (account `scanin.link@gmail.com`, project `dataloggerdev`) |
| Client `.envrc` — identity for **all** repos under the folder (direnv walks up): `CLOUDSDK_CONFIG` **+ `GOOGLE_APPLICATION_CREDENTIALS`** pinned, overrides only via `SCANIN_*` in `.envrc.local` | `~/dev/clients/scanin/.envrc` — template `scanin-handbook/ops/env/scanin.envrc` |
| Firebase CLI pinning for interactive use | shim `~/dev/clients/scanin/.bin/firebase` (adds `--account $SCANIN_GCP_ACCOUNT`; login commands pass through), on PATH via the `.envrc` — template `ops/env/firebase-shim.sh` |
| Per-repo ports (slot 20) | `scanin-svc-reports/.envrc` (`PORT=8021`), `scanin-svc-watchdog/.envrc` (`PORT=8022`) — both `source_up`; web-platform `angular.json` `port: 3020` |
| Scripts | every deploy script sets `CLOUDSDK_CONFIG="${SCANIN_CLOUDSDK_CONFIG:-…gcloud-scanin}"` + `GOOGLE_APPLICATION_CREDENTIALS` **unconditionally**; functions `DEPLOY.sh`, web-platform `deploy.sh`, handbook `go.sh` pass `--account` and use `login:add` (never `firebase logout`) |
| direnv | `brew install direnv` + hook in `~/.zshrc` |

**Isolation proven (2026-10-08):**
1. A Spotlock `CLOUDSDK_CONFIG` exported in the terminal does **not** leak into a ScanIn script (header still resolves `gcloud-scanin` → `scanin.link@gmail.com`).
2. Inside a ScanIn repo: `gcloud-scanin`, ADC file pinned, slot port loaded. Outside: unset → `hillel@spotlock.co`.
3. Pinned ADC missing → `firebase-admin` **fails loudly** ("file … does not exist"), no fallback to another account.

**New Mac / re-create:**
```bash
brew install direnv && echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
cp ~/dev/clients/scanin/scanin-handbook/ops/env/scanin.envrc ~/dev/clients/scanin/.envrc
mkdir -p ~/dev/clients/scanin/.bin && cp ~/dev/clients/scanin/scanin-handbook/ops/env/firebase-shim.sh ~/dev/clients/scanin/.bin/firebase && chmod +x ~/dev/clients/scanin/.bin/firebase
cd ~/dev/clients/scanin && direnv allow . && (cd scanin-svc-reports && direnv allow .) && (cd scanin-svc-watchdog && direnv allow .)
CLOUDSDK_CONFIG=~/.config/gcloud-scanin gcloud auth login scanin.link@gmail.com --update-adc
cd scanin-handbook && ./go.sh preflight      # checks gcloud, ADC, Firestore, adds the firebase account
```
**Check:** inside any scanin repo `echo $CLOUDSDK_CONFIG && gcloud config get-value account` → `gcloud-scanin` / `scanin.link@gmail.com`.
Note: `npx firebase-tools …` bypasses the shim — pass `--account scanin.link@gmail.com` yourself.
