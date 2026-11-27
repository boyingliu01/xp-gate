#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# reinstall-xp-gate — WSL 开发环境创建脚本
#
# 目标环境（依据 README.md / package.json / .github/workflows/test.yml 实测核对）：
#   - Node 26 LTS（package.json engines >=22；CI 矩阵 22 / 24 / 26）
#   - 零第三方 npm 依赖 —— **不需要也不应该** `npm install`
#   - 门禁工具：jscpd  lizard  semgrep  checkov  hadolint  gitleaks  jq
#   - xp-gate CLI：@boyingliu01/xp-gate（TODO.md 里写的裸名 `xp-gate` 在
#     registry 上不存在，本脚本用全名，可用 --xp-gate-pkg 覆盖）
#
# 用法：
#   bash scripts/setup-wsl.sh                 # 安装全部，跳过已存在的
#   bash scripts/setup-wsl.sh --dry-run       # 只打印计划，不改系统
#   bash scripts/setup-wsl.sh --clone         # 先克隆仓库（默认已在仓库内运行）
#   bash scripts/setup-wsl.sh --clone --clone-dir "$HOME/projects"
#   bash scripts/setup-wsl.sh --no-hadolint --no-gitleaks --no-checkov
#   bash scripts/setup-wsl.sh --with-shell    # 额外写 ~/.bashrc 的编辑器/别名段
#
# 幂等：重复运行只补缺失项。每个安装步骤失败不中断其余步骤，最后统一汇总返回码。
#
# 安全边界：
#   - 不写任何 agent 的 skills 根（那是 install.mjs 的职责）
#   - 不设置全局 `core.hooksPath`（见末尾提示）
#   - 任何覆盖已有文件的动作先备份
# ---------------------------------------------------------------------------
set -uo pipefail

# ---------------------------------------------------------------- 参数解析 --
DRY_RUN=0
DO_CLONE=0
WITH_SHELL=0
CLONE_DIR=""
XP_GATE_PKG="@boyingliu01/xp-gate"
WANT_HADOLINT=1
WANT_GITLEAKS=1
WANT_CHECKOV=1
WANT_COREPACK=1

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)        DRY_RUN=1 ;;
    --clone)          DO_CLONE=1 ;;
    --clone-dir)      CLONE_DIR="${2:?--clone-dir 需要路径}"; shift ;;
    --with-shell)     WITH_SHELL=1 ;;
    --xp-gate-pkg)    XP_GATE_PKG="${2:?--xp-gate-pkg 需要包名}"; shift ;;
    --no-hadolint)    WANT_HADOLINT=0 ;;
    --no-gitleaks)    WANT_GITLEAKS=0 ;;
    --no-checkov)     WANT_CHECKOV=0 ;;
    --no-corepack)    WANT_COREPACK=0 ;;
    -h|--help)        usage 0 ;;
    *) echo "未知参数：$1" >&2; usage 2 ;;
  esac
  shift
done

# ------------------------------------------------------------------ 输出层 --
STEP=0
FAILED=()
PLANNED=()
SKIPPED=()
declare -A CHECKS=()

section() {
  STEP=$((STEP + 1))
  printf '\n\033[1m== %d. %s\033[0m\n' "$STEP" "$1"
}

info()  { printf '   %s\n' "$1"; }
warn()  { printf '   \033[33m! %s\033[0m\n' "$1"; }
ok()    { printf '   \033[32m✓\033[0m %s\n' "$1"; }
bad()   { printf '   \033[31m✗\033[0m %s\n' "$1"; }

# run <说明> <命令...> — dry-run 时只打印
run() {
  local desc="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry-run] %s\n' "$desc"
    printf '             $ %s\n' "$*"
    return 0
  fi
  printf '   → %s\n' "$desc"
  "$@"
}

have() { command -v "$1" >/dev/null 2>&1; }

