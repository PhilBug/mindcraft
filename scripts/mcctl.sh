#!/usr/bin/env bash
# mcctl.sh - start/stop/restart the ViaProxy + Mindcraft bot stack.
#
# The "all" target runs the official launcher (launcher/bin/start.js), which
# manages both processes, env and secrets. The "proxy" and "bot" targets run
# the components standalone, reusing launcher libraries through
# scripts/mc-env.mjs, so launcher.config.json stays the single source of truth.
#
# Usage:
#   scripts/mcctl.sh start   [all|proxy|bot] [options]
#   scripts/mcctl.sh stop    [all|proxy|bot]
#   scripts/mcctl.sh restart [all|proxy|bot] [options]
#   scripts/mcctl.sh status
#   scripts/mcctl.sh send    <message>
#   scripts/mcctl.sh logs    [launcher|proxy|bot] [-f]
#
# Options:
#   -f, --foreground   start in the foreground instead of detaching
#                      (for "logs" this means: follow the log, like tail -f)
#   -t, --timeout N    seconds to wait for startup ports (default: 60)
#   -q, --quiet        only print errors
#       --log FILE     override the log file for "start" / "logs launcher"
#   -h, --help         show this help
#
# Notes:
#   - "stop proxy" while the launcher runs also takes Mindcraft down; the
#     launcher treats an unexpected proxy exit as fatal by design.
#   - "stop bot" stops the whole Mindcraft process (UI included). The agent
#     inside a running launcher restarts automatically after crashes; use
#     the web UI Restart button for agent-level restarts.

set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$ROOT/.local/run"
DEFAULT_LAUNCHER_LOG="$ROOT/.local/runtime/logs/mcctl-launcher.log"
PROXY_LOG="$ROOT/.local/runtime/logs/viaproxy.log"
BOT_LOG="$ROOT/.local/runtime/logs/mindcraft.log"
CONFIG_FILE="$ROOT/launcher.config.json"
UI_PORT=8080 # Mindcraft default MindServer/UI port

CMD=""
TARGET="all"
FOREGROUND=0
TIMEOUT=60
QUIET=0
LOG_FILE=""
ARGS=()

usage() {
    sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
}

log() { [ "$QUIET" -eq 0 ] && printf '%s\n' "$*" >&2 || true; }
die() { printf 'mcctl: %s\n' "$*" >&2; exit 1; }

# --- option parsing -------------------------------------------------------
while [ $# -gt 0 ]; do
    case "$1" in
        -f|--foreground) FOREGROUND=1 ;;
        -t|--timeout)
            [ $# -ge 2 ] || die "option $1 needs a value"
            case "$2" in (*[!0-9]*|'') die "--timeout needs a number" ;; esac
            TIMEOUT="$2"; shift ;;
        -q|--quiet) QUIET=1 ;;
        --log)
            [ $# -ge 2 ] || die "option $1 needs a value"
            LOG_FILE="$2"; shift ;;
        -h|--help) usage ;;
        --) shift; while [ $# -gt 0 ]; do ARGS+=("$1"); shift; done; break ;;
        -*) die "unknown option: $1 (see --help)" ;;
        *) ARGS+=("$1") ;;
    esac
    shift
done

CMD="${ARGS[0]:-}"
[ -n "$CMD" ] || usage
TARGET="${ARGS[1]:-all}"

