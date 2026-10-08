#!/usr/bin/env bash
# ScanIn ops console — preflight auth checks + read-only investigations
# against the production Firebase/GCP project (dataloggerdev).
#
#   ./go.sh                 interactive menu
#   ./go.sh preflight       just run the checks / re-auth
#   ./go.sh run <script> …  run an ops script with the ops environment, e.g.
#                           ./go.sh run src/queries/sensor.ts R11
#
# gcloud state is ISOLATED in ~/.config/gcloud-scanin (CLOUDSDK_CONFIG), so
# logging in here never changes the account used for other clients' work.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OPS="$ROOT/ops"

REQUIRED_ACCOUNT="scanin.link@gmail.com"
REQUIRED_PROJECT="dataloggerdev"
REGION="us-central1"

export CLOUDSDK_CONFIG="$HOME/.config/gcloud-scanin"
export GOOGLE_APPLICATION_CREDENTIALS="$CLOUDSDK_CONFIG/application_default_credentials.json"
export GOOGLE_CLOUD_QUOTA_PROJECT="$REQUIRED_PROJECT"
unset GCLOUD_PROJECT FIRESTORE_EMULATOR_HOST 2>/dev/null || true

BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
CYAN=$'\033[1;36m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'
ok()   { echo "  ${GREEN}✔${RESET} $*"; }
warn() { echo "  ${YELLOW}!${RESET} $*"; }
fail() { echo "  ${RED}✘${RESET} $*"; }