# fail <标签> <消息> — dry-run 时只记为「运行时会处理」，不算真失败。
# 不区分的话，dry-run 会把「还没装的东西」全报成失败项，汇总就失去意义了。
fail() {
  local tag="$1" msg="$2"
  bad "$msg"
  if [ "$DRY_RUN" = 1 ]; then
    PLANNED+=("$tag")
  else
    FAILED+=("$tag")
  fi
}

# 版本门槛：Node 必须是 >= 22 的现行 LTS 线。
node_major() { [ -n "${1:-}" ] && echo "${1#v}" | cut -d. -f1; }

# ------------------------------------------------------------------ 0 环境 --
section "环境自检"

# 在 Windows 的 Git Bash 里跑会走「全部已安装」的假路径：检测不到 apt，
# 二进制探测能命中 Windows 版本，于是看起来像成功。必须先拒绝。
if uname -s 2>/dev/null | grep -qiE 'msys|cygwin|mingw'; then
  bad "检测到 MSYS/Cygwin（Windows 上的 Git Bash），不是在 WSL 里"
  printf '   请在 WSL 终端里运行：\n'
  printf '     wsl --cd %s\n' "$(pwd)"
  printf '     bash scripts/setup-wsl.sh --dry-run\n'
  exit 2
fi

if [ ! -e /proc/version ] || ! grep -qi microsoft /proc/version 2>/dev/null; then
  warn "看起来不是 WSL（/proc/version 里没有 Microsoft 标记），继续执行但按 Linux 逻辑处理"
else
  ok "WSL 环境：$(grep -o 'microsoft.*' /proc/version 2>/dev/null | head -c 60)"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --clone：在 WSL 里从零拉一份仓库，而不是在已检出的目录里跑。
# 这是推荐的起点——Windows 侧的仓库可能带 CRLF，或位于 /mnt/c（IO 慢、换行易漂）。
if [ "$DO_CLONE" = 1 ]; then
  CLONE_DIR="${CLONE_DIR:-$HOME/projects}"
  DEST="$CLONE_DIR/reinstall-xp-gate"
  REPO_URL="${REPO_URL:-https://github.com/boyingliu01/reinstall-xp-gate.git}"
  info "克隆目标：$DEST"
  info "来源：$REPO_URL"
  [ "$DRY_RUN" = 1 ] || mkdir -p "$CLONE_DIR"
  if [ -d "$DEST/.git" ]; then
    ok "已存在，改为更新：$DEST"
    run "git pull --ff-only" git -C "$DEST" pull --ff-only
  else
    run "git clone" git clone "$REPO_URL" "$DEST"
  fi
  [ "$DRY_RUN" = 1 ] || REPO_ROOT="$DEST"
fi

info "仓库根：$REPO_ROOT"

if [ ! -f "$REPO_ROOT/package.json" ]; then
  fail "仓库定位" "当前目录不像本仓库（缺 package.json）"
fi

# ------------------------------------------------------------------ 1 系统 --
section "系统基础包（apt）"

APT_PKGS="git curl ca-certificates python3 python3-venv python3-pip jq unzip wget"
MISSING_APT=()
for p in $APT_PKGS; do
  if dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed"; then
    :
  else
    MISSING_APT+=("$p")
  fi
done

