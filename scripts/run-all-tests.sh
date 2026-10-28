#!/bin/bash
# 本地测试，每组用全新本地 D1。用法（每组单独调用一次，和手工流程一致）：
#   bash scripts/run-all-tests.sh static            # tsc + 单测
#   bash scripts/run-all-tests.sh turn              # turn_e2e + adventure_e2e（共用一个库）
#   bash scripts/run-all-tests.sh events|content|world|world_turn|learning|coursesync|google
# 每次调用前需保证 8800 没有旧服务；调用后请单独执行 pkill -f "port 8800"（退出码 144 正常）。
cd "$(dirname "$0")/.." || exit 1
case "$1" in
  static) npx tsc --noEmit && node --test test/*.test.mjs 2>&1 | grep -E "^# (pass|fail)"; exit ${PIPESTATUS[0]};;
  turn) T="turn_e2e.py adventure_e2e.py";; events) T="events_e2e.py";; content) T="content_e2e.py";;
  world) T="world_e2e.py";; world_turn) T="world_turn_e2e.py";; coursesync) T="coursesync_e2e.py";; google) T="google_e2e.py";; learning) T="learning_e2e.py";; *) echo "unknown group"; exit 2;;
esac
if curl -s -o /dev/null localhost:8800; then echo "8800 已被占用，先 pkill -f \"port 8800\""; exit 2; fi
D=/tmp/db-$RANDOM
npx wrangler d1 migrations apply catmin-study --local --persist-to $D -c test/wrangler.site.jsonc >/dev/null 2>&1
npx wrangler dev -c test/wrangler.site.jsonc --port 8800 --persist-to $D >/tmp/wr.log 2>&1 &
sleep 15
rc=0
for t in $T; do python3 test/$t >/tmp/out.$t.txt 2>&1 && tail -1 /tmp/out.$t.txt | grep -q "ALL PASS" && echo "OK   $t" || { echo "FAIL $t"; grep FAIL /tmp/out.$t.txt | head -5; rc=1; }; done
exit $rc
