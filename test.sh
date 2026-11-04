#!/bin/bash
# Runs the charm in a hidden headless GNOME Shell and saves screenshots to $1.
set -u
OUT=${1:-/tmp/charm-test}; rm -rf "$OUT"; mkdir -p "$OUT"
SANDBOX=$(mktemp -d)
mkdir -p "$SANDBOX/data/gnome-shell/extensions" "$SANDBOX/config" "$SANDBOX/runtime"; chmod 700 "$SANDBOX/runtime"
ln -s "$(cd "$(dirname "$0")" && pwd)" "$SANDBOX/data/gnome-shell/extensions/deepavali-charm@ranga"
export XDG_DATA_HOME=$SANDBOX/data XDG_CONFIG_HOME=$SANDBOX/config XDG_RUNTIME_DIR=$SANDBOX/runtime
export DEEPAVALI_CHARM_TEST=$OUT
dbus-run-session -- bash -c 2>/dev/null '
  gsettings set org.gnome.shell enabled-extensions "[\"deepavali-charm@ranga\"]"
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.desktop.background picture-uri ""
  gsettings set org.gnome.desktop.background primary-color "#2a3a55"
  gnome-shell --headless --virtual-monitor 1920x1080 --no-x11 --wayland >"$DEEPAVALI_CHARM_TEST/shell.log" 2>&1 &
  pid=$!
  for i in $(seq 80); do [ -f "$DEEPAVALI_CHARM_TEST/done" ] && break; sleep 0.5; done
  sleep 1; kill $pid; wait $pid 2>/dev/null'
rm -rf "$SANDBOX"
ls "$OUT"; grep -iE "deepavali|error|JS ERROR" "$OUT/shell.log" | head -20
