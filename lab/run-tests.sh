#!/usr/bin/env bash
# runs-in: host — node only, no network, no browser.
set -u
cd "$(dirname "$0")"
fail=0; total=0
for t in test-*.js; do
  out=$(node "$t" 2>&1 | grep -v '^\[g2p')
  line=$(echo "$out" | tail -1)
  printf '%-20s %s\n' "$t" "$line"
  echo "$line" | grep -qE '^[0-9]+ passed, 0 failed' || { fail=1; echo "$out" | grep FAIL; }
  n=$(echo "$line" | grep -oE '^[0-9]+' || echo 0); total=$((total+n))
done
echo "-------------------------------------------"
[ $fail -eq 0 ] && echo "$total assertions, all passing" || echo "FAILURES ABOVE"
exit $fail