if [ ${#MISSING_APT[@]} -eq 0 ]; then
  ok "全部已安装：$APT_PKGS"
elif ! have apt-get; then
  fail "apt 基础包" "缺少 apt-get，无法自动安装：${MISSING_APT[*]}"
else
  info "待安装：${MISSING_APT[*]}"
  run "更新软件源索引" sudo apt-get update -qq
  run "安装基础包" sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${MISSING_APT[@]}"
fi

# ------------------------------------------------------------------ 2 Node --
section "Node.js 26 LTS + npm"

# 26.x 是当前 LTS 线（package.json engines 为 >=22；CI 测试 22/24/26）。
# 用 NodeSource 26.x 源而不是 nvm：TODO.md 已决定「只用一个 Node，不上版本管理器」。
if have node; then
  CUR_NODE="$(node --version 2>/dev/null || echo '')"
  CUR_MAJOR="$(node_major "$CUR_NODE")"
  info "当前 node：$CUR_NODE"
  if [ "${CUR_MAJOR:-0}" -ge 22 ] 2>/dev/null; then
    ok "Node 版本满足 engines >=22"
  else
    warn "Node 版本过低（<22），下面会用 NodeSource 26.x 升级"
    NEED_NODE=1
  fi
else
  info "当前未安装 node"
  NEED_NODE=1
fi

if [ "${NEED_NODE:-0}" = 1 ]; then
  if ! have curl; then
    bad "没有 curl，跳过 Node 安装"
    FAILED+=("Node 安装")
  else
    run "导入 NodeSource 26.x 签名密钥" bash -c \
      'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/nodesource.gpg --yes'
    run "写入 NodeSource 26.x 软件源" bash -c \
      'echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_26.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list'
    run "安装 nodejs" sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
  fi
fi

if [ "$DRY_RUN" = 1 ]; then
  # dry-run 里 apt 并未真跑，末尾复核必然看到旧版本；这不算失败。
  info "[dry-run] 跳过 Node 版本复核（安装步骤未执行）"
elif have node; then
  NODE_VER="$(node -v)"
  HAVE_NODE_MAJOR="$(node_major "$NODE_VER")"
  if [ "${HAVE_NODE_MAJOR:-0}" -ge 22 ] 2>/dev/null; then
    ok "node $NODE_VER / npm $(npm --version 2>/dev/null)"
  else
    bad "node 仍是 $NODE_VER，低于 engines >=22（该步失败，请看上面的 apt 输出）"
    FAILED+=("Node 版本")
  fi
else
  bad "node 仍不可用"
  FAILED+=("Node 安装")
fi

# corepack：这不是前端 monorepo，只用于 CI 环境一致性；默认装但可关闭。
# Node 25+ 起通过 apt 装的 nodejs 不再捆绑 corepack，所以单独探测。
if [ "$WANT_COREPACK" = 1 ] && have node; then
  if have corepack; then
    ok "corepack 已就绪：$(corepack --version 2>/dev/null | head -1)"
  else
    run "安装 corepack（可选，失败不阻塞）" bash -c 'npm i -g corepack'
  fi
fi

# ------------------------------------------------------------------ 3 Python --
section "Python 门禁工具（lizard / semgrep / checkov）"

# 用 venv 而不是 pip 直装：Debian/Ubuntu 的 PEP 668 会拒绝 global pip 安装，
# 且 venv 卸得干净、不污染系统解释器。venv 装完后把 bin 目录加到 PATH。
VENV_DIR="${VENV_DIR:-$HOME/.local/venv/xp-gate-tools}"
PATH_MARKER="# >>> xp-gate-tools venv >>>"
PATH_MARKER_END="# <<< xp-gate-tools venv <<<"

# 判定标准是「解释器可执行」而不是「目录存在」：上次 venv 建到一半失败会留下
# 一个空目录，只看目录存在会永久跳过、再也不重试。
if [ -x "$VENV_DIR/bin/python" ]; then
  ok "venv 已存在：$VENV_DIR"
else
  if ! have python3; then
    fail "python3 缺失" "没有 python3（apt 步骤未成功），lizard / semgrep / checkov 无法安装"
  else
    run "创建 venv：$VENV_DIR" python3 -m venv "$VENV_DIR"
    # venv 自己的 ensurepip 在精简版 Ubuntu 上可能失败，提示补救方式
    if [ "$DRY_RUN" = 0 ] && [ ! -x "$VENV_DIR/bin/python" ]; then
      bad "venv 创建失败，多为缺 python3-venv / ensurepip"
      printf '       手动修复：sudo apt-get install -y python3-venv python3-full\n'
      printf '       或改用 pipx：sudo apt-get install -y pipx && pipx install lizard && pipx install semgrep\n'
    fi
  fi
fi

PY="$VENV_DIR/bin/python"
if [ -x "$PY" ]; then
  # `pip show` 探测比 import 便宜且不执行包代码
  MISSING_PY=()
  for pkg in lizard semgrep checkov; do
    if ! "$PY" -m pip show "$pkg" >/dev/null 2>&1; then
      MISSING_PY+=("$pkg")
    fi
  done
  if [ ${#MISSING_PY[@]} -gt 0 ]; then
    [ "$WANT_CHECKOV" = 0 ] && MISSING_PY=( "$(printf '%s\n' "${MISSING_PY[@]}" | grep -v '^checkov$' || true)" )
    if [ ${#MISSING_PY[@]} -gt 0 ]; then
      run "venv 内安装：${MISSING_PY[*]}" "$PY" -m pip install --quiet --upgrade pip
      run "venv 内安装门禁工具" "$PY" -m pip install --quiet "${MISSING_PY[@]}"
    fi
  else
    ok "venv 内已有 lizard / semgrep / checkov"
  fi
else
  fail "python venv" "venv 不可用：$PY"
fi

# 把 venv bin 写进 ~/.bashrc（只在缺标记时追加；--dry-run 只打印）
if [ -x "$PY" ]; then
  BASH_RC="$HOME/.bashrc"
  [ -f "$BASH_RC" ] || touch "$BASH_RC"
  if grep -qF "$PATH_MARKER" "$BASH_RC" 2>/dev/null; then
    ok "$BASH_RC 已有 venv PATH 段"
  elif [ "$DRY_RUN" = 1 ]; then
    printf '   [dry-run] 在 %s 追加 venv PATH 段（%s/bin）\n' "$BASH_RC" "$VENV_DIR"
  else
    cp -a "$BASH_RC" "$BASH_RC.xp-gate.bak" 2>/dev/null || true
    {
      printf '\n%s\n' "$PATH_MARKER"
      printf '# xp-gate 门禁工具（lizard / semgrep / checkov）\n'
      # The format string is single-quoted on purpose: this line is WRITTEN INTO
      # ~/.bashrc, where "$PATH" must stay literal so it expands when the shell
      # sources the file. Expanding it here would bake this run's PATH in.
      # shellcheck disable=SC2016
      printf 'export PATH="%s/bin:$PATH"\n' "$VENV_DIR"
      printf '%s\n' "$PATH_MARKER_END"
    } >> "$BASH_RC"
    ok "已追加 venv PATH 段到 ~/.bashrc（备份：~/.bashrc.xp-gate.bak）"
  fi

  # --with-shell：编辑器和几个只读别名。与 PATH 段分开标记，互不覆盖。
  SHELL_MARKER="# >>> reinstall-xp-gate >>>"
  SHELL_MARKER_END="# <<< reinstall-xp-gate <<<"
  # A block written before 2.0.0 carries the old marker. Treating it as absent
  # would append a second block and leave two competing EDITOR/alias sections in
  # ~/.bashrc, so the old marker counts as "already present".
  SHELL_MARKER_LEGACY="# >>> xp-gate-reinstall >>>"
  if [ "$WITH_SHELL" = 1 ]; then
    if grep -qF "$SHELL_MARKER" "$BASH_RC" 2>/dev/null \
      || grep -qF "$SHELL_MARKER_LEGACY" "$BASH_RC" 2>/dev/null; then
      ok "$BASH_RC 已有编辑器/别名段"
    elif [ "$DRY_RUN" = 1 ]; then
      printf '   [dry-run] 在 %s 追加编辑器/别名段\n' "$BASH_RC"
    else
      {
        printf '\n%s\n' "$SHELL_MARKER"
        # Same reason as the PATH line above: it is appended to ~/.bashrc and
        # must keep ${EDITOR:-nano} unevaluated until that shell starts.
        # shellcheck disable=SC2016
        printf 'export EDITOR=${EDITOR:-nano}\n'
        printf "alias xg='xp-gate'\n"
        printf "alias xgt='node %s/scripts/verify.mjs'\n" "$REPO_ROOT"
        printf "alias xga='node %s/scripts/audit.mjs'\n" "$REPO_ROOT"
        printf '%s\n' "$SHELL_MARKER_END"
      } >> "$BASH_RC"
      ok "已追加编辑器/别名段到 ~/.bashrc"
    fi
  fi
fi

# 本脚本内部也要能立即看到 venv 里的工具，否则后面的验收会被误判为「缺失」
export PATH="$VENV_DIR/bin:$PATH"

# ------------------------------------------------------------------ 4 npm 工具 --
section "npm 全局工具（jscpd）"

if have jscpd; then
  ok "jscpd 已安装：$(jscpd --version 2>/dev/null | head -1)"
else
  run "全局安装 jscpd" bash -c 'npm i -g jscpd'
fi

# ------------------------------------------------------------------ 5 二进制 --
section "二进制门禁工具（hadolint / gitleaks / jq）"

# jq 已在 apt 里装过；这里只补 GitHub 发布的二进制
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) GH_ARCH=x86_64 ;;
  aarch64|arm64) GH_ARCH=arm64 ;;
  *) GH_ARCH="" ;;
esac
[ -n "$GH_ARCH" ] || warn "未知架构 $ARCH，跳过二进制下载"

install_github_binary() {
  # install_github_binary <名称> <仓库> <asset 模板，含 %ARCH%> <二进制在包内的路径>
  local name="$1" repo="$2" asset_tpl="$3" inner="$4"
  if have "$name"; then
    ok "$name 已安装：$("$name" --version 2>&1 | head -1)"
    return 0
  fi
  if [ -z "$GH_ARCH" ]; then
    warn "$name 跳过：架构不受支持"
    return 0
  fi
  local asset="${asset_tpl//%ARCH%/$GH_ARCH}"
  local url="https://github.com/$repo/releases/latest/download/$asset"
  local tmp; tmp="$(mktemp -d)"
  run "下载 $name：$asset" curl -fsSL -o "$tmp/$asset" "$url" || { rm -rf "$tmp"; bad "$name 下载失败：$url"; return 1; }
  if [ "$DRY_RUN" = 1 ]; then rm -rf "$tmp"; return 0; fi
  case "$asset" in
    *.tar.gz) tar -xzf "$tmp/$asset" -C "$tmp" ;;
    *.zip)    unzip -q "$tmp/$asset" -d "$tmp" ;;
    *)        : ;;
  esac
  local src="$tmp/$inner"
  if [ ! -f "$src" ]; then
    bad "$name 解包后找不到 $inner（压缩包结构可能已变，请手动安装）"
    rm -rf "$tmp"; return 1
  fi
  chmod +x "$src"
  sudo install -m 0755 "$src" "/usr/local/bin/$name" || { bad "$name 安装到 /usr/local/bin 失败"; rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  ok "$name 安装到 /usr/local/bin/$name"
}

if [ "$WANT_HADOLINT" = 1 ] && ! have hadolint; then
  install_github_binary hadolint hadolint/hadolint "hadolint-linux-%ARCH%" "hadolint-linux-%ARCH%"
elif [ "$WANT_HADOLINT" = 1 ]; then
  ok "hadolint 已安装：$(hadolint --version 2>&1 | head -1)"
fi

if [ "$WANT_GITLEAKS" = 1 ] && ! have gitleaks; then
  install_github_binary gitleaks gitleaks/gitleaks "gitleaks_linux_%ARCH%.tar.gz" "gitleaks"
elif [ "$WANT_GITLEAKS" = 1 ]; then
  ok "gitleaks 已安装：$(gitleaks --version 2>&1 | head -1)"
fi

if ! have jq; then
  fail "jq" "jq 缺失（apt 步骤未成功）"
fi

# ------------------------------------------------------------------ 6 xp-gate CLI --
section "xp-gate CLI"

# 已是最新就不重装：`npm i -g` 每次都要走网络并重写全局 bin，
# 在这个脚本里重复执行只会延长耗时、并可能把正在用的版本换掉。
CUR_XP=""
if have xp-gate; then
  CUR_XP="$(xp-gate --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  info "当前版本：${CUR_XP:-未知}"
else
  info "未安装"
fi

if [ "$DRY_RUN" = 1 ]; then
  run "安装 $XP_GATE_PKG@latest" bash -c "npm i -g '$XP_GATE_PKG@latest'"
else
  LATEST_XP="$(npm view "$XP_GATE_PKG" version 2>/dev/null | tail -1 | tr -d '[:space:]')"
  if [ -n "$LATEST_XP" ] && [ "$CUR_XP" = "$LATEST_XP" ]; then
    ok "已是最新（$CUR_XP），跳过安装"
  elif [ -z "$LATEST_XP" ]; then
    warn "查不到 registry 最新版（离线？），仍执行安装"
    run "安装 $XP_GATE_PKG@latest" bash -c "npm i -g '$XP_GATE_PKG@latest'"
  else
    run "升级 $CUR_XP → $LATEST_XP" bash -c "npm i -g '$XP_GATE_PKG@latest'"
  fi
fi

if [ "$DRY_RUN" = 1 ]; then
  info "[dry-run] 跳过 xp-gate 初始化（init / doctor）"
else
  if have xp-gate; then
    ok "xp-gate $(xp-gate --version 2>/dev/null | head -1) 可用"
    # 注意：init/install 即使 doctor 报问题也返回 0（SKILL.md 记录的陷阱），
    # 所以这一步只看输出，不作为验收依据。
    warn "初始化会写全局配置与钩子，本脚本不代跑。确认后用：xp-gate install --global && xp-gate update-hooks --global"
  else
    bad "xp-gate 仍不可用（npm 全局 bin 是否在 PATH？）"
    FAILED+=("xp-gate CLI")
  fi
fi

# ------------------------------------------------------------------ 7 技能安装 --
section "本 skill 的 canonical 副本"

# 注意：xp-gate 发布包在 v1.2.2 ~ 0.38.x 某段时期曾自带 skills/xp-gate-reinstall，
# 全局装会被 `update-skill --all` 用发布包版本覆盖 canonical 目录。
# 0.38.125 实测已不再自带（skills/ 下 12 个，无此 skill），但保留“最后同步”的顺序
# 是无害的，也兼容仍在使用旧发布包的机器。
# 2.0.0 起本 skill 更名为 reinstall-xp-gate，旧名副本由 install.mjs 自动清理。
CANON="$HOME/.local/share/xp-gate/skills/reinstall-xp-gate"

if [ -f "$REPO_ROOT/SKILL.md" ] && [ -f "$REPO_ROOT/scripts/install.mjs" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry-run] node %s/scripts/install.mjs --dry-run\n' "$REPO_ROOT"
  else
    # 先比内容再谈版本文件：VERSION 缺失或格式不同不代表内容有差异，
    # 拿它单独当判据会每次运行都留一个无意义的 .backup 目录。
    if [ -d "$CANON" ] && [ -f "$CANON/SKILL.md" ] && ! diff -rq "$REPO_ROOT" "$CANON" \
        --exclude=.git --exclude=node_modules --exclude=coverage \
        --exclude=.xp-gate --exclude=.quality-history.jsonl >/dev/null 2>&1; then
      # 备份名按版本分桶、不带时间戳：同一版本反复运行只会刷新同一个备份，
      # 不会每跑一次就堆一个目录（实测跑 8 次堆了 8 个）。
      CANON_VER="$(cat "$CANON/VERSION" 2>/dev/null || echo unknown)"
      BK="$CANON.backup.$CANON_VER"
      warn "canonical 内容与本仓库不一致，备份到：$BK"
      rm -rf "$BK"
      cp -a "$CANON" "$BK" 2>/dev/null || true
    fi
    if node "$REPO_ROOT/scripts/install.mjs" --dry-run >/dev/null 2>&1; then
      # Written as if/else, not `A && B || { ... }`. The latter is not
      # if-then-else: if `ok` fails it also runs the failure branch, so a
      # successful install could be reported as "install.mjs 失败".
      if node "$REPO_ROOT/scripts/install.mjs"; then
        ok "skill 已同步到各 agent 根"
      else
        bad "install.mjs 失败"
        FAILED+=("skill 同步")
      fi
    else
      bad "install.mjs --dry-run 失败，跳过同步"; FAILED+=("skill 同步")
    fi
  fi
else
  warn "未找到 SKILL.md / scripts/install.mjs，跳过"
fi

# ------------------------------------------------------------------ 8 Git --
section "Git 配置（换行符）"

# 本仓库在 Windows 上检出，迁到 Linux 后 autocrlf 的处理方式必须显式化，
# 否则同一文件在两边哈希不一致，覆盖率和 skill 内容比对都会漂。
# 两个读取都加 -C "$REPO_ROOT"：不加的话在别处运行会读到当前目录的仓库配置。
if [ -d "$REPO_ROOT/.git" ]; then
  CUR_AUTOCRLF="$(git -C "$REPO_ROOT" config --get core.autocrlf 2>/dev/null || true)"
  if [ "$CUR_AUTOCRLF" = "input" ]; then
    ok "core.autocrlf = input（已正确）"
  else
    info "当前 core.autocrlf = ${CUR_AUTOCRLF:-<未设置>}"
    # --local：只作用于本仓库，不碰用户全局配置
    run "设置本仓库 core.autocrlf=input" git -C "$REPO_ROOT" config --local core.autocrlf input
  fi

  if [ -f "$REPO_ROOT/.gitattributes" ]; then
    ok ".gitattributes 已存在"
  else
    warn "没有 .gitattributes；若出现 CRLF 漂移，可考虑加一行 '* text=auto eol=lf'"
  fi

  CUR_HOOKSPATH="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
  if [ -n "$CUR_HOOKSPATH" ]; then
    ok "core.hooksPath = $CUR_HOOKSPATH"
    case "$CUR_HOOKSPATH" in
      /mnt/[a-z]/*|*AppData*|*\\\\*)
        warn "该值指向 Windows 路径，WSL 里不可用；xp-gate install 会重写为 Linux 路径，重装后请复核"
        ;;
    esac
  else
    # 不自动设置：hooksPath 是全局生效的，写错会同时影响所有仓库的门禁
    warn "core.hooksPath 未设置 —— xp-gate 的 pre-commit 门禁不会生效，需在 xp-gate install 后确认"
  fi
else
  warn "不是 git 仓库（或 --dry-run 未克隆），跳过 git 配置"
fi

# ------------------------------------------------------------------ 9 验收 --
section "验收（真实执行，不看退出码一律看输出）"

verify_tool() {
  local t="$1"
  if [ "$DRY_RUN" = 1 ]; then printf '   [dry-run] 检查工具 %s\n' "$t"; return 0; fi
  if ! have "$t"; then
    CHECKS["tool:$t"]="MISSING"
    printf '   \033[33m!\033[0m %-10s 未找到\n' "$t"
    SKIPPED+=("$t")
    return 0
  fi
  # 「存在」不等于「能用」：checkov 这类 shebang 指向 Windows 路径的脚本
  # 在 WSL 里 which 得到、执行却报 bad interpreter。必须真的跑一次。
  local out rc
  out="$("$t" --version 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    CHECKS["tool:$t"]="BROKEN"
    printf '   \033[31m✗\033[0m %-10s 存在但无法执行（退出码 %s）\n' "$t" "$rc"
    printf '       %s\n' "$(printf '%s' "$out" | head -1)"
    FAILED+=("$t 无法执行")
    return 1
  fi
  CHECKS["tool:$t"]="OK"
  printf '   \033[32m✓\033[0m %-10s %s\n' "$t" "$(printf '%s' "$out" | head -1)"
}

# 三项由脚本自己负责，必须存在；hadolint/gitleaks/checkov 可选
for t in node npm jq jscpd lizard semgrep; do verify_tool "$t"; done
for t in python3 git curl; do verify_tool "$t"; done
[ "$WANT_HADOLINT" = 1 ] && verify_tool hadolint
[ "$WANT_GITLEAKS" = 1 ] && verify_tool gitleaks
[ "$WANT_CHECKOV" = 1 ]  && verify_tool checkov
verify_tool xp-gate

if [ "$DRY_RUN" = 0 ]; then
  info "运行测试套件（期望 196/196，依据 TODO.md 基线）"
  TEST_LOG="$(mktemp)"
  if node --test "$REPO_ROOT"/tests/*.test.mjs >"$TEST_LOG" 2>&1; then
    # 退出码 0 不够：glob 一个都没匹配到、或测试目录不存在时，node 也会「成功」
    # 地跑 0 个用例。必须再核对计数，否则空跑会被报成通过。
    TESTS_RUN="$(grep -E '^ℹ tests ' "$TEST_LOG" | head -1 | grep -oE '[0-9]+' | head -1)"
    if [ -z "${TESTS_RUN:-}" ] || [ "$TESTS_RUN" -eq 0 ]; then
      bad "测试运行了 0 个用例——测试没被找到，不能算通过"
      FAILED+=("测试套件（空跑）")
    else
      ok "测试通过：$(grep -E '^ℹ (tests|pass|fail) ' "$TEST_LOG" | tr '\n' ' ')"
    fi
  else
    bad "测试失败，尾部输出："
    tail -20 "$TEST_LOG" | sed 's/^/       /'
    FAILED+=("测试套件")
  fi
  rm -f "$TEST_LOG"
fi

# ------------------------------------------------------------------ 汇总 --
printf '\n\033[1m== 汇总\033[0m\n'
if [ "$DRY_RUN" = 1 ]; then
  info "dry-run 完成：以上命令未执行。去掉 --dry-run 重新运行。"
fi

MISSING_TOOLS=()
for t in node npm jq jscpd lizard semgrep xp-gate; do
  [ "${CHECKS[tool:$t]:-}" = "OK" ] || MISSING_TOOLS+=("$t")
done

if [ ${#MISSING_TOOLS[@]} -gt 0 ] && [ "$DRY_RUN" = 0 ]; then
  bad "仍缺失：${MISSING_TOOLS[*]}"
  FAILED+=("必需工具")
fi

if [ "$DRY_RUN" = 0 ]; then
  printf '\n   下一步（本脚本刻意不代做，因为它们会改动全局状态）：\n'
  printf '     1. xp-gate install --global && xp-gate update-hooks --global\n'
  printf '     2. 重跑 skill 同步：node %s/scripts/install.mjs\n' "$REPO_ROOT"
  printf '     3. 全量门禁：npm test && node scripts/coverage.mjs && node scripts/hp-gate.mjs && node scripts/mutation.mjs\n'
  printf '        （mutation 需先有 jscpd/lizard 且耗时较长）\n'
  printf '     4. xp-gate check . --all\n'
  printf '\n   注意：不要设全局 core.hooksPath，改本仓库 .git/hooks 才不会影响其它项目。\n'
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  printf '\n\033[31m失败项：%s\033[0m\n' "${FAILED[*]}"
  exit 1
fi

if [ ${#PLANNED[@]} -gt 0 ]; then
  printf '\n   运行时会处理（dry-run 未执行）：%s\n' "${PLANNED[*]}"
fi
if [ ${#SKIPPED[@]} -gt 0 ]; then
  printf '   可选项缺失（不阻塞）：%s\n' "${SKIPPED[*]}"
fi

if [ "$DRY_RUN" = 1 ]; then
  printf '\n\033[32m计划打印完毕，未改动系统。\033[0m\n'
  exit 0
fi
printf '\n\033[32m环境创建完成。\033[0m\n'
exit 0
