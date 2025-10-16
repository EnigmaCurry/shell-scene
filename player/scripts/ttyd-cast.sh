## ttyd-cast.sh
#!/bin/bash
set -euo pipefail

# -------------------- config (env-overridable) --------------------
export SESSION=${SESSION:-cast}
export TMUX_COLS=${TMUX_COLS:-80}
export TMUX_ROWS=${TMUX_ROWS:-24}
export ASCII_OUT=${ASCII_OUT:-"$HOME/casts/${SESSION}-$(date +%Y%m%d-%H%M%S).cast"}
export TMUX_KILL_ON_DETACH=${TMUX_KILL_ON_DETACH:-0}
export WORKING_DIRECTORY=${WORKING_DIRECTORY:-$HOME}

TT_PORT="${TT_PORT:-7681}"
FONT_SIZE="${FONT_SIZE:-24}"

# -------------------- helpers --------------------
die()   { echo "ERROR: $*" >&2; exit 1; }
warn()  { echo "WARN: $*" >&2; }
have()  { command -v "$1" >/dev/null 2>&1; }

# Integer check
is_int() { [[ "$1" =~ ^[0-9]+$ ]]; }

# Ensure a directory exists and is writable by the current user
ensure_writable_dir() {
  local d="$1"
  mkdir -p "$d" 2>/dev/null || true
  [[ -d "$d" ]] || die "Directory does not exist and could not be created: $d"
  [[ -w "$d" ]] || die "Directory is not writable: $d"
}

