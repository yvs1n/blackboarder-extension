#!/usr/bin/env bash
# Updates Blackboarder now and turns on automatic updates. Run it once; your data is kept.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT="$DIR/updater/blackboarder-updater.sh"
if [ ! -f "$SCRIPT" ]; then
  SCRIPT="$DIR/blackboarder-updater.sh"
fi
exec bash "$SCRIPT" --install