# ── Arrow-key menu: prints the 0-based index of the chosen option to stdout.
select_menu() {
    local prompt="$1"; shift
    local options=("$@")
    local n=${#options[@]}

    if [ ! -t 0 ]; then
        echo "$prompt" >&2
        for i in "${!options[@]}"; do echo "  $((i+1))) ${options[$i]}" >&2; done
        read -rp "#> " n_sel
        echo "$((n_sel-1))"
        return
    fi

    local selected=0
    # Truncate to terminal width: a wrapped line breaks the cursor-up redraw.
    local cols; cols=$(tput cols 2>/dev/null || echo 80)
    local max=$(( cols > 12 ? cols - 6 : 6 ))
    local i
    for i in "${!options[@]}"; do
        [ ${#options[$i]} -gt "$max" ] && options[$i]="${options[$i]:0:$((max-1))}…"
    done
    exec 3>/dev/tty
    tput civis >&3 2>/dev/null || true
    draw() {
        local i
        for i in "${!options[@]}"; do
            if [ "$i" -eq "$selected" ]; then
                printf "\r\033[2K  ${CYAN}❯ %s${RESET}\n" "${options[$i]}" >&3
            else
                printf "\r\033[2K    %s\n" "${options[$i]}" >&3
            fi
        done
    }
    printf "\n%s\n" "$prompt" >&3
    draw
    while true; do
        IFS= read -rsn1 key </dev/tty
        if [[ "$key" == $'\x1b' ]]; then
            read -rsn2 key </dev/tty
            case "$key" in
                '[A'|'OA') selected=$(( (selected - 1 + n) % n )) ;;
                '[B'|'OB') selected=$(( (selected + 1) % n )) ;;
            esac
        elif [[ "$key" == "k" ]]; then selected=$(( (selected - 1 + n) % n ))
        elif [[ "$key" == "j" ]]; then selected=$(( (selected + 1) % n ))
        elif [[ -z "$key" ]]; then break
        else continue
        fi
        printf "\033[%dA" "$n" >&3
        draw
    done
    tput cnorm >&3 2>/dev/null || true
    exec 3>&-
    echo "$selected"
}

has_tty() { { : </dev/tty; } 2>/dev/null; }
ask() { local a=""; has_tty && read -rp "$1 " a </dev/tty; echo "$a"; }
# Defaults to yes interactively; always "no" without a terminal (never auto-opens a browser).
yes_default() { has_tty || return 1; local a; a=$(ask "$1 (Y/n)"); [[ ! "$a" =~ ^[Nn] ]]; }

# ── Preflight ────────────────────────────────────────────────────────────────

use_node20() {
    export NVM_DIR="$HOME/.nvm"
    set +u   # nvm.sh is not nounset-safe
    # shellcheck disable=SC1091
    if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null 2>&1 || nvm install 20 >/dev/null; fi
    set -u
    local major; major=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
    if [ "${major:-0}" -ge 20 ]; then ok "node $(node -v)"; else fail "node 20+ required (have $(node -v 2>/dev/null || echo none))"; return 1; fi
}

check_deps() {
    if [ ! -d "$OPS/node_modules" ]; then
        warn "ops dependencies missing — installing"
        (cd "$OPS" && npm ci --silent)
    fi
    ok "ops dependencies installed"
}

check_gcloud() {
    command -v gcloud >/dev/null || { fail "gcloud not installed (brew install --cask google-cloud-sdk)"; return 1; }
    local acct; acct=$(gcloud config get-value account 2>/dev/null || true)
    if [ "$acct" != "$REQUIRED_ACCOUNT" ]; then
        # capture first: `cmd | grep -q` + pipefail fails via SIGPIPE when grep exits early
        local accts; accts=$(gcloud auth list --format='value(account)' 2>/dev/null || true)
        if grep -qx "$REQUIRED_ACCOUNT" <<<"$accts"; then
            gcloud config set account "$REQUIRED_ACCOUNT" >/dev/null 2>&1
        else
            warn "gcloud CLI not logged in as $REQUIRED_ACCOUNT (current: ${acct:-none})"
            yes_default "  🔑 Open browser to log in?" || return 1
            gcloud auth login "$REQUIRED_ACCOUNT" --brief || return 1
        fi
    fi
    # token still valid? (refresh tokens expire / get revoked)
    if ! gcloud auth print-access-token >/dev/null 2>&1; then
        warn "gcloud CLI credentials expired"
        yes_default "  🔑 Re-authenticate in browser?" || return 1
        gcloud auth login "$REQUIRED_ACCOUNT" --brief || return 1
    fi
    [ "$(gcloud config get-value project 2>/dev/null)" = "$REQUIRED_PROJECT" ] || gcloud config set project "$REQUIRED_PROJECT" >/dev/null 2>&1
    ok "gcloud CLI: $REQUIRED_ACCOUNT / $REQUIRED_PROJECT ${DIM}(config: $CLOUDSDK_CONFIG)${RESET}"
}

adc_email() {
    local tok; tok=$(gcloud auth application-default print-access-token 2>/dev/null) || return 1
    curl -s "https://oauth2.googleapis.com/tokeninfo?access_token=$tok" | jq -r '.email // empty'
}

check_adc() {
    local email=""
    [ -f "$GOOGLE_APPLICATION_CREDENTIALS" ] && email=$(adc_email || true)
    if [ "$email" != "$REQUIRED_ACCOUNT" ]; then
        warn "Application Default Credentials (used by ops scripts) ${email:+are $email}${email:-missing/expired}"
        yes_default "  🔑 Open browser to log in ADC as $REQUIRED_ACCOUNT?" || return 1
        gcloud auth application-default login --quiet || return 1
        email=$(adc_email || true)
        [ "$email" = "$REQUIRED_ACCOUNT" ] || { fail "ADC is '$email' — pick $REQUIRED_ACCOUNT in the browser"; return 1; }
    fi
    gcloud auth application-default set-quota-project "$REQUIRED_PROJECT" >/dev/null 2>&1 || true
    ok "ADC: $email (quota project $REQUIRED_PROJECT)"
}

check_firestore() {
    if (cd "$OPS" && npx tsx src/queries/whoami.ts >/tmp/scanin-ops-whoami.log 2>&1); then
        ok "Firestore read: $(sed -n 's/^✅ //p' /tmp/scanin-ops-whoami.log | head -1)"
    else
        fail "Firestore read failed:"; sed 's/^/      /' /tmp/scanin-ops-whoami.log; return 1
    fi
}

# Optional: firebase CLI has its own (global) login. Only needed for
# `firebase` commands (deploys from other repos, functions:log).
check_firebase() {
    command -v firebase >/dev/null || { warn "firebase CLI not installed (optional)"; return 0; }
    # Always pin the account (firebase-tools ignores CLOUDSDK_CONFIG); never log out other clients.
    local fbprojects; fbprojects=$(firebase --account "$REQUIRED_ACCOUNT" projects:list 2>/dev/null || true)
    if grep -q "$REQUIRED_PROJECT" <<<"$fbprojects"; then
        ok "firebase CLI: $REQUIRED_ACCOUNT → $REQUIRED_PROJECT"
    else
        warn "firebase CLI: $REQUIRED_ACCOUNT can't list $REQUIRED_PROJECT (not added, or token expired)"
        if yes_default "  🔑 Add / refresh $REQUIRED_ACCOUNT in the firebase CLI? (other logins are kept)"; then
            firebase login:add "$REQUIRED_ACCOUNT" || firebase login --reauth
        fi
    fi
}

PREFLIGHT_DONE=0
preflight() {
    echo ""; echo "${BOLD}Preflight${RESET}"
    use_node20 && check_deps && check_gcloud && check_adc && check_firestore || {
        echo ""; fail "${BOLD}preflight failed${RESET}"; return 1; }
    check_firebase
    PREFLIGHT_DONE=1
    echo ""
}

ensure_preflight() { [ "$PREFLIGHT_DONE" = 1 ] || preflight; }

ops_run() { ensure_preflight; (cd "$OPS" && npx tsx "$@"); }

# ── Logs ─────────────────────────────────────────────────────────────────────

FUNCTIONS=(handleAlerts checkThresholds evaluateMultiSensorRules distributeReportsScheduled generateSensorReports scheduleCalcSensors processCalcSensor cleanUnconfirmedSensors handleMuteOrUnsubscribe runVibrationReportNow recalcEma deleteUser deleteAtsRun)
RUN_SERVICES=(reports-orchestrator reports-worker daily-prism-orchestrator daily-prism-worker scanin-svc-watchdog sensor-data-replay)

read_logs() {
    local filter="$1"
    local fresh; fresh=$(ask "Freshness (e.g. 1h, 1d, 7d) [1d]:"); fresh=${fresh:-1d}
    local grepf; grepf=$(ask "Text filter (optional):")
    local errs; errs=$(ask "Errors only? (y/N)")
    [ -n "$grepf" ] && filter="$filter AND (textPayload:\"$grepf\" OR jsonPayload.message:\"$grepf\")"
    [[ "$errs" =~ ^[Yy] ]] && filter="$filter AND severity>=ERROR"
    echo "${DIM}gcloud logging read '$filter' --freshness=$fresh${RESET}"
    gcloud logging read "$filter" --project="$REQUIRED_PROJECT" --freshness="$fresh" --limit=200 \
        --format='value(timestamp.date("%Y-%m-%d %H:%M:%S", tz="Asia/Jerusalem"),severity,textPayload,jsonPayload.message)' \
        | tail -r | less -RFX
}

function_logs() {
    local i; i=$(select_menu "Function:" "${FUNCTIONS[@]}")
    local fn="${FUNCTIONS[$i]}"
    local svc; svc=$(echo "$fn" | tr '[:upper:]' '[:lower:]')
    # v1 functions log as cloud_function, v2 as cloud_run_revision (lowercased name)
    read_logs "((resource.type=\"cloud_function\" AND resource.labels.function_name=\"$fn\") OR (resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$svc\"))"
}

run_logs() {
    local i; i=$(select_menu "Cloud Run service:" "${RUN_SERVICES[@]}")
    read_logs "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${RUN_SERVICES[$i]}\""
}

# ── Scripts ──────────────────────────────────────────────────────────────────

pick_script() {
    local files=() f
    while IFS= read -r f; do files+=("$f"); done < <(cd "$OPS" && ls src/queries/*.ts src/oneoff/*.ts 2>/dev/null | grep -v '/_template')
    [ ${#files[@]} -gt 0 ] || { echo "no scripts"; return; }
    local i; i=$(select_menu "Script:" "${files[@]}")
    sed -n '2,12p' "$OPS/${files[$i]}" | sed -n '/^ \*/p' | sed 's/^ \* \{0,1\}/  /'
    local a; a=$(ask "Arguments:")
    # shellcheck disable=SC2086
    ops_run "${files[$i]}" $a
}

open_url() { echo "  $1"; open "$1" 2>/dev/null || true; }

consoles() {
    local i; i=$(select_menu "Open in browser:" \
        "Firestore data" "Cloud Functions" "Cloud Run services" "Cloud Scheduler jobs" "Logs Explorer" "Compute Engine VMs (bridge)")
    case "$i" in
        0) open_url "https://console.firebase.google.com/project/$REQUIRED_PROJECT/firestore/databases/-default-/data" ;;
        1) open_url "https://console.cloud.google.com/functions/list?project=$REQUIRED_PROJECT" ;;
        2) open_url "https://console.cloud.google.com/run?project=$REQUIRED_PROJECT" ;;
        3) open_url "https://console.cloud.google.com/cloudscheduler?project=$REQUIRED_PROJECT" ;;
        4) open_url "https://console.cloud.google.com/logs/query?project=$REQUIRED_PROJECT" ;;
        5) open_url "https://console.cloud.google.com/compute/instances?project=$REQUIRED_PROJECT" ;;
    esac
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "${1:-}" in
    preflight) preflight; exit $? ;;
    run) shift; ops_run "$@"; exit $? ;;
    "") ;;
    *) echo "usage: ./go.sh [preflight | run <script.ts> [args…]]"; exit 1 ;;