# -------------------- preflight checks --------------------
preflight() {
  local -a REQUIRED_CMDS=(bash ttyd tmux asciinema awk grep)
  local -a missing=()
  for c in "${REQUIRED_CMDS[@]}"; do
    have "$c" || missing+=("$c")
  done
  if ((${#missing[@]})); then
    for c in "${missing[@]}"; do
      echo "ERROR: Missing required command: ${c}" >&2
    done
    echo "ERROR: Please install all required dependencies." >&2
    exit 1
  fi

  # Optional but recommended: one of (curl|nc)
  if ! have curl && ! have nc; then
    warn "Neither 'curl' nor 'nc' found; startup readiness check will use /dev/tcp fallback."
  fi

  # Optional for port scanning: one of (ss|netstat)
  if ! have ss && ! have netstat; then
    warn "Neither 'ss' nor 'netstat' found; free-port detection will assume the chosen port is free."
  fi

  # Optional: xdg-open for auto-opening the browser
  if ! have xdg-open; then
    warn "'xdg-open' not found; not opening a browser automatically."
  fi

  # Validate env values
  is_int "$TMUX_COLS" || die "TMUX_COLS must be an integer (got: $TMUX_COLS)"
  is_int "$TMUX_ROWS" || die "TMUX_ROWS must be an integer (got: $TMUX_ROWS)"
  is_int "$FONT_SIZE" || die "FONT_SIZE must be an integer (got: $FONT_SIZE)"
  is_int "$TT_PORT"   || die "TT_PORT must be an integer (got: $TT_PORT)"
  (( TT_PORT >= 1 && TT_PORT <= 65535 )) || die "TT_PORT must be between 1 and 65535 (got: $TT_PORT)"

  [[ -d "$WORKING_DIRECTORY" ]] || die "WORKING_DIRECTORY does not exist: $WORKING_DIRECTORY"
  [[ -r "$WORKING_DIRECTORY" ]] || die "WORKING_DIRECTORY is not readable: $WORKING_DIRECTORY"
  ensure_writable_dir "$(dirname "$ASCII_OUT")"
}

# -------------------- dynamic port selection --------------------
_find_free_port() {
  local p="$1"
  while :; do
    if have ss; then
      if ! ss -Hntl 2>/dev/null | awk '{print $4}' | grep -qE "(:|\\])${p}\$"; then
        echo "$p"; return 0
      fi
    elif have netstat; then
      if ! netstat -ntl 2>/dev/null | awk '{print $4}' | grep -qE "(:|\\])${p}\$"; then
        echo "$p"; return 0
      fi
    else
      # Best effort fallback: assume free
      echo "$p"; return 0
    fi
    p=$((p+1))
    (( p <= 65535 )) || die "No free TCP port found in range."
  done
}

# -------------------- main --------------------
preflight

TT_PORT="$(_find_free_port "$TT_PORT")"

# Ensure output dir exists (already checked writable)
mkdir -p "$(dirname "$ASCII_OUT")"

# Prepare inner command for ttyd
TT_CMD=$'bash -lc \'\n  set -Eeuo pipefail\n  S="${SESSION}"; C="${TMUX_COLS}"; R="${TMUX_ROWS}"; OUT="${ASCII_OUT}"\n  SOCK="ttyd-${SESSION}"\n  mkdir -p "$(dirname "$OUT")"\n\n  # Create session if missing at requested size\n  if ! tmux -L "$SOCK" has-session -t "$S" 2>/dev/null; then\n    tmux -L "$SOCK" new-session -c "${WORKING_DIRECTORY}" -d -s "$S" -x "$C" -y "$R" bash -l\n    tmux -L "$SOCK" set -g status off >/dev/null 2>&1 || true\n  fi\n\n  # Keep size fixed if supported; always enforce explicit size\n  tmux -L "$SOCK" set -g window-size manual >/dev/null 2>&1 || true\n  tmux -L "$SOCK" set -g status off >/dev/null 2>&1 || true\n  tmux -L "$SOCK" resize-window -t "$S:0" -x "$C" -y "$R" >/dev/null 2>&1 || true\n\n  echo "[ttyd] Recording to: $OUT (size ${C}x${R})" >&2\n\n  # Record; ends when tmux client detaches/exits\n  if asciinema rec --overwrite -q --cols "$C" --rows "$R" "$OUT" \\\n       -c "tmux -L \"$SOCK\" attach -t \"$S\""; then\n    rc=0\n  else\n    rc=$?\n  fi\n\n  # Optional: kill session/server after detach to fully clean up\n  if [[ "${TMUX_KILL_ON_DETACH:-0}" == "1" ]]; then\n    tmux -L "$SOCK" kill-session -t "$S" 2>/dev/null || tmux -L "$SOCK" kill-server 2>/dev/null || true\n  fi\n\n  exit "$rc"\n\''

# Launch ttyd; inherit env so the inner bash sees variables
ttyd -p "$TT_PORT" -o -W \
  -t "fontSize=${FONT_SIZE}" \
  -t "disableReconnect=true" \
  -t "titleFixed=${SESSION}" \
  env SESSION="$SESSION" TMUX_COLS="$TMUX_COLS" TMUX_ROWS="$TMUX_ROWS" \
      ASCII_OUT="$ASCII_OUT" TMUX_KILL_ON_DETACH="$TMUX_KILL_ON_DETACH" \
  bash -lc "$TT_CMD" &
TT_PID=$!

cleanup() { kill "$TT_PID" 2>/dev/null || true; }
trap cleanup INT TERM

# Wait for server to listen, then open browser
_url="http://127.0.0.1:${TT_PORT}/"
echo "[ttyd] Waiting for ${_url} ..."
for _i in $(seq 1 100); do
  if have curl; then
    curl -fsS "${_url}" >/dev/null 2>&1 && break
  elif have nc; then
    nc -z 127.0.0.1 "$TT_PORT" >/dev/null 2>&1 && break
  else
    (echo >/dev/tcp/127.0.0.1/"$TT_PORT") >/dev/null 2>&1 && break || true
  fi
  sleep 0.05
done

# Open the default browser (non-blocking)
if have xdg-open; then
  xdg-open "${_url}" >/dev/null 2>&1 || true
fi

echo "[ttyd] Serving at ${_url} (pid ${TT_PID}). Press Ctrl-C to stop."

# Block until ttyd exits; propagate exit code
wait "$TT_PID"

echo "Wrote ${ASCII_OUT}"
exit $?
