use std::{
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
};

use serde::Serialize;
use tauri::{
    webview::Color, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;
use url::Url;
use uuid::Uuid;

use crate::{
    desktop,
    download::DownloadManager,
    error::{AppError, AppResult},
    filtering::FilterManager,
    models::{
        AppInfo, DownloadItem, DownloadRequest, FilterScriptRules, FilterStatus, InspectResult,
        Settings, SettingsPatch,
    },
    process::BinaryResolver,
    secure,
    security::validate_user_path,
    settings, updates,
};

#[derive(Clone)]
pub struct RuntimeState {
    pub settings: Arc<Mutex<Settings>>,
    pub downloads: DownloadManager,
    pub filters: FilterManager,
    pub resolver: BinaryResolver,
    pub pending_player: Arc<Mutex<Option<PlayerPayload>>>,
    /// Secret bound to the WebView initialization bridge. Privileged
    /// commands require it in addition to the page's user gesture.
    pub bridge_token: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayerPayload {
    pub source: String,
    pub title: String,
}

impl RuntimeState {
    pub fn new(app: &tauri::App) -> AppResult<Self> {
        let loaded_settings = settings::load().unwrap_or_else(|error| {
            crate::logging::warn(format!(
                "could not load settings; using safe defaults: {error}"
            ));
            Settings::default()
        });
        let project = directories::ProjectDirs::from("com", "PlayRood", "Yood")
            .ok_or_else(|| AppError::Configuration("could not determine app directories".into()))?;
        let resolver = BinaryResolver::new(
            app.path().resource_dir().ok(),
            app.path().app_data_dir().ok(),
        );
        let filters = FilterManager::new(project.cache_dir().join("filters"))?;
        filters.set_tracking_protection(
            loaded_settings.tracking_protection || loaded_settings.aggressive_tracking_protection,
        );
        let settings = Arc::new(Mutex::new(loaded_settings));
        let downloads = DownloadManager::new(settings.clone(), resolver.clone())?;
        downloads.set_app_handle(app.handle().clone());
        Ok(Self {
            settings,
            downloads,
            filters,
            resolver,
            pending_player: Arc::new(Mutex::new(None)),
            bridge_token: Uuid::new_v4().simple().to_string(),
        })
    }
}

fn require_bridge_token(state: &RuntimeState, supplied: Option<&str>) -> AppResult<()> {
    let Some(supplied) = supplied else {
        return Err(AppError::PermissionDenied("user gesture required".into()));
    };
    let expected = state.bridge_token.as_bytes();
    let supplied = supplied.as_bytes();
    if expected.len() != supplied.len()
        || expected
            .iter()
            .zip(supplied)
            .fold(0u8, |difference, (left, right)| difference | (left ^ right))
            != 0
    {
        return Err(AppError::PermissionDenied(
            "invalid Yood UI capability".into(),
        ));
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_settings(state: State<'_, RuntimeState>) -> AppResult<Settings> {
    state
        .settings
        .lock()
        .map(|settings| {
            let mut public = settings.clone();
            public.download_directory = PathBuf::new();
            public.temp_directory = PathBuf::new();
            public.filter_list_urls.clear();
            public.filter_etags.clear();
            public
        })
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_settings_for_ui(
    state: State<'_, RuntimeState>,
    yood_bridge_token: Option<String>,
) -> AppResult<Settings> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_settings(
    state: State<'_, RuntimeState>,
    patch: SettingsPatch,
    yood_bridge_token: Option<String>,
) -> AppResult<Settings> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    let mut current = state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))?;
    settings::apply_patch(&mut current, patch)?;
    // Keep the native filter's policy synchronized with persisted settings.
    // Persisted settings are applied transactionally; wake the scheduler so a
    // concurrency change takes effect without waiting for the next download.
    state.filters.set_tracking_protection(
        current.tracking_protection || current.aggressive_tracking_protection,
    );
    crate::logging::set_level(&current.log_level);
    state.downloads.wake_scheduler();
    Ok(current.clone())
}

fn public_download_item(mut item: DownloadItem) -> DownloadItem {
    // Paths are needed by the native commands, not by a remote document.
    item.output_path = None;
    item.request.directory = None;
    item
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_downloads(state: State<'_, RuntimeState>) -> Vec<DownloadItem> {
    state
        .downloads
        .list()
        .into_iter()
        .map(public_download_item)
        .collect()
}

#[tauri::command(rename_all = "snake_case")]
pub fn enqueue_download(
    state: State<'_, RuntimeState>,
    request: DownloadRequest,
    yood_bridge_token: Option<String>,
) -> AppResult<DownloadItem> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    state.downloads.enqueue(request).map(public_download_item)
}

#[tauri::command(rename_all = "snake_case")]
pub fn pause_download(
    state: State<'_, RuntimeState>,
    id: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    state.downloads.pause(&id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn resume_download(
    state: State<'_, RuntimeState>,
    id: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    state.downloads.resume(&id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn cancel_download(
    state: State<'_, RuntimeState>,
    id: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    state.downloads.cancel(&id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn retry_download(
    state: State<'_, RuntimeState>,
    id: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    state.downloads.retry(&id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn remove_download(
    state: State<'_, RuntimeState>,
    id: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    state.downloads.remove(&id)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn inspect_url(state: State<'_, RuntimeState>, url: String) -> AppResult<InspectResult> {
    state.downloads.inspect(&url).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_app_info(state: State<'_, RuntimeState>) -> AppResult<AppInfo> {
    let filter = state
        .settings
        .lock()
        .map(|settings| state.filters.status(&settings))
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))?;
    let (mut ytdlp, mut ffmpeg) = tokio::join!(
        state.resolver.status("yt-dlp"),
        state.resolver.status("ffmpeg")
    );
    // The settings page only needs availability/version; do not disclose
    // absolute tool or cache paths to a remote YouTube document.
    ytdlp.path = None;
    ffmpeg.path = None;
    let mut filter = filter;
    filter.cache_path = None;
    filter.tracking_supported = crate::browser::is_webview_mode();
    if !filter.tracking_supported {
        filter.tracking_enabled = false;
    }
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        binaries: vec![ytdlp, ffmpeg],
        filter,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_filter_status(state: State<'_, RuntimeState>) -> AppResult<FilterStatus> {
    state
        .settings
        .lock()
        .map(|settings| {
            let mut status = state.filters.status(&settings);
            status.cache_path = None;
            status.tracking_supported = crate::browser::is_webview_mode();
            if !status.tracking_supported {
                status.tracking_enabled = false;
            }
            status
        })
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_filter_script_rules(
    state: State<'_, RuntimeState>,
    page_url: String,
    classes: Vec<String>,
    ids: Vec<String>,
) -> AppResult<FilterScriptRules> {
    // Async so the (potentially large) cosmetic matching over the full
    // EasyList-based engine never stalls the WebView's main thread on every
    // YouTube navigation. The frontend already awaits this as a promise.
    if classes.len() > 5_000 || ids.len() > 5_000 {
        return Err(AppError::InvalidInput(
            "too many cosmetic filter tokens".into(),
        ));
    }
    let filters = state.filters.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let parsed = Url::parse(&page_url)
            .map_err(|_| AppError::InvalidInput("invalid filter page URL".into()))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || page_url.len() > 16 * 1024
            || page_url.chars().any(char::is_control)
        {
            return Err(AppError::InvalidInput("invalid filter page URL".into()));
        }
        let classes = classes
            .into_iter()
            .filter(|value| is_safe_dom_token(value))
            .take(2_500)
            .collect::<Vec<_>>();
        let ids = ids
            .into_iter()
            .filter(|value| is_safe_dom_token(value))
            .take(2_500)
            .collect::<Vec<_>>();
        Ok(filters.script_rules(&page_url, &classes, &ids))
    })
    .await
    .map_err(|_| AppError::Internal("filter worker failed".into()))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn check_filter_request(
    state: State<'_, RuntimeState>,
    url: String,
    source_url: String,
    request_type: String,
) -> AppResult<bool> {
    // The page can fire these on almost every subresource. Keep the adblock
    // engine lookup off the async UI/runtime worker.
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        check_filter_request_sync(&runtime, &url, &source_url, &request_type)
    })
    .await
    .map_err(|_| AppError::Internal("filter worker failed".into()))?
}

fn check_filter_request_sync(
    state: &RuntimeState,
    url: &str,
    source_url: &str,
    request_type: &str,
) -> AppResult<bool> {
    if url.len() > 16 * 1024
        || source_url.len() > 16 * 1024
        || request_type.len() > 32
        || url.chars().any(|character| character.is_control())
        || source_url.chars().any(|character| character.is_control())
    {
        return Ok(false);
    }
    let parsed = match Url::parse(&url) {
        Ok(parsed) if matches!(parsed.scheme(), "http" | "https" | "ws" | "wss") => parsed,
        _ => return Ok(false),
    };
    if parsed.host_str().is_none() {
        return Ok(false);
    }
    Ok(state
        .filters
        .check_network_request(&url, &source_url, &request_type))
}

fn is_safe_dom_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .chars()
            .all(|character| !character.is_control() && !matches!(character, '{' | '}' | ';'))
}

#[tauri::command(rename_all = "snake_case")]
pub fn tracking_protection_enabled(state: State<'_, RuntimeState>) -> AppResult<bool> {
    // Report the policy actually installed in the active engine. Brave mode
    // uses Shields/extension rules and does not install the Rust filter, so it
    // must not claim that this toggle was applied.
    Ok(crate::browser::is_webview_mode() && state.filters.tracking_protection_enabled())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_system_appearance() -> String {
    // Desktop-theme lookup may invoke gsettings. Keep that blocking OS work
    // off Tauri's UI/event thread so a theme transition never stalls the view.
    tauri::async_runtime::spawn_blocking(detect_system_appearance)
        .await
        .unwrap_or_else(|_| "system".into())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_desktop_environment() -> String {
    desktop::detect().identifier().into()
}

fn detect_system_appearance() -> String {
    #[cfg(target_os = "linux")]
    {
        let executable = if std::path::Path::new("/usr/bin/gsettings").is_file() {
            "/usr/bin/gsettings"
        } else {
            "gsettings"
        };
        for key in ["color-scheme", "gtk-theme"] {
            let output = Command::new(executable)
                .args(["get", "org.gnome.desktop.interface", key])
                .output();
            if let Ok(output) = output {
                let value = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
                if value.contains("dark") || value.contains("prefer-dark") {
                    return "dark".into();
                }
                if value.contains("light") || value.contains("prefer-light") {
                    return "light".into();
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("reg.exe");
        cmd.args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "/v",
            "AppsUseLightTheme",
        ]);
        cmd.creation_flags(0x08000000);
        if let Ok(output) = cmd.output() {
            let value = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
            if value.contains("0x0") {
                return "dark".into();
            }
            if value.contains("0x1") {
                return "light".into();
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("defaults")
            .args(["read", "-g", "AppleInterfaceStyle"])
            .output()
        {
            if String::from_utf8_lossy(&output.stdout)
                .to_ascii_lowercase()
                .contains("dark")
            {
                return "dark".into();
            }
        }
    }
    // Let the WebView's prefers-color-scheme result decide when the native
    // desktop integration is unavailable or inconclusive.
    "system".into()
}

#[tauri::command(rename_all = "snake_case")]
pub async fn update_filter_lists(
    state: State<'_, RuntimeState>,
    yood_bridge_token: Option<String>,
) -> AppResult<FilterStatus> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    let mut candidate = state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))?
        .clone();
    let updated = state.filters.update_if_due(&mut candidate, true).await?;
    let mut current = state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))?;
    settings::merge_filter_state(&mut current, &candidate);
    settings::save(&current)?;
    let status_settings = current.clone();
    drop(current);
    if updated {
        crate::logging::info("filter lists updated manually");
    }
    let mut status = state.filters.status(&status_settings);
    status.cache_path = None;
    status.tracking_supported = crate::browser::is_webview_mode();
    if !status.tracking_supported {
        status.tracking_enabled = false;
    }
    Ok(status)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn update_ytdlp(
    state: State<'_, RuntimeState>,
    yood_bridge_token: Option<String>,
) -> AppResult<String> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    let version = updates::update_ytdlp(&state.resolver).await?;
    let mut settings = state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))?;
    settings::mark_ytdlp_updated(&mut settings)?;
    drop(settings);
    crate::logging::info(format!("yt-dlp updated to {version}"));
    Ok(version)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_account_hints(
    state: State<'_, RuntimeState>,
    yood_bridge_token: Option<String>,
) -> AppResult<Option<String>> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    // Keyring access talks to the Secret Service over D-Bus and can block;
    // keep it off the WebView thread like the other filter commands.
    tauri::async_runtime::spawn_blocking(secure::get_account_hints)
        .await
        .map_err(|_| AppError::Internal("secure storage worker failed".into()))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn set_account_hints(
    state: State<'_, RuntimeState>,
    value: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || secure::set_account_hints(&value))
        .await
        .map_err(|_| AppError::Internal("secure storage worker failed".into()))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn clear_account_hints(
    state: State<'_, RuntimeState>,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    tauri::async_runtime::spawn_blocking(secure::clear_account_hints)
        .await
        .map_err(|_| AppError::Internal("secure storage worker failed".into()))?
}

#[tauri::command(rename_all = "snake_case")]
pub fn open_download(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    id: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    let item = state
        .downloads
        .list()
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    let path = item
        .output_path
        .clone()
        .ok_or_else(|| AppError::NotFound("download has no output file".into()))?;
    let settings = state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))?
        .clone();
    let path = validate_item_path(&item, &path, &settings)?;
    open_path(&path, false)?;
    let _ = app;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn open_download_folder(
    state: State<'_, RuntimeState>,
    id: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    let item = state
        .downloads
        .list()
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    let path = item
        .output_path
        .clone()
        .ok_or_else(|| AppError::NotFound("download has no output file".into()))?;
    let settings = state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))?
        .clone();
    let path = validate_item_path(&item, &path, &settings)?;
    open_path(
        path.parent()
            .ok_or_else(|| AppError::InvalidInput("download has no parent folder".into()))?,
        false,
    )
}

#[tauri::command(rename_all = "snake_case")]
pub fn pick_folder(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    yood_bridge_token: Option<String>,
) -> AppResult<Option<String>> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    let folder = app.dialog().file().blocking_pick_folder();
    let Some(path) = folder.and_then(|path| path.into_path().ok()) else {
        return Ok(None);
    };
    crate::security::ensure_safe_output_dir(&path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command(rename_all = "snake_case")]
pub fn open_external(
    state: State<'_, RuntimeState>,
    url: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    let parsed =
        url::Url::parse(&url).map_err(|_| AppError::InvalidInput("invalid external URL".into()))?;
    let host = parsed
        .host_str()
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let allowed = host == "accounts.google.com"
        || host == "accounts.youtube.com"
        || host == "github.com"
        || host == "youtube.com"
        || host.ends_with(".youtube.com");
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !allowed
    {
        return Err(AppError::UnsupportedUrl(
            "external link is not on the Yood allow-list".into(),
        ));
    }
    open_path(PathBuf::from(parsed.as_str()).as_path(), true)
}

#[tauri::command(rename_all = "snake_case")]
pub fn open_native_player(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    id: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    let item = state
        .downloads
        .list()
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;
    let path = item.output_path.clone().ok_or_else(|| {
        AppError::NotFound("native player requires a completed local download".into())
    })?;
    let settings = state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))?
        .clone();
    let path = validate_item_path(&item, &path, &settings)?;
    let source = Url::from_file_path(path)
        .map(|url| url.to_string())
        .map_err(|_| AppError::InvalidInput("could not convert media path".into()))?;
    let payload = PlayerPayload {
        source,
        title: player_title(&item.title),
    };
    open_player_window(&app, &state, payload)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn open_native_player_url(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    url: String,
    title: String,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    if title.len() > 2048 || title.chars().any(char::is_control) {
        return Err(AppError::InvalidInput("invalid player title".into()));
    }
    let source = state.downloads.resolve_player_source(&url).await?;
    let payload = PlayerPayload {
        source,
        title: player_title(&title),
    };
    open_player_window(&app, &state, payload)
}

fn open_player_window(
    app: &AppHandle,
    state: &RuntimeState,
    payload: PlayerPayload,
) -> AppResult<()> {
    *state
        .pending_player
        .lock()
        .map_err(|_| AppError::Internal("player state lock poisoned".into()))? =
        Some(payload.clone());
    if let Some(window) = app.get_webview_window("native-player") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("player-load", &payload);
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "native-player", WebviewUrl::App("player.html".into()))
        .title("Yood Native Player")
        .inner_size(960.0, 600.0)
        .min_inner_size(480.0, 320.0)
        .decorations(!desktop::detect().prefers_borderless_window())
        .background_color(Color(15, 15, 15, 255))
        // Same minimal-browser policy as the main window: no DevTools.
        .devtools(false)
        .build()
        .map_err(|error| AppError::Internal(format!("could not create native player: {error}")))?;
    Ok(())
}

/// Live download queue with progress bars. Brave app mode has no web UI of
/// its own, so this window is how a download handed over through
/// `yood://download` becomes visible (progress, speed, ETA, errors).
#[tauri::command(rename_all = "snake_case")]
pub fn open_downloads(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    yood_bridge_token: Option<String>,
) -> AppResult<()> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    open_downloads_window(&app)
}

pub fn open_downloads_window(app: &AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("downloads") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "downloads", WebviewUrl::App("downloads.html".into()))
        .title("Yood Downloads")
        .inner_size(640.0, 480.0)
        .min_inner_size(420.0, 300.0)
        .decorations(!desktop::detect().prefers_borderless_window())
        .background_color(Color(15, 15, 15, 255))
        // Same minimal-browser policy as the main window: no DevTools.
        .devtools(false)
        .build()
        .map_err(|error| AppError::Internal(format!("could not open downloads: {error}")))?;
    Ok(())
}

