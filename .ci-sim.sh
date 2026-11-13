#!/usr/bin/env bash
export PATH=$HOME/.local/node/bin:/tmp/p/usr/bin:$PATH
cd ~/verify-batch || exit 9
cp /mnt/d/projects/xp-gate/githooks/__tests__/kotlin-gate.test.bats githooks/__tests__/
# 模拟 CI：全局 adapter 不可见
mv "$HOME/.config/xp-gate/adapters" "$HOME/.config/xp-gate/adapters.hidden" 2>/dev/null
timeout 400 bash node_modules/bats/bin/bats githooks/__tests__/kotlin-gate.test.bats > $HOME/kg5.tap 2>&1
RC=$?
mv "$HOME/.config/xp-gate/adapters.hidden" "$HOME/.config/xp-gate/adapters" 2>/dev/null
echo "ok=$(grep -c '^ok' $HOME/kg5.tap) notok=$(grep -c '^not ok' $HOME/kg5.tap)"
grep -A5 '^not ok' $HOME/kg5.tap | head -10
