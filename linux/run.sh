#!/usr/bin/env bash
# Yood for Linux — run / compile helper.
# Usage: ./run.sh [command]
# With no arguments an interactive TUI menu opens.
#
#   menu           Open interactive TUI menu (default, no args)
#   dev            Run in development mode (frontend build + cargo tauri dev)
#   run            Run the already-built release binary (no compilation)
#   build          Alias for build-linux
#   build-linux    Compile for Linux (TUI: Arch/Debian/Fedora, Space=select, Enter=build)
#   build-linux-run Build for Linux, then run the release binary
#   brave          Launch the canonical Yood backend in Brave engine mode
#   webview        Launch the canonical Yood backend in lightweight WebView mode
#   check          Type-check frontend + cargo check (no bundle)
#   test           Run Rust unit tests
#   self-test      Run `yood --self-test` (no WebView needed)
#   install        Per-user install (app icon, yood:// handler, Brave bundle)
#   clean          Remove build artifacts
#   help           Show this help
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${project_root}"

info() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

webkit_warning() {
  printf '%s\n' "WARNING: the Tauri/WebKit engine segfaults on YouTube player pages" \
    "(upstream WebKitGTK bug, proven by bisection). For stable watching use:" \
    "  ./run.sh brave" >&2
}

ensure_frontend() {
  if [[ ! -d ../shared/frontend/node_modules ]]; then
    info "Installing frontend dependencies (npm install)..."
    npm install --prefix ../shared/frontend
  fi
  info "Building frontend (tsc)..."
  npm run build --prefix ../shared/frontend
}

cmd_dev() {
  ensure_frontend
  webkit_warning
  info "Starting Yood in dev mode..."
  exec cargo tauri dev --config src-tauri/tauri.conf.json "$@"
}

cmd_run() {
  local bin_release="src-tauri/target/release/yood"
  local bin_debug="src-tauri/target/debug/yood"
  if [[ -f "${bin_release}" ]]; then
    webkit_warning
    info "Running ${bin_release} ..."
    exec "${bin_release}" "$@"
  elif [[ -f "${bin_debug}" ]]; then
    webkit_warning
    info "No release binary — running ${bin_debug} ..."
    exec "${bin_debug}" "$@"
  else
    printf 'ERROR: No built binary found. Run dev or build-linux first.\n' >&2
    return 1
  fi
}

cmd_webview() {
  local canonical_bin=""
  for candidate in src-tauri/target/release/yood src-tauri/target/debug/yood; do
    if [[ -x "${candidate}" ]]; then canonical_bin="${candidate}"; break; fi
  done
  [[ -n "${canonical_bin}" ]] || die "Build Yood first with './run.sh build-linux' or 'cargo tauri build'."
  webkit_warning
  YOOD_ENGINE=webview exec "${canonical_bin}" "$@"
}

