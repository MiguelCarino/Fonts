#!/bin/sh
# Runs every test file standalone; exits non-zero if any fails.
cd "$(dirname "$0")/.." || exit 1
fail=0
for f in tests/*.test.js; do
  echo "== $f =="
  node "$f" || fail=1
done
exit $fail