case "$CMD" in
    start|stop|restart)
        case "$TARGET" in all|proxy|bot) ;; *) die "unknown target '$TARGET' (all|proxy|bot)" ;; esac
        [ ${#ARGS[@]} -eq 2 ] || die "${CMD} takes at most one target"
        ;;
    status)
        [ ${#ARGS[@]} -eq 1 ] || die "status takes no arguments"
        ;;
    send)
        [ ${#ARGS[@]} -ge 2 ] || die "send needs a message, e.g. mcctl.sh send 'hello'"
        ;;
    logs)
        case "$TARGET" in all|launcher|proxy|bot) ;; *) die "unknown target '$TARGET' (launcher|proxy|bot)" ;; esac
        [ ${#ARGS[@]} -le 2 ] || die "logs takes at most one target"
        ;;
    *) die "unknown command '$CMD' (see --help)" ;;
esac

mkdir -p "$RUN_DIR"

# --- helpers --------------------------------------------------------------
pidfile_for() { printf '%s/mcctl-%s.pid' "$RUN_DIR" "$1"; }

read_pid() { # read_pid <target>; prints pid, rc=1 when none
    local f pid
    f="$(pidfile_for "$1")"
    [ -f "$f" ] || return 1
    pid="$(head -n 1 "$f" 2>/dev/null)"
    [ -n "$pid" ] || return 1
    printf '%s' "$pid"
}

find_pid() { # find_pid <egrep-pattern> - first matching pid, for pid recovery
    pgrep -f "$1" 2>/dev/null | head -n 1
}

is_running() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

port_open() { # port_open <port> - tries IPv4, IPv6 and the localhost name
    local port="$1" host
    for host in 127.0.0.1 ::1 localhost; do
        if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
            return 0
        fi
    done
    return 1
}

wait_port() { # wait_port <port> <timeout_seconds>
    local waited=0
    while [ "$waited" -lt "$2" ]; do
        port_open "$1" && return 0
        sleep 1
        waited=$((waited + 1))
    done
    return 1
}

stop_pid() { # stop_pid <name> <pid> <signal> - signal, wait up to 10s, KILL
    local name="$1" pid="$2" signal="$3" waited=0
    is_running "$pid" || { log "mcctl: $name already stopped"; return 0; }
    kill "$signal" "$pid" 2>/dev/null || true
    while is_running "$pid" && [ "$waited" -lt 10 ]; do
        sleep 1
        waited=$((waited + 1))
    done
    if is_running "$pid"; then
        log "mcctl: $name still running - sending SIGKILL"
        kill -KILL "$pid" 2>/dev/null || true
    fi
    log "mcctl: $name stopped (pid $pid)"
}

# --- start ----------------------------------------------------------------
start_launcher() {
    local logfile="${LOG_FILE:-$DEFAULT_LAUNCHER_LOG}" pid
    port_open "$UI_PORT" && die "port $UI_PORT already in use (running stack?) - check: $0 status"
    log "mcctl: starting launcher (ViaProxy + Mindcraft); log: $logfile"
    if [ "$FOREGROUND" -eq 1 ]; then
        cd "$ROOT" || exit 1
        exec node launcher/bin/start.js
    fi
    ( cd "$ROOT" && exec setsid node launcher/bin/start.js >>"$logfile" 2>&1 ) &
    pid=$!
    wait_port "$UI_PORT" "$TIMEOUT" || die "launcher did not open port $UI_PORT within ${TIMEOUT}s - see $logfile"
    is_running "$pid" || pid="$(find_pid 'node launcher/bin/start[.]js')"
    echo "$pid" >"$(pidfile_for launcher)"
    log "mcctl: stack is up (pid $pid), UI: http://localhost:$UI_PORT"
}

start_proxy() {
    local logfile pid host port
    eval "$(node "$SCRIPT_DIR/mc-env.mjs" proxy)" || die "could not build the ViaProxy command from launcher.config.json"
    port="$MC_PROXY_PORT"; host="$MC_PROXY_HOST"; logfile="${LOG_FILE:-$MC_PROXY_LOG}"
    is_running "$(read_pid proxy 2>/dev/null || true)" && die "proxy already running (pid $(read_pid proxy))"
    port_open "$port" && die "port $host:$port already in use - is the launcher or another proxy running?"
    log "mcctl: starting standalone ViaProxy ($host:$port); log: $logfile"
    ( cd "$MC_PROXY_CWD" && exec setsid "${MC_PROXY_CMD[@]}" >>"$logfile" 2>&1 ) &
    pid=$!
    wait_port "$port" "$TIMEOUT" || die "ViaProxy did not open port $port within ${TIMEOUT}s - see $logfile"
    is_running "$pid" || pid="$(find_pid 'ViaProxy[.]jar')"
    echo "$pid" >"$(pidfile_for proxy)"
    log "mcctl: ViaProxy is up (pid $pid)"
}

start_bot() {
    local logfile pid proxy_port
    eval "$(node "$SCRIPT_DIR/mc-env.mjs" bot)" || die "could not build the Mindcraft command from launcher.config.json"
    logfile="${LOG_FILE:-$MC_BOT_LOG}"
    is_running "$(read_pid bot 2>/dev/null || true)" && die "bot already running (pid $(read_pid bot))"
    port_open "$UI_PORT" && die "port $UI_PORT already in use (running stack?) - check: $0 status"
    proxy_port="$(jq -r '.proxy.bindPort // 25568' "$CONFIG_FILE" 2>/dev/null || printf '25568')"
    wait_port "$proxy_port" 5 || die "no proxy listening on port $proxy_port - start it first: $0 start proxy"
    log "mcctl: starting standalone Mindcraft (bot: ${MC_BOT_NAME:-?}); log: $logfile"
    if [ "$FOREGROUND" -eq 1 ]; then
        cd "$MC_BOT_CWD" || exit 1
        exec env "${MC_BOT_ENV[@]}" "${MC_BOT_CMD[@]}"
    fi
    ( cd "$MC_BOT_CWD" && exec setsid env "${MC_BOT_ENV[@]}" "${MC_BOT_CMD[@]}" >>"$logfile" 2>&1 ) &
    pid=$!
    wait_port "$UI_PORT" "$TIMEOUT" || die "Mindcraft did not open port $UI_PORT within ${TIMEOUT}s - see $logfile"
    is_running "$pid" || pid="$(find_pid 'node .*src/main[.]js --profiles')"
    echo "$pid" >"$(pidfile_for bot)"
    log "mcctl: bot is up (pid $pid); UI: http://localhost:$UI_PORT"
}

# --- stop -----------------------------------------------------------------
stop_component() { # stop_component <target> <signal>
    local pid
    pid="$(read_pid "$1" 2>/dev/null || true)"
    if is_running "$pid"; then
        stop_pid "$1" "$pid" "$2"
    else
        log "mcctl: $1 not running"
    fi
    rm -f "$(pidfile_for "$1")"
}

stop_all() {
    stop_component launcher -INT  # launcher shuts ViaProxy + Mindcraft down
    stop_component proxy -TERM
    stop_component bot -TERM
}

# --- misc -----------------------------------------------------------------
show_status() {
    local pid state extra
    printf '%-9s %-8s %-7s %s\n' 'TARGET' 'STATE' 'PID' 'EXTRA'
    for TARGET in launcher proxy bot; do
        pid="$(read_pid "$TARGET" 2>/dev/null || true)"
        if is_running "$pid"; then
            state='running'
        else
            state='stopped'; pid='-'
        fi
        extra=''
        case "$TARGET" in
            launcher) port_open "$UI_PORT" && extra='UI :8080 up' || extra='UI :8080 down' ;;
            proxy)    extra="bind port: $(jq -r '.proxy.bindPort // 25568' "$CONFIG_FILE" 2>/dev/null || printf '?')" ;;
            bot)      extra="log: $BOT_LOG" ;;
        esac
        printf '%-9s %-8s %-7s %s\n' "$TARGET" "$state" "$pid" "$extra"
    done
}

