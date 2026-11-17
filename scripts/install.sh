#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
TARGET="$SKILLS_DIR/cortes-eb"

command -v node >/dev/null || { echo "erro: instale o Node.js 22.12 ou mais novo" >&2; exit 1; }
command -v npm >/dev/null || { echo "erro: npm não encontrado" >&2; exit 1; }

cd "$ROOT"
npm ci
npm run build
npm ci --prefix web
npm run build --prefix web
npm link

mkdir -p "$SKILLS_DIR"
if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  echo "erro: $TARGET já existe e não é um link; remova manualmente" >&2
  exit 1
fi
ln -sfn "$ROOT/skill" "$TARGET"

echo "skill instalada em $TARGET"
cortes-eb doctor