pick_build_targets() {
  # Prints internal targets (bin/deb/rpm/appimage), one per line.
  # No args in a terminal opens a checklist: Space toggles, Enter starts.
  # NOTE: stdout is captured via $(...) by the caller, so test stderr (-t 2),
  # not stdout (-t 1), for "interactive terminal".
  if [[ $# -eq 0 && -t 0 && -t 2 ]]; then
    if command -v whiptail >/dev/null 2>&1; then
      local choice
      choice=$(whiptail --title "Yood build for Linux" --checklist \
        "Space = select, Enter = start build (Esc cancels):" 15 60 3 \
        "arch" "Arch pacman package (.pkg.tar.zst)" OFF \
        "debian" "Debian (.deb)" OFF \
        "fedora" "Fedora (.rpm)" OFF \
        3>&1 1>&2 2>&3) || return 1
      # shellcheck disable=SC2206
      local picked=(${choice//\"/}) mapped=() p
      for p in "${picked[@]}"; do
        case "${p}" in
          arch) mapped+=(arch) ;;
          debian) mapped+=(deb) ;;
          fedora) mapped+=(rpm) ;;
          *) mapped+=("${p}") ;;
        esac
      done
      [[ "${#mapped[@]}" -gt 0 ]] || return 1
      printf '%s\n' "${mapped[@]}"
      return 0
    fi
    echo "Choose build targets (e.g. '1 2', empty cancels, Esc/Ctrl-C cancels):" >&2
    echo "  1) Arch    (pacman package, .pkg.tar.zst)" >&2
    echo "  2) Debian  (.deb)" >&2
    echo "  3) Fedora  (.rpm)" >&2
    local answer names=(bin deb rpm) n picked=()
    read -r -p "> " answer || return 1
    for n in ${answer}; do
      if [[ "${n}" =~ ^[1-3]$ ]]; then picked+=("${names[$((n-1))]}"); fi
    done
    [[ "${#picked[@]}" -gt 0 ]] || return 1
    printf '%s\n' "${picked[@]}"
    return 0
  fi
  if [[ $# -eq 0 ]]; then
    printf '%s\n' bin deb rpm
    return 0
  fi
  printf '%s\n' "$@"
}

cmd_build_linux() {
  ensure_frontend
  local targets=() passthrough=() seen_sep=false arg
  for arg in "$@"; do
    if ! $seen_sep && [[ "${arg}" == "--" ]]; then seen_sep=true; continue; fi
    if ! $seen_sep && [[ "${arg}" == "all" || "${arg}" == "--all" ]]; then
      targets+=(bin deb rpm); continue
    fi
    case "${arg}" in
      arch) if ! $seen_sep; then targets+=(arch); continue; fi ;;
      debian) if ! $seen_sep; then targets+=(deb); continue; fi ;;
      fedora) if ! $seen_sep; then targets+=(rpm); continue; fi ;;
    esac
    if ! $seen_sep && [[ "${arg}" =~ ^(bin|appimage|deb|rpm)$ ]]; then
      targets+=("${arg}"); continue
    fi
    passthrough+=("${arg}")
  done
  if [[ "${#targets[@]}" -eq 0 ]]; then
    local picked
    picked="$(pick_build_targets)" || { info "Build cancelled."; return 1; }
    while IFS= read -r line; do targets+=("${line}"); done <<< "${picked}"
  fi
  # AppImage needs mksquashfs; drop it with an explanation instead of failing.
  local kept=() t
  for t in "${targets[@]}"; do
    if [[ "${t}" == "appimage" ]] && ! command -v mksquashfs >/dev/null 2>&1; then
      info "NOTE: skipping AppImage (mksquashfs not found — sudo pacman -S --needed squashfs-tools)."
    else
      kept+=("${t}")
    fi
  done
  targets=("${kept[@]}")
  if [[ "${#targets[@]}" -eq 0 ]]; then
    info "Nothing left to build — falling back to a runnable binary."
    targets=(bin)
  fi
  info "Staging Linux binaries (yt-dlp, ffmpeg)..."
  ./scripts/prepare-binaries.sh linux-x86_64
  info "Building Yood for Linux (this takes a while)..."
  local bundles=() want_arch=false want_bin=false
  for t in "${targets[@]}"; do
    case "${t}" in
      bin) want_bin=true ;;
      arch) want_arch=true; want_bin=true ;; # the pacman package wraps the raw binary
      *) bundles+=("${t}") ;;
    esac
  done
  if [[ "${#bundles[@]}" -eq 0 ]]; then
    cargo tauri build --config src-tauri/tauri.conf.json --no-bundle "${passthrough[@]}"
  else
    local csv
    csv="$(IFS=,; echo "${bundles[*]}")"
    # A bundle build also emits target/release/yood, so `arch`/`bin`
    # need no extra pass when built alongside other bundles.
    cargo tauri build --config src-tauri/tauri.conf.json --bundles "${csv}" "${passthrough[@]}"
  fi
  if $want_arch; then
    ./scripts/package-arch.sh
  fi
  info "Done."
  info "  runnable binary: src-tauri/target/release/yood"
  info "  bundles are in src-tauri/target/release/bundle/ (if any were built)"
  if $want_arch; then
    info "  Arch package: src-tauri/target/release/bundle/arch/*.pkg.tar.zst"
    info "  install it with: sudo pacman -U src-tauri/target/release/bundle/arch/*.pkg.tar.zst"
  fi
  info "  install with: ./run.sh install   |   run it with: ./run.sh build-linux-run"
}

cmd_build_linux_run() {
  # Args before `--` go to the build, args after go to the binary:
  #   ./run.sh build-linux-run -- https://www.youtube.com/watch?v=...
  local build_args=() run_args=() seen_sep=false arg
  for arg in "$@"; do
    if ! $seen_sep && [[ "${arg}" == "--" ]]; then seen_sep=true; continue; fi
    if $seen_sep; then run_args+=("${arg}"); else build_args+=("${arg}"); fi
  done
  cmd_build_linux "${build_args[@]}"
  local bin="src-tauri/target/release/yood"
  [[ -f "${bin}" ]] || die "Build finished but ${bin} not found."
  webkit_warning
  info "Build finished — launching ${bin} ..."
  exec "${bin}" "${run_args[@]}"
}

cmd_brave() {
  # Compatibility command: always use the canonical Yood backend. This keeps
  # the download queue, localhost bridge, settings, deep links, and
  # single-instance handling in one process.
  local canonical_bin=""
  for candidate in src-tauri/target/release/yood src-tauri/target/debug/yood; do
    if [[ -x "${candidate}" ]]; then
      canonical_bin="${candidate}"
      break
    fi
  done
  [[ -n "${canonical_bin}" ]] || die "Build Yood first with './run.sh build-linux' or 'cargo tauri build'."
  info "Starting the canonical Yood backend in Brave mode..."
  YOOD_ENGINE=brave exec "${canonical_bin}" "$@"
}

cmd_check() {
  ensure_frontend
  cargo check --manifest-path src-tauri/Cargo.toml "$@"
  info "Check OK."
}

cmd_test() {
  ensure_frontend
  cargo test --manifest-path src-tauri/Cargo.toml "$@"
}

cmd_self_test() {
  ensure_frontend
  cargo run --manifest-path src-tauri/Cargo.toml -- --self-test "$@"
}