esac

echo ""
echo "${BOLD}ScanIn ops console${RESET}  ${DIM}($REQUIRED_PROJECT — PRODUCTION)${RESET}"
preflight || exit 1

while true; do
    choice=$(select_menu "${BOLD}What do you want to do?${RESET}" \
        "System health (heartbeats, checks, incidents)" \
        "Recent alerts" \
        "Inspect a sensor" \
        "Project sensors / find silent sensors" \
        "Daily system metrics" \
        "Firebase Function logs" \
        "Cloud Run service logs" \
        "Run an ops script…" \
        "Open GCP / Firebase console" \
        "Preflight / re-auth" \
        "Quit")
    echo ""
    case "$choice" in
        0) ops_run src/queries/health.ts || true ;;
        1) s=$(ask "Since (1d, 7d, YYYY-MM-DD) [1d]:"); p=$(ask "Project filter (optional):")
           ops_run src/queries/alerts.ts --since="${s:-1d}" ${p:+--project="$p"} || true ;;
        2) k=$(ask "Sensor (doc id / scanin-id / MAC / name):"); ops_run src/queries/sensor.ts "$k" || true ;;
        3) p=$(ask "Project (id or name fragment, empty = list all):")
           if [ -z "$p" ]; then ops_run src/queries/project.ts --list || true
           else t=$(ask "Sensor type filter (optional, e.g. prism):"); ops_run src/queries/project.ts "$p" ${t:+--type="$t"} || true; fi ;;
        4) c=$(ask "Component (empty = list):"); ops_run src/queries/metrics.ts ${c:+"$c"} || true ;;
        5) ensure_preflight && function_logs || true ;;
        6) ensure_preflight && run_logs || true ;;
        7) pick_script || true ;;
        8) consoles ;;
        9) PREFLIGHT_DONE=0; preflight || true ;;
        *) exit 0 ;;
    esac
done