send_message() {
    [ -f "$ROOT/node_modules/socket.io-client/package.json" ] || die "socket.io-client not installed (run npm install)"
    local msg
    msg="$(printf '%s ' "${ARGS[@]:1}")"
    node "$SCRIPT_DIR/mc-send.cjs" "${msg% }" "$UI_PORT"
}

show_logs() {
    local file follow=()
    case "$TARGET" in
        launcher) file="${LOG_FILE:-$DEFAULT_LAUNCHER_LOG}" ;;
        proxy)    file="$PROXY_LOG" ;;
        *)        file="$BOT_LOG" ;;
    esac
    [ -f "$file" ] || die "no log file yet: $file"
    [ "$FOREGROUND" -eq 1 ] && follow=(-f)
    exec tail -n 50 "${follow[@]}" -- "$file"
}

# --- dispatch -------------------------------------------------------------
case "$CMD" in
    start)
        case "$TARGET" in
            all)   start_launcher ;;
            proxy) start_proxy ;;
            bot)   start_bot ;;
        esac
        ;;
    stop)
        if [ "$TARGET" = "all" ]; then
            stop_all
        else
            stop_component "$TARGET" -INT
            [ "$TARGET" = "proxy" ] && is_running "$(read_pid launcher 2>/dev/null || true)" && \
                log "mcctl: note - the running launcher treats a proxy exit as fatal and will shut Mindcraft down"
        fi
        ;;
    restart)
        QUIET=1 "$0" stop "$TARGET" || true
        opts=()
        [ "$FOREGROUND" -eq 1 ] && opts+=(-f)
        [ "$QUIET" -eq 1 ] && opts+=(-q)
        opts+=(-t "$TIMEOUT")
        [ -n "$LOG_FILE" ] && opts+=(--log "$LOG_FILE")
        exec "$0" start "$TARGET" "${opts[@]}"
        ;;
    status) show_status ;;
    send)   send_message ;;
    logs)   show_logs ;;
esac