cmd_clean() {
  info "Cleaning frontend dist + Rust target..."
  rm -f ../shared/frontend/dist/bootstrap.js ../shared/frontend/dist/injection.js ../shared/frontend/dist/player.js ../shared/frontend/dist/downloads.js ../shared/frontend/dist/downloads.html
  cargo clean --manifest-path src-tauri/Cargo.toml
  info "Clean done."
}

cmd_install() {
  # Per-user install: double-clickable app, no terminal needed afterwards.
  # Uses the AppImage when the bundle step produced one, else the raw binary
  # (install.sh then bundles Brave + extension + registers yood://).
  # A system-wide alternative on Arch: sudo pacman -U the package below.
  local pkgs=(src-tauri/target/release/bundle/arch/yood-*-x86_64.pkg.tar.zst)
  if [[ "${pkgs[0]}" != *"*"* && -f "${pkgs[0]}" ]]; then
    info "Arch package available: ${pkgs[0]}"
    info "System-wide install (needs sudo): sudo pacman -U \"${pkgs[0]}\""
  fi
  local appimages=(src-tauri/target/release/bundle/appimage/yood_*_amd64.AppImage)
  if [[ "${appimages[0]}" != *"*"* && -f "${appimages[0]}" ]]; then
    exec ./scripts/install.sh "${appimages[0]}" "$@"
  elif [[ -f src-tauri/target/release/yood ]]; then
    exec ./scripts/install.sh src-tauri/target/release/yood "$@"
  else
    die "Nothing to install. Run './run.sh build-linux' first."
  fi
}

cmd_menu() {
  while true; do
    local choice=""
    if command -v whiptail >/dev/null 2>&1 && [[ -t 0 && -t 1 ]]; then
      choice=$(whiptail --title "Yood (Linux)" --menu "Recommended: brave (stable). Tauri/WebView options are diagnostic on Linux:" 24 78 14 \
        "brave" "RECOMMENDED: canonical backend with Brave engine (stable)" \
        "webview" "Lightweight Tauri WebView engine (diagnostic on Linux)" \
        "dev" "Tauri dev (UNSTABLE: crashes on videos)" \
        "run" "Tauri binary (UNSTABLE: crashes on videos)" \
        "build-linux" "Compile Tauri for Linux" \
        "build-linux-run" "Build Tauri, then run it (UNSTABLE)" \
        "check" "Type-check (tsc + cargo check)" \
        "test" "Rust unit tests" \
        "self-test" "yood --self-test (no WebView)" \
        "install" "Per-user install (no terminal needed after)" \
        "clean" "Remove build artifacts" \
        "quit" "Quit" \
        3>&1 1>&2 2>&3) || break
    else
      [[ -t 0 ]] || { cmd_help; return 0; }
      echo "== Yood Linux (recommended: brave — Tauri/WebView is diagnostic on Linux) =="
      local options=(brave webview dev run build-linux build-linux-run check test self-test install clean quit)
      select choice in "${options[@]}"; do
        [[ -n "${choice:-}" ]] || { echo "Invalid choice, try again."; continue 2; }
        break
      done
    fi
    case "${choice}" in
      # dev/run replace this process via exec and never return here.
      dev) cmd_dev ;;
      run) cmd_run || true ;;
      build-linux|build) cmd_build_linux || true ;;
      build-linux-run) cmd_build_linux_run || true ;;
      brave) cmd_brave || true ;;
      webview) cmd_webview || true ;;
      check) cmd_check || true ;;
      test) cmd_test || true ;;
      self-test|selftest) cmd_self_test || true ;;
      install) cmd_install || true ;;
      clean) cmd_clean || true ;;
      quit|exit|q) break ;;
      *) echo "Unknown choice: ${choice}" ;;
    esac
    printf '\nDone. Press Enter to return to the menu...'
    read -r _ || break
  done
}

cmd_help() {
  sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
  echo
  echo "Examples:"
  echo "  ./run.sh                # open interactive TUI menu"
  echo "  ./run.sh brave          # canonical backend with Brave engine (stable on Linux)"
  echo "  ./run.sh webview        # canonical backend with lightweight WebView engine"
  echo "  ./run.sh dev            # Tauri/WebKit build (currently crashes on watch)"
  echo "  ./run.sh build-linux-run  # compile for Linux and run it"
  echo "  ./run.sh build-linux    # compile for Linux"
}

cmd="${1:-menu}"
shift || true
case "${cmd}" in
  menu|tui) cmd_menu ;;
  dev) cmd_dev "$@" ;;
  run) cmd_run "$@" ;;
  build|build-linux) cmd_build_linux "$@" ;;
  build-linux-run) cmd_build_linux_run "$@" ;;
  brave) cmd_brave "$@" ;;
  webview) cmd_webview "$@" ;;
  check) cmd_check "$@" ;;
  test) cmd_test "$@" ;;
  self-test|selftest) cmd_self_test "$@" ;;
  install) cmd_install "$@" ;;
  clean) cmd_clean "$@" ;;
  help|-h|--help) cmd_help ;;
  *) die "Unknown command '${cmd}'. Run './run.sh help'." ;;
esac
