#!/usr/bin/env bash
# Linux build script for Yood.
# Usage: ./scripts/build.sh [--bundle-brave] [--install] [--stage]
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
linux_root="$(cd "${script_dir}/.." && pwd)"
project_root="$(cd "${linux_root}/.." && pwd)"
if [[ "$(uname -m)" != "x86_64" ]]; then
    echo "Unsupported architecture: $(uname -m). Only x86_64 is supported." >&2
    exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then echo "Missing cargo"; exit 1; fi
if ! command -v node >/dev/null 2>&1; then echo "Missing node"; exit 1; fi
if ! cargo tauri --version >/dev/null 2>&1; then
    echo "Installing tauri-cli..."
    cargo install tauri-cli --locked
fi

stage_binaries() {
    set -euo pipefail
    project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    platform="${1:-linux-x86_64}"
    destination="${project_root}/src-tauri/binaries/${platform}"
    mkdir -p "${destination}"

    copy_tool() {
        local name="$1"
        local source_var="$2"
        local default_path
        default_path="$(command -v "${name}" 2>/dev/null || true)"
        local source="${!source_var:-${default_path}}"

        if [[ -z "${source}" || ! -f "${source}" ]]; then
            echo "Missing ${name}. Set ${source_var} to a real executable." >&2
            return 1
        fi

        if [[ -L "${source}" ]]; then
            source="$(readlink -f "${source}")"
        fi

        if [[ "${name}" == "yt-dlp" ]] && file -b "${source}" | grep -qiE 'python script|ascii text'; then
            if [[ -f "${destination}/${name}" ]] \
                && [[ -s "${destination}/${name}" ]] \
                && ! file -b "${destination}/${name}" | grep -qiE 'python script|ascii text|empty'; then
                echo "Reusing staged ${name} in ${destination} (already a standalone binary)."
                return
            fi

            if ! command -v curl >/dev/null 2>&1; then
                echo "${source} is a Python launcher, and curl is required to fetch the standalone yt-dlp binary." >&2
                return 1
            fi

            echo "The system yt-dlp is a Python launcher; fetching the official standalone binary (~40MB, may take a minute)."
            local tmpfile metadata expected actual
            tmpfile="$(mktemp "${destination}/.${name}.tmp.XXXXXX")"
            metadata="$(mktemp "${destination}/.${name}.metadata.XXXXXX")"
            trap 'rm -f "${tmpfile}" "${metadata}"' RETURN

            curl -L --fail --silent --show-error --max-filesize 67108864 --proto '=https' --tlsv1.2 \
                -H 'Accept: application/vnd.github+json' \
                "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest" \
                -o "${metadata}"

            expected="$(python3 - "${metadata}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    release = json.load(handle)
    for asset in release.get("assets", []):
        if asset.get("name") == "yt-dlp_linux":
            digest = str(asset.get("digest", ""))
            if digest.startswith("sha256:"):
                print(digest[7:])
                raise SystemExit(0)
raise SystemExit("yt-dlp_linux SHA-256 digest missing")
PY
)"

            if [[ -t 2 ]]; then
                curl -L --fail --progress-bar --max-filesize 67108864 --proto '=https' --tlsv1.2 \
                    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" \
                    -o "${tmpfile}"
            else
                curl -L --fail --silent --show-error --max-filesize 67108864 --proto '=https' --tlsv1.2 \
                    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" \
                    -o "${tmpfile}"
            fi

            actual="$(sha256sum "${tmpfile}" | awk '{print $1}')"
            if [[ "${actual}" != "${expected}" ]]; then
                echo "yt-dlp SHA-256 verification failed" >&2
                return 1
            fi

            chmod 0755 "${tmpfile}"
            mv -f "${tmpfile}" "${destination}/${name}"
            trap - RETURN
            rm -f "${metadata}"
            return
        fi

        install -m 0755 "${source}" "${destination}/${name}"
    }

    case "${platform}" in
        linux-x86_64)
            copy_tool yt-dlp YOOD_YTDLP_PATH
            copy_tool ffmpeg YOOD_FFMPEG_PATH
            ;;
        *)
            echo "Unsupported binary staging platform: ${platform} (this Linux build supports only linux-x86_64)" >&2
            return 2
            ;;
    esac

    echo "Staged real yt-dlp and FFmpeg binaries in ${destination}"
}