fn validate_item_path(
    item: &DownloadItem,
    path: &std::path::Path,
    settings: &Settings,
) -> AppResult<PathBuf> {
    let mut roots = vec![
        settings.download_directory.clone(),
        settings.temp_directory.clone(),
    ];
    if let Some(directory) = &item.request.directory {
        roots.push(directory.clone());
    }
    let references = roots
        .iter()
        .map(std::path::PathBuf::as_path)
        .collect::<Vec<_>>();
    validate_user_path(path, &references)
}

fn player_title(title: &str) -> String {
    let title = title
        .chars()
        .filter(|character| !character.is_control())
        .take(512)
        .collect::<String>();
    if title.trim().is_empty() {
        "Yood Native Player".into()
    } else {
        title
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn take_player_source(
    state: State<'_, RuntimeState>,
    window: WebviewWindow,
) -> AppResult<Option<PlayerPayload>> {
    if window.label() != "native-player" {
        return Err(AppError::PermissionDenied(
            "player source is restricted to the native player window".into(),
        ));
    }
    state
        .pending_player
        .lock()
        .map(|mut payload| payload.take())
        .map_err(|_| AppError::Internal("player state lock poisoned".into()))
}

#[tauri::command(rename_all = "snake_case")]
pub fn resolve_media_path(
    state: State<'_, RuntimeState>,
    path: PathBuf,
    yood_bridge_token: Option<String>,
) -> AppResult<String> {
    require_bridge_token(&state, yood_bridge_token.as_deref())?;
    let settings = state
        .settings
        .lock()
        .map_err(|_| AppError::Internal("settings lock poisoned".into()))?
        .clone();
    let roots: [&std::path::Path; 2] = [
        settings.download_directory.as_path(),
        settings.temp_directory.as_path(),
    ];
    let safe = validate_user_path(&path, &roots)?;
    url::Url::from_file_path(safe)
        .map(|url| url.to_string())
        .map_err(|_| AppError::InvalidInput("could not convert media path".into()))
}

fn open_path(path: &std::path::Path, external_url: bool) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    if external_url {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("rundll32.exe");
        cmd.args(["url.dll,FileProtocolHandler", &path.to_string_lossy()]);
        cmd.creation_flags(0x08000000);
        cmd.spawn()
            .map_err(|error| AppError::Process(error.to_string()))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    if external_url {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| AppError::Process(error.to_string()))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    if external_url {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| AppError::Process(error.to_string()))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("explorer.exe");
        cmd.arg(path);
        cmd.creation_flags(0x08000000);
        cmd.spawn()
            .map_err(|error| AppError::Process(error.to_string()))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| AppError::Process(error.to_string()))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| AppError::Process(error.to_string()))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Ok(())
}
