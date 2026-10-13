#!/usr/bin/env bash
# 맥 디바이스 랩 준비 — iOS 시뮬레이터(+ 선택 Android) 테스트용. 여러 번 돌려도 된다(있는 건 건너뜀).
#   bash lab/setup/mac.sh            # 점검 + Maestro + npm ci + 스모크 iOS 시뮬레이터 생성
#   bash lab/setup/mac.sh --runtimes # 카탈로그가 쓰는 iOS 18·17 런타임도 받기(각 수 GB, 오래 걸림)
# 문서: docs/26-DEVICE-LAB.md §2·§6
set -euo pipefail
cd "$(dirname "$0")/../.."

MAESTRO_VERSION=2.11.0
MAESTRO_SHA256=5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a

ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*"; exit 1; }

[[ "$(uname)" == Darwin ]] || die "맥에서만"
xcodebuild -version >/dev/null 2>&1 || die "Xcode 가 없다 — App Store 에서 Xcode 26 설치 후 'sudo xcodebuild -license accept'"
ok "$(xcodebuild -version | head -1)"
command -v node >/dev/null || die "Node 22+ 필요 (brew install node@22)"
ok "node $(node -v)"
command -v pod >/dev/null || warn "CocoaPods 없음 — lab build --platform ios 에 필요 (brew install cocoapods)"
command -v gh >/dev/null || warn "gh 없음 — lab fetch(CI 빌드 받기)에 필요 (brew install gh && gh auth login)"
if ! /usr/libexec/java_home -v 17+ >/dev/null 2>&1; then
  warn "JDK 17+ 없음 — Maestro 에 필요 (brew install --cask temurin)"
fi

# iOS 26 플랫폼(시뮬레이터 런타임)
if ! xcrun simctl list runtimes | grep -q "iOS 26"; then
  warn "iOS 26 런타임 없음 → 받는다"
  xcodebuild -downloadPlatform iOS
fi
ok "런타임: $(xcrun simctl list runtimes | grep -o 'iOS [0-9.]*' | tr '\n' ' ')"
if [[ "${1:-}" == "--runtimes" ]]; then
  for v in 18 17; do
    xcrun simctl list runtimes | grep -q "iOS $v\." && { ok "iOS $v 있음"; continue; }
    warn "iOS $v 런타임 받기 — Xcode › Settings › Components 에서 받는 것과 같다"
    xcodebuild -downloadPlatform iOS -buildVersion "$v" || warn "iOS $v 자동 받기 실패 — Xcode › Settings › Components 에서 직접"
  done
fi

# Maestro(해시 검증) — ~/maestro/bin
if ! command -v maestro >/dev/null && [[ ! -x "$HOME/maestro/bin/maestro" ]]; then
  curl -fsSL -o /tmp/maestro.zip "https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"
  echo "${MAESTRO_SHA256}  /tmp/maestro.zip" | shasum -a 256 -c -
  unzip -qo /tmp/maestro.zip -d "$HOME"
  ok "Maestro ${MAESTRO_VERSION} → ~/maestro/bin (PATH 에 추가: export PATH=\"\$HOME/maestro/bin:\$PATH\")"
fi
export PATH="$HOME/maestro/bin:$PATH"

npm ci --no-audit --no-fund >/dev/null
ok "npm ci (mobile-mcp 포함)"

node lab/lab.mjs doctor
node lab/lab.mjs create ios26-17pro,ios26-se3 || warn "일부 시뮬레이터 생성 실패 — doctor 의 iosCatalog ✗ 항목 확인"
ok "준비 끝. 다음: lab fetch poptale-v2-dev (또는 lab build poptale-v2-dev --platform ios) → lab up ios26-17pro → docs/26 §6"