bundle_brave() {
    set -euo pipefail
    project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    platform="${1:-linux-x86_64}"
    version="${2:-${BRAVE_VERSION:-}}"
    destination="${project_root}/src-tauri/binaries/${platform}/brave"

    case "${platform}" in
        linux-x86_64) asset="brave-browser-{V}-linux-amd64.zip" ;;
        *)
            echo "Unsupported Brave platform: ${platform} (this Linux build supports only linux-x86_64)" >&2
            return 2
            ;;
    esac

    if [[ -z "${version}" ]]; then
        if ! command -v curl >/dev/null 2>&1; then
            echo "curl is required to resolve the latest Brave version (or pass one explicitly)." >&2
            return 1
        fi
        tag="$(curl -sIL --proto '=https' --tlsv1.2 --max-time 30 -o /dev/null -w "%{url_effective}" \
            "https://github.com/brave/brave-browser/releases/latest" || true)"
        version="${tag##*/v}"
        if ! [[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "Could not resolve latest Brave version (got: '${tag}'). Pass one explicitly, e.g.:" >&2
            echo "  ./scripts/fetch-brave.sh ${platform} 1.94.121" >&2
            return 1
        fi
    fi

    if [[ -f "${destination}/VERSION" ]] && [[ "$(cat "${destination}/VERSION")" == "${version}" ]]; then
        if [[ -x "${destination}/brave" ]]; then
            echo "Reusing staged Brave ${version} in ${destination}."
            return 0
        fi
    fi

    for tool in curl unzip sha256sum; do
        command -v "${tool}" >/dev/null 2>&1 || { echo "Missing required tool: ${tool}" >&2; exit 1; }
    done

    prune_brave_payload() {
        local dir="$1" target="$2"
        local removed=0 path
        if [[ -d "${dir}/locales" ]]; then
            while IFS= read -r -d '' path; do
                rm -f "${path}" && removed=$((removed + 1))
            done < <(find "${dir}/locales" -maxdepth 1 -name '*.pak' \
                ! -name 'en-US.pak' ! -name 'he.pak' -print0)
        fi
        if [[ -e "${dir}/chrome-management-service" ]]; then
            rm -f "${dir}/chrome-management-service" && removed=$((removed + 1))
        fi
        echo "Pruned ${removed} unneeded locale files (${target})."
    }

    file="${asset//\{V\}/${version}}"
    base="https://github.com/brave/brave-browser/releases/download/v${version}"
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "${tmpdir}"' EXIT

    echo "Fetching Brave ${version} for ${platform} (~200MB, one-time)..."
    if [[ -t 2 ]]; then
        curl -L --fail --max-filesize 268435456 --proto '=https' --tlsv1.2 --progress-bar --speed-time 30 --speed-limit 30000 \
            "${base}/${file}" -o "${tmpdir}/brave.zip"
        curl -sL --fail --max-filesize 268435456 --proto '=https' --tlsv1.2 --speed-time 30 --speed-limit 30000 \
            "${base}/${file}.sha256" -o "${tmpdir}/brave.zip.sha256"
    else
        curl -L --fail --max-filesize 268435456 --proto '=https' --tlsv1.2 --silent --show-error --speed-time 30 --speed-limit 30000 \
            "${base}/${file}" -o "${tmpdir}/brave.zip"
        curl -sL --fail --max-filesize 268435456 --proto '=https' --tlsv1.2 --silent --show-error --speed-time 30 --speed-limit 30000 \
            "${base}/${file}.sha256" -o "${tmpdir}/brave.zip.sha256"
    fi

    echo "Verifying checksum..."
    expected="$(awk '{print $1}' "${tmpdir}/brave.zip.sha256")"
    actual="$(sha256sum "${tmpdir}/brave.zip" | awk '{print $1}')"
    if [[ -z "${expected}" || "${expected}" != "${actual}" ]]; then
        echo "Checksum mismatch for Brave ${version}; refusing to extract." >&2
        return 1
    fi

    echo "Extracting to ${destination} ..."
    rm -rf "${destination}"
    mkdir -p "${destination}"
    unzip -q -o "${tmpdir}/brave.zip" -d "${destination}"

    if [[ ! -x "${destination}/brave" ]]; then
        inners=()
        while IFS= read -r entry; do inners+=("${entry}"); done < <(
            find "${destination}" -maxdepth 1 -mindepth 1 -type d
        )
        if [[ "${#inners[@]}" -eq 1 ]]; then
            mv "${inners[0]}"/* "${destination}/"
            rmdir "${inners[0]}"
        fi
    fi

    if [[ ! -x "${destination}/brave" ]]; then
        echo "Unexpected Brave zip layout (no brave binary)." >&2
        return 1
    fi

    prune_brave_payload "${destination}" "${platform}"
    echo "${version}" > "${destination}/VERSION"
    echo "Staged Brave ${version} in ${destination}."
}

install_app() {
    set -euo pipefail
    project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    bin_dir="${HOME}/.local/bin"
    app_dir="${HOME}/.local/share/yood"
    applications_dir="${HOME}/.local/share/applications"
    icons_dir="${HOME}/.local/share/icons/hicolor/scalable/apps"
    source="${1:-}"

    if [[ -z "${source}" ]]; then
        candidate="${project_root}/src-tauri/target/release/yood"
        if [[ ! -f "${candidate}" ]]; then
            echo "No binary given and no ${candidate} found. Build first:" >&2
            echo "  cargo tauri build --config src-tauri/tauri.conf.json" >&2
            return 1
        fi
        source="${candidate}"
    fi

    source="$(realpath "${source}")"
    if [[ ! -f "${source}" ]]; then
        echo "Installer source does not exist: ${source}" >&2
        return 1
    fi

    mkdir -p "${bin_dir}" "${app_dir}" "${applications_dir}" "${icons_dir}"
    install -m 0755 "${source}" "${app_dir}/yood"
    ln -sf "${app_dir}/yood" "${bin_dir}/yood"

    if [[ "${source}" != *.AppImage ]]; then
        if [[ -d "${project_root}/src-tauri/binaries/linux-x86_64" ]]; then
            mkdir -p "${app_dir}/binaries/linux-x86_64"
            for tool in yt-dlp ffmpeg; do
                if [[ -f "${project_root}/src-tauri/binaries/linux-x86_64/${tool}" ]]; then
                    install -m 0755 \
                        "${project_root}/src-tauri/binaries/linux-x86_64/${tool}" \
                        "${app_dir}/binaries/linux-x86_64/${tool}"
                fi
            done
        fi
    fi

    if [[ "${YOOD_SKIP_BRAVE:-0}" == "1" ]]; then
        rm -rf "${app_dir}/brave"
        echo "Skipping bundled Brave; installed Yood will require a system Brave only when selected." >&2
    else
        brave_src="${project_root}/src-tauri/binaries/linux-x86_64/brave/brave"
        if [[ ! -x "${brave_src}" ]]; then
            bundle_brave || true
        fi
        if [[ -x "${brave_src}" ]]; then
            rm -rf "${app_dir}/brave"
            cp -r "${project_root}/src-tauri/binaries/linux-x86_64/brave" "${app_dir}/brave"
        else
            echo "WARNING: no bundled Brave available; installed Yood will use a system Brave." >&2
        fi
    fi

    icon="${project_root}/src-tauri/icons/icon.svg"
    if [[ -f "${icon}" ]]; then
        install -m 0644 "${icon}" "${icons_dir}/yood.svg"
    fi

    if [[ -d "${project_root}/../shared/extension/yood" ]]; then
        mkdir -p "${app_dir}/extension"
        rm -rf "${app_dir}/extension/yood"
        cp -r "${project_root}/../shared/extension/yood" "${app_dir}/extension/yood"
        rm -rf "${app_dir}/extension/yood/_metadata"
        rm -f "${app_dir}/extension/yood/defaults.json"
    fi

    desktop_file="${applications_dir}/yood.desktop"
    cat > "${desktop_file}" <<EOF_DESKTOP
[Desktop Entry]
Type=Application
Name=Yood
Comment=Lightweight private YouTube desktop application
Exec=${app_dir}/yood %u
Icon=yood
Terminal=false
Categories=AudioVideo;Video;Network;
MimeType=x-scheme-handler/yood;
StartupWMClass=yood
EOF_DESKTOP
    chmod 0644 "${desktop_file}"

    if command -v xdg-mime >/dev/null 2>&1; then
        xdg-mime default yood.desktop x-scheme-handler/yood || true
    fi
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "${applications_dir}" || true
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -f -t "${HOME}/.local/share/icons" >/dev/null 2>&1 || true
    fi

    echo "Yood installed:"
    echo "  binary:  ${app_dir}/yood"
    echo "  launcher: ${desktop_file}"
    echo "  start with: ${bin_dir}/yood"
    echo
    echo "Remove with:"
    echo "  rm -f ${bin_dir}/yood ${desktop_file} ${icons_dir}/yood.svg && rm -rf ${app_dir}"
}

linux_stage() {
    set -euo pipefail
    build_dir="${project_root}/build"
    mkdir -p "${build_dir}"
    target="linux/src-tauri"
    version="$(python3 - "${project_root}/${target}/tauri.conf.json" <<'PY'
import json,sys
f=open(sys.argv[1],encoding='utf-8');print(json.loads(f.read()).get('version',''))
PY
)" || ""

    appimage_file="$(find "${project_root}/${target}/target/release/bundle/appimage" -maxdepth 1 -name "*.AppImage" -print -quit 2>/dev/null || true)"
    deb_file="$(find "${project_root}/${target}/target/release/bundle/deb" -maxdepth 1 -name "*.deb" -print -quit 2>/dev/null || true)"
    rpm_file="$(find "${project_root}/${target}/target/release/bundle/rpm" -maxdepth 1 -name "*.rpm" -print -quit 2>/dev/null || true)"
    yood_file="$(find "${project_root}/${target}/target/release" -maxdepth 1 -name "yood" -type f -print -quit 2>/dev/null || true)"

    stage_tag="x86_64"

    place() {
        local file="$1" kindtag="$2" ext="$3" inst="$4" suffix=""
        [[ -z "${file}" ]] && return
        [[ ! -e "${file}" ]] && return
        [[ "${inst}" == "1" ]] && suffix="_installing"
        if [[ "${ext}" == "runnable" ]]; then
            name="Yood_${version}_${stage_tag}"
        else
            name="Yood_${version}_${stage_tag}${suffix}.${ext}"
        fi
        rm -rf "${build_dir}/${name}"
        cp -r "${file}" "${build_dir}/${name}" || true
        echo "Staged ${file} as ${name}"
    }

    place "${appimage_file}" nativeapp appimage 1
    place "${yood_file}" yood runnable 0
    place "${deb_file}" deb deb 0
    place "${rpm_file}" rpm rpm 0

    echo "Linux artifacts staged."
}

BUNDLE_BRAVE=0
INSTALL=0
STAGE_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --bundle-brave) BUNDLE_BRAVE=1 ;;
        --install) INSTALL=1 ;;
        --stage) STAGE_ONLY=1 ;;
        --stage-only) STAGE_ONLY=1 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done

if [[ "$STAGE_ONLY" == "1" ]]; then
    _saved_project_root="$project_root"
    stage_binaries
    project_root="$_saved_project_root"
    exit 0
fi

_saved_project_root="$project_root"
stage_binaries
project_root="$_saved_project_root"

if [[ "$BUNDLE_BRAVE" == "1" || "${YOOD_BUNDLE_BRAVE:-0}" == "1" ]]; then
    _saved_project_root="$project_root"
    bundle_brave
    project_root="$_saved_project_root"
fi

pushd "${project_root}/shared/frontend" >/dev/null
npm install
npm run build
popd >/dev/null

pushd "${linux_root}/src-tauri" >/dev/null
bund_targets="deb rpm"
if command -v msquashfs >/dev/null 2>&1; then
    bund_targets="${bund_targets} appimage"
fi
cargo tauri build --bundles ${bund_targets}
popd >/dev/null

linux_stage

if [[ "$INSTALL" == "1" ]]; then
    _saved_project_root="$project_root"
    install_app
    project_root="$_saved_project_root"
fi

echo
echo "DONE."
