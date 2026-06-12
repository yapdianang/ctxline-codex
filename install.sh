#!/usr/bin/env sh
set -eu

node "$(dirname "$0")/bin/ctxline-codex.js" install "$@"
