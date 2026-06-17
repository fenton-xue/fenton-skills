#!/bin/bash
# link_skill.sh - 将 skill 文件夹通过符号链接链接到目标项目
#
# 用法: link_skill.sh <skill名称或部分名称> <目标路径>
# 示例: link_skill.sh testcase-generator "D:/Workspace/MyProject"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_SOURCE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# 参数检查
if [ $# -lt 2 ]; then
    error "用法: link_skill.sh <skill名称或部分名称> <目标路径>"
    exit 1
fi

SKILL_PARTIAL="$1"
TARGET_BASE="$2"

# 模糊匹配 skill 名称
MATCHES=()
while IFS= read -r line; do
    [ -n "$line" ] && MATCHES+=("$line")
done < <(find "$SKILLS_SOURCE_DIR" -maxdepth 1 -mindepth 1 -type d -iname "*${SKILL_PARTIAL}*" -printf "%f\n" | sort)

if [ ${#MATCHES[@]} -eq 0 ]; then
    error "未找到匹配 '$SKILL_PARTIAL' 的 skill"
    error "可用的 skill:"
    find "$SKILLS_SOURCE_DIR" -maxdepth 1 -mindepth 1 -type d -printf "  - %f\n" | sort
    exit 1
fi

# 精确匹配优先
SKILL_NAME=""
if [ -d "$SKILLS_SOURCE_DIR/$SKILL_PARTIAL" ]; then
    SKILL_NAME="$SKILL_PARTIAL"
elif [ ${#MATCHES[@]} -eq 1 ]; then
    SKILL_NAME="${MATCHES[0]}"
else
    error "找到多个匹配 '$SKILL_PARTIAL' 的 skill:"
    for m in "${MATCHES[@]}"; do error "  - $m"; done
    error "请提供更精确的名称"
    exit 1
fi

info "匹配到: $SKILL_NAME"

SOURCE_PATH="$SKILLS_SOURCE_DIR/$SKILL_NAME"
TARGET_BASE="${TARGET_BASE//\\//}"

# 目标路径就是链接所在的目录，链接名称取源文件夹名称
LINK_PATH="$TARGET_BASE/$SKILL_NAME"

info "源路径:   $SOURCE_PATH"
info "链接路径: $LINK_PATH"

# 创建目标目录
if [ ! -d "$TARGET_BASE" ]; then
    mkdir -p "$TARGET_BASE" || { error "无法创建目标目录: $TARGET_BASE"; exit 1; }
fi

# 检查是否已存在
if [ -e "$LINK_PATH" ] || [ -L "$LINK_PATH" ]; then
    warn "路径已存在: $LINK_PATH"
    warn "如需替换，请先手动删除"
    exit 1
fi

# 创建符号链接
src_win="$(cygpath -w "$SOURCE_PATH" 2>/dev/null || echo "$SOURCE_PATH" | sed 's|/|\\|g')"
link_win="$(cygpath -w "$LINK_PATH" 2>/dev/null || echo "$LINK_PATH" | sed 's|/|\\|g')"

info "正在创建目录联接..."
if powershell -Command "New-Item -ItemType Junction -Path '${link_win}' -Target '${src_win}'" >/dev/null 2>&1; then
    echo ""
    ok "链接创建成功!"
    echo -e "  ${CYAN}源路径:${NC}   $SOURCE_PATH"
    echo -e "  ${CYAN}链接路径:${NC} $LINK_PATH"
else
    echo ""
    error "创建目录联接失败"
    error "手动执行: cmd /c \"mklink /J ${link_win} ${src_win}\""
    exit 1
fi
