use std::{
    collections::{HashMap, HashSet},
    fs,
    fs::OpenOptions,
    io::{BufRead, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use chrono::Utc;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Child,
    sync::{mpsc, Notify},
    time::sleep,
};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    logging,
    models::{
        DownloadItem, DownloadMode, DownloadRequest, DownloadStatus, InspectResult, Settings,
        VideoEntry,
    },
    process::{self, BinaryResolver},
    security::{ensure_safe_output_dir, sanitize_filename, validate_youtube_url},
};

const MAX_HISTORY: usize = 1000;
const MAX_HISTORY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_LOCAL_HEADER_BYTES: usize = 16 * 1024;
const MAX_LOCAL_BODY_BYTES: usize = 32 * 1024;
const LOCAL_TOKEN_HEADER: &str = "x-yood-token";
const MAX_PROCESS_LINE_BYTES: usize = 64 * 1024;
const MAX_PROCESS_STDERR_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct DownloadManager {
    items: Arc<Mutex<Vec<DownloadItem>>>,
    controls: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    active: Arc<AtomicUsize>,
    scheduler_started: Arc<AtomicBool>,
    notify: Arc<Notify>,
    settings: Arc<Mutex<Settings>>,
    resolver: BinaryResolver,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    history_path: PathBuf,
    notified: Arc<Mutex<HashSet<String>>>,
    progress_port: Arc<Mutex<Option<u16>>>,
    progress_token: Arc<Mutex<Option<String>>>,
    progress_stop: Arc<AtomicBool>,
    save_lock: Arc<Mutex<()>>,
}

enum RunOutcome {
    Completed(PathBuf),
    Paused,
    Cancelled,
    Failed(AppError),
}

type Progress = (f32, Option<String>, Option<String>, Option<u64>);

impl DownloadManager {
    pub fn new(settings: Arc<Mutex<Settings>>, resolver: BinaryResolver) -> AppResult<Self> {
        let history_path = directories::ProjectDirs::from("com", "PlayRood", "Yood")
            .map(|dirs| dirs.data_dir().join("downloads.json"))
            .ok_or_else(|| AppError::Configuration("could not determine data directory".into()))?;
        let items = load_history(&history_path).unwrap_or_else(|error| {
            logging::warn(format!(
                "could not load download history; starting empty: {error}"
            ));
            Vec::new()
        });
        Ok(Self {
            items: Arc::new(Mutex::new(items)),
            controls: Arc::new(Mutex::new(HashMap::new())),
            active: Arc::new(AtomicUsize::new(0)),
            scheduler_started: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
            settings,
            resolver,
            app_handle: Arc::new(Mutex::new(None)),
            history_path,
            notified: Arc::new(Mutex::new(HashSet::new())),
            progress_port: Arc::new(Mutex::new(None)),
            progress_token: Arc::new(Mutex::new(None)),
            progress_stop: Arc::new(AtomicBool::new(false)),
            save_lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        if let Ok(mut app) = self.app_handle.lock() {
            *app = Some(handle);
        }
    }

    pub fn wake_scheduler(&self) {
        self.notify.notify_one();
    }

    pub fn list(&self) -> Vec<DownloadItem> {
        let mut result = self
            .items
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default();
        result.sort_by_key(|item| std::cmp::Reverse(item.created_at));
        result
    }

    pub fn enqueue(&self, mut request: DownloadRequest) -> AppResult<DownloadItem> {
        let url = validate_youtube_url(&request.url)?;
        request.url = url.to_string();
        validate_request(&request)?;
        let mut items = self
            .items
            .lock()
            .map_err(|_| AppError::Internal("download state lock poisoned".into()))?;
        if let Some(request_id) = &request.request_id {
            if let Some(existing) = items
                .iter()
                .find(|item| item.request.request_id.as_deref() == Some(request_id))
            {
                return Ok(existing.clone());
            }
        }
        let id = Uuid::new_v4().to_string();
        let item = DownloadItem {
            id: id.clone(),
            request,
            title: "Queued download".into(),
            channel: String::new(),
            thumbnail: None,
            output_path: None,
            status: DownloadStatus::Queued,
            progress: 0.0,
            speed: None,
            eta: None,
            total_bytes: None,
            downloaded_bytes: None,
            error: None,
            created_at: Utc::now(),
            completed_at: None,
        };
        items.push(item.clone());
        drop(items);
        self.trim_and_save()?;
        // Let an already-open download manager pick up the new queue entry
        // immediately instead of only appearing once it starts downloading.
        self.emit_item(&item);
        self.notify.notify_one();
        self.ensure_scheduler();
        Ok(item)
    }

    pub fn pause(&self, id: &str) -> AppResult<()> {
        let item = self.item(id)?;
        if !matches!(
            item.status,
            DownloadStatus::Downloading | DownloadStatus::Queued
        ) {
            return Err(AppError::InvalidInput(
                "download cannot be paused in its current state".into(),
            ));
        }
        if let Some(control) = self
            .controls
            .lock()
            .map_err(|_| AppError::Internal("download control lock poisoned".into()))?
            .get(id)
        {
            control.store(true, Ordering::SeqCst);
        }
        self.set_status(id, DownloadStatus::Paused, None)?;
        self.notify.notify_one();
        Ok(())
    }

    pub fn resume(&self, id: &str) -> AppResult<()> {
        let item = self.item(id)?;
        if !matches!(
            item.status,
            DownloadStatus::Paused | DownloadStatus::Interrupted
        ) {
            return Err(AppError::InvalidInput(
                "download is not paused or interrupted".into(),
            ));
        }
        self.set_status(id, DownloadStatus::Queued, None)?;
        self.notify.notify_one();
        self.ensure_scheduler();
        Ok(())
    }

    pub fn cancel(&self, id: &str) -> AppResult<()> {
        let item = self.item(id)?;
        if matches!(
            item.status,
            DownloadStatus::Completed | DownloadStatus::Cancelled
        ) {
            return Err(AppError::InvalidInput(
                "download is already finished".into(),
            ));
        }
        if let Some(control) = self
            .controls
            .lock()
            .map_err(|_| AppError::Internal("download control lock poisoned".into()))?
            .get(id)
        {
            control.store(true, Ordering::SeqCst);
        }
        self.set_status(id, DownloadStatus::Cancelled, None)?;
        self.notify.notify_one();
        Ok(())
    }

    pub fn retry(&self, id: &str) -> AppResult<()> {
        let item = self.item(id)?;
        if !matches!(
            item.status,
            DownloadStatus::Failed | DownloadStatus::Cancelled
        ) {
            return Err(AppError::InvalidInput(
                "only failed or cancelled downloads can be retried".into(),
            ));
        }
        self.set_status(id, DownloadStatus::Queued, None)?;
        self.notify.notify_one();
        self.ensure_scheduler();
        Ok(())
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let mut items = self
            .items
            .lock()
            .map_err(|_| AppError::Internal("download state lock poisoned".into()))?;
        let index = items
            .iter()
            .position(|item| item.id == id)
            .ok_or_else(|| AppError::NotFound(id.into()))?;
        if matches!(
            items[index].status,
            DownloadStatus::Downloading | DownloadStatus::Queued | DownloadStatus::Paused
        ) {
            return Err(AppError::InvalidInput(
                "active downloads must be cancelled first".into(),
            ));
        }
        items.remove(index);
        drop(items);
        self.trim_and_save()
    }

    pub async fn shutdown_async(&self) {
        self.shutdown_progress();
        if let Ok(controls) = self.controls.lock() {
            for control in controls.values() {
                control.store(true, Ordering::SeqCst);
            }
        }
        for _ in 0..24 {
            if self.active.load(Ordering::SeqCst) == 0 {
                break;
            }
            sleep(Duration::from_millis(250)).await;
        }
        let _ = self.save();
    }

    pub async fn inspect(&self, raw_url: &str) -> AppResult<InspectResult> {
        let url = validate_youtube_url(raw_url)?;
        let (yt_dlp, _) = self.resolver.resolve("yt-dlp")?;
        let args = vec![
            "--ignore-config".into(),
            "--no-warnings".into(),
            "--dump-single-json".into(),
            "--skip-download".into(),
            "--flat-playlist".into(),
            url.to_string(),
        ];
        let command = process::command(&yt_dlp, &args)?;
        let (code, stdout, stderr) = process::capture(command, Duration::from_secs(45)).await?;
        if code != 0 {
            return Err(AppError::Process(safe_diagnostic(&stderr)));
        }
        if stdout.len() > 16 * 1024 * 1024 {
            return Err(AppError::Process("yt-dlp metadata was too large".into()));
        }
        parse_inspect(&stdout)
    }

    pub async fn resolve_player_source(&self, raw_url: &str) -> AppResult<String> {
        let url = validate_youtube_url(raw_url)?;
        let (yt_dlp, _) = self.resolver.resolve("yt-dlp")?;
        // A progressive stream lets the lightweight HTML media element play
        // immediately without opening a second heavyweight YouTube WebView.
        // yt-dlp performs URL extraction; Yood never handles account
        // credentials or constructs a shell command.
        let args = vec![
            "--ignore-config".into(),
            "--no-warnings".into(),
            "--no-playlist".into(),
            "--format".into(),
            "best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]".into(),
            "--get-url".into(),
            url.to_string(),
        ];
        let command = process::command(&yt_dlp, &args)?;
        let (code, stdout, stderr) = process::capture(command, Duration::from_secs(45)).await?;
        if code != 0 {
            return Err(AppError::Process(safe_diagnostic(&stderr)));
        }
        parse_player_source(&stdout)
    }

    fn ensure_scheduler(&self) {
        if self.scheduler_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            manager.scheduler_loop().await;
        });
    }

    async fn scheduler_loop(self) {
        loop {
            let limit = self
                .settings
                .lock()
                .map(|settings| settings.max_concurrent_downloads as usize)
                .unwrap_or(1)
                .clamp(1, 4);
            while self.active.load(Ordering::SeqCst) < limit {
                let Some(id) = self.next_queued() else {
                    break;
                };
                self.active.fetch_add(1, Ordering::SeqCst);
                let manager = self.clone();
                tauri::async_runtime::spawn(async move {
                    manager.run(id).await;
                });
            }
            let has_queued = self
                .items
                .lock()
                .map(|items| {
                    items
                        .iter()
                        .any(|item| matches!(item.status, DownloadStatus::Queued))
                })
                .unwrap_or(false);
            if !has_queued && self.active.load(Ordering::SeqCst) == 0 {
                self.scheduler_started.store(false, Ordering::SeqCst);
                let still_queued = self
                    .items
                    .lock()
                    .map(|items| {
                        items
                            .iter()
                            .any(|item| matches!(item.status, DownloadStatus::Queued))
                    })
                    .unwrap_or(false);
                if still_queued && !self.scheduler_started.swap(true, Ordering::SeqCst) {
                    continue;
                }
                break;
            }
            self.notify.notified().await;
        }
    }

    fn next_queued(&self) -> Option<String> {
        let mut items = self.items.lock().ok()?;
        let item = items
            .iter_mut()
            .find(|item| matches!(item.status, DownloadStatus::Queued))?;
        item.status = DownloadStatus::Downloading;
        let result = item.id.clone();
        drop(items);
        if let Err(error) = self.save() {
            logging::warn(format!(
                "could not persist queued download {result}: {error}"
            ));
        }
        self.emit(result.as_str());
        Some(result)
    }

    async fn run(&self, id: String) {
        let control = Arc::new(AtomicBool::new(false));
        if let Ok(mut controls) = self.controls.lock() {
            controls.insert(id.clone(), control.clone());
        }
        let result = self.perform(&id, control).await;
        match result {
            RunOutcome::Completed(path) => {
                logging::info(format!("download {id} completed"));
                let _ = self.finish(&id, DownloadStatus::Completed, None, Some(path));
                self.cleanup_temporary(&id);
            }
            RunOutcome::Paused => {
                logging::info(format!("download {id} paused"));
                let _ = self.finish(&id, DownloadStatus::Paused, None, None);
            }
            RunOutcome::Cancelled => {
                logging::info(format!("download {id} cancelled"));
                let _ = self.finish(&id, DownloadStatus::Cancelled, None, None);
                self.cleanup_temporary(&id);
            }
            RunOutcome::Failed(error) => {
                let public_error = safe_diagnostic(&error.to_string());
                logging::error(format!("download {id} failed: {public_error}"));
                let _ = self.finish(&id, DownloadStatus::Failed, Some(public_error), None);
                self.cleanup_temporary(&id);
            }
        }
        if let Ok(mut controls) = self.controls.lock() {
            controls.remove(&id);
        }
        self.active.fetch_sub(1, Ordering::SeqCst);
        self.notify.notify_one();
    }

    async fn perform(&self, id: &str, control: Arc<AtomicBool>) -> RunOutcome {
        let item = match self.item(id) {
            Ok(item) => item,
            Err(error) => return RunOutcome::Failed(error),
        };
        if control.load(Ordering::SeqCst) {
            return RunOutcome::Cancelled;
        }
        let metadata = match self.inspect(&item.request.url).await {
            Ok(value) => value,
            Err(error) => return RunOutcome::Failed(error),
        };
        let title = metadata
            .title
            .clone()
            .unwrap_or_else(|| "YouTube download".into());
        let channel = metadata.channel.clone().unwrap_or_default();
        logging::info(format!("downloading {title}"));
        let _ = self.update_metadata(id, &metadata);
        let settings = match self.settings.lock() {
            Ok(settings) => settings.clone(),
            Err(_) => {
                return RunOutcome::Failed(AppError::Internal("settings lock poisoned".into()))
            }
        };
        let destination = item
            .request
            .directory
            .clone()
            .unwrap_or_else(|| settings.download_directory.clone());
        let temporary_root = settings.temp_directory.join(id);
        if let Err(error) = ensure_safe_output_dir(&destination)
            .and_then(|_| ensure_safe_output_dir(&settings.temp_directory))
            .and_then(|_| ensure_safe_output_dir(&temporary_root))
        {
            return RunOutcome::Failed(error);
        }
        let destination = match fs::canonicalize(&destination) {
            Ok(path) => path,
            Err(error) => return RunOutcome::Failed(error.into()),
        };
        let temporary_root = match fs::canonicalize(&temporary_root) {
            Ok(path) => path,
            Err(error) => return RunOutcome::Failed(error.into()),
        };
        if let Some(size) = metadata_size(&metadata) {
            let needed = size.saturating_add(size / 20);
            if let Some(free) = insufficient_disk_space(&destination, needed) {
                return RunOutcome::Failed(AppError::Storage(format!(
                    "not enough free disk space: need about {}, only {} free",
                    format_bytes(size),
                    format_bytes(free)
                )));
            }
        }
        let (yt_dlp, _) = match self.resolver.resolve("yt-dlp") {
            Ok(value) => value,
            Err(error) => return RunOutcome::Failed(error),
        };
        let mut args = match build_download_args(&item.request, &temporary_root, &settings) {
            Ok(args) => args,
            Err(error) => return RunOutcome::Failed(error),
        };
        if let Ok((ffmpeg, _)) = self.resolver.resolve("ffmpeg") {
            args.extend([
                "--ffmpeg-location".into(),
                ffmpeg.to_string_lossy().into_owned(),
            ]);
        }
        let command = match process::command(&yt_dlp, &args) {
            Ok(command) => command,
            Err(error) => return RunOutcome::Failed(error),
        };
        let process_result = match run_download_process(
            command,
            control.clone(),
            self.clone(),
            id.to_string(),
        )
        .await
        {
            Ok(result) => result,
            Err(error) => return RunOutcome::Failed(error),
        };
        match process_result {
            ProcessResult::Paused => RunOutcome::Paused,
            ProcessResult::Cancelled => RunOutcome::Cancelled,
            ProcessResult::Failed(error) => RunOutcome::Failed(error),
            ProcessResult::Completed => {
                let source = match locate_media(&temporary_root) {
                    Some(path) => path,
                    None => {
                        return RunOutcome::Failed(AppError::Process(
                            "yt-dlp completed without producing a media file".into(),
                        ))
                    }
                };
                let extension = match source.extension().and_then(|x| x.to_str()) {
                    Some(extension @ ("mp4" | "mkv" | "webm" | "m4a" | "mp3" | "ogg" | "opus")) => {
                        extension
                    }
                    _ => "bin",
                };
                let stem =
                    sanitize_filename(&format!("{} - {}", channel, title), "yood-download", 180);
                let target =
                    unique_target(&destination, &stem, extension, settings.overwrite_existing);
                if let Err(error) = move_media(&source, &target, settings.overwrite_existing) {
                    return RunOutcome::Failed(error);
                }
                if settings.cleanup_temp_files {
                    let _ = fs::remove_dir_all(&temporary_root);
                }
                RunOutcome::Completed(target)
            }
        }
    }

    fn cleanup_temporary(&self, id: &str) {
        let should_cleanup = self
            .settings
            .lock()
            .map(|settings| settings.cleanup_temp_files)
            .unwrap_or(true);
        if should_cleanup {
            if let Ok(settings) = self.settings.lock() {
                let temporary = settings.temp_directory.join(id);
                let _ = fs::remove_dir_all(temporary);
            }
        }
    }

    fn finish(
        &self,
        id: &str,
        status: DownloadStatus,
        error: Option<String>,
        output: Option<PathBuf>,
    ) -> AppResult<()> {
        let mut items = self
            .items
            .lock()
            .map_err(|_| AppError::Internal("download state lock poisoned".into()))?;
        let item = items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| AppError::NotFound(id.into()))?;
        item.status = status;
        item.error = error;
        item.output_path = output;
        if matches!(item.status, DownloadStatus::Completed) {
            item.progress = 100.0;
            item.completed_at = Some(Utc::now());
        }
        item.speed = None;
        item.eta = None;
        let snapshot = item.clone();
        drop(items);
        self.save()?;
        self.emit_item(&snapshot);
        Ok(())
    }

    fn update_metadata(&self, id: &str, metadata: &InspectResult) -> AppResult<()> {
        let mut items = self
            .items
            .lock()
            .map_err(|_| AppError::Internal("download state lock poisoned".into()))?;
        if let Some(item) = items.iter_mut().find(|item| item.id == id) {
            item.title = metadata
                .title
                .clone()
                .unwrap_or_else(|| "YouTube download".into());
            item.channel = metadata.channel.clone().unwrap_or_default();
            item.thumbnail = metadata.thumbnail.clone();
        }
        let snapshot = items.iter().find(|item| item.id == id).cloned();
        drop(items);
        self.save()?;
        if let Some(item) = snapshot {
            self.emit_item(&item);
        }
        Ok(())
    }

    fn set_status(&self, id: &str, status: DownloadStatus, error: Option<String>) -> AppResult<()> {
        let mut items = self
            .items
            .lock()
            .map_err(|_| AppError::Internal("download state lock poisoned".into()))?;
        let item = items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| AppError::NotFound(id.into()))?;
        item.status = status;
        item.error = error;
        let snapshot = item.clone();
        drop(items);
        self.save()?;
        self.emit_item(&snapshot);
        Ok(())
    }

    fn update_progress(
        &self,
        id: &str,
        progress: f32,
        speed: Option<String>,
        eta: Option<String>,
        bytes: Option<u64>,
    ) {
        if let Ok(mut items) = self.items.lock() {
            if let Some(item) = items.iter_mut().find(|item| item.id == id) {
                item.progress = progress.clamp(0.0, 100.0);
                item.speed = speed;
                item.eta = eta;
                item.downloaded_bytes = bytes;
                let snapshot = item.clone();
                drop(items);
                logging::trace(format!("download {id} progress {progress:.1}%"));
                self.emit_item(&snapshot);
            }
        }
    }

    fn item(&self, id: &str) -> AppResult<DownloadItem> {
        self.items
            .lock()
            .map_err(|_| AppError::Internal("download state lock poisoned".into()))?
            .iter()
            .find(|item| item.id == id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(id.into()))
    }
    fn trim_and_save(&self) -> AppResult<()> {
        if let Ok(mut items) = self.items.lock() {
            if items.len() > MAX_HISTORY {
                items.sort_by_key(|item| std::cmp::Reverse(item.created_at));
                items.truncate(MAX_HISTORY);
            }
        }
        self.save()
    }
    fn save(&self) -> AppResult<()> {
        let _save_guard = self
            .save_lock
            .lock()
            .map_err(|_| AppError::Internal("download save lock poisoned".into()))?;
        let items = self.list();
        if let Some(parent) = self.history_path.parent() {
            fs::create_dir_all(parent)?;
        }
        if let Ok(metadata) = fs::symlink_metadata(&self.history_path) {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(AppError::UnsafePath(
                    "download history target is unsafe".into(),
                ));
            }
        }
        let temporary = self.history_path.with_extension(format!(
            "tmp.{}.{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let result = (|| -> AppResult<()> {
            let data = serde_json::to_vec(&items)?;
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(&data)?;
            file.sync_all()?;
            drop(file);
            crate::settings::replace_file(&temporary, &self.history_path)?;
            #[cfg(unix)]
            if let Some(parent) = self.history_path.parent() {
                if let Ok(directory) = fs::File::open(parent) {
                    let _ = directory.sync_all();
                }
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
    fn emit(&self, id: &str) {
        if let Ok(item) = self.item(id) {
            self.emit_item(&item);
        }
    }
    pub fn progress_port(&self) -> Option<u16> {
        self.progress_port.lock().ok().and_then(|port| *port)
    }

    pub fn progress_token(&self) -> Option<String> {
        self.progress_token
            .lock()
            .ok()
            .and_then(|token| token.clone())
    }

    pub fn shutdown_progress(&self) {
        self.progress_stop.store(true, Ordering::SeqCst);
    }

    /// Authenticated loopback feed used by the Brave companion extension.
    /// The listener is deliberately opt-in: WebView mode does not need this
    /// extra network surface.
    pub fn serve_progress(&self) -> Option<u16> {
        let mut port_slot = self.progress_port.lock().ok()?;
        if let Some(port) = *port_slot {
            return Some(port);
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").ok()?;
        listener.set_nonblocking(true).ok()?;
        let port = listener.local_addr().ok()?.port();
        let token = Uuid::new_v4().simple().to_string();
        *self.progress_token.lock().ok()? = Some(token.clone());
        *port_slot = Some(port);
        drop(port_slot);

        let manager = self.clone();
        let stop = self.progress_stop.clone();
        let connections = Arc::new(AtomicUsize::new(0));
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if connections
                            .try_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                                (count < 16).then_some(count + 1)
                            })
                            .is_err()
                        {
                            continue;
                        }
                        let manager = manager.clone();
                        let token = token.clone();
                        let connections = connections.clone();
                        std::thread::spawn(move || {
                            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                            handle_progress_client(stream, &manager, &token);
                            connections.fetch_sub(1, Ordering::SeqCst);
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    Err(_) => break,
                }
            }
        });
        Some(port)
    }

    fn emit_item(&self, item: &DownloadItem) {
        if let Ok(handle) = self.app_handle.lock() {
            if let Some(handle) = handle.as_ref() {
                let public_item = redacted_download_item(item);
                let _ = handle.emit("download-updated", &public_item);
                self.notify_terminal_state(handle, item);
            }
        }
    }
}

fn redacted_download_item(item: &DownloadItem) -> DownloadItem {
    let mut public = item.clone();
    public.output_path = None;
    public.request.directory = None;
    public
}

/// JSON body for the folder picker response: the chosen folder, or null.
fn pick_folder_body(folder: Option<String>) -> String {
    serde_json::to_string(&serde_json::json!({ "path": folder }))
        .unwrap_or_else(|_| r#"{"path":null}"#.into())
}

#[derive(Debug, Default)]
struct LocalRequest {
    method: Option<String>,
    path: Option<String>,
    body: Option<String>,
    token: Option<String>,
    origin: Option<String>,
}

fn read_limited_line<R: BufRead>(reader: &mut R, limit: usize) -> Option<String> {
    let mut line = String::new();
    match reader.read_line(&mut line) {
        Ok(0) => None,
        Ok(_) if line.len() <= limit => Some(line),
        Ok(_) | Err(_) => None,
    }
}

fn read_request(stream: &std::net::TcpStream) -> Option<LocalRequest> {
    // One buffered reader for both headers and body prevents bytes buffered
    // past the header from being lost. Header count/size and body size are
    // bounded before any allocation proportional to client input.
    let mut reader = std::io::BufReader::new(stream);
    let head = read_limited_line(&mut reader, MAX_LOCAL_HEADER_BYTES)?;
    let mut parts = head.split_whitespace();
    let method = parts.next()?.to_ascii_uppercase();
    let raw_path = parts.next()?;
    if !raw_path.starts_with('/') {
        return None;
    }
    let path = raw_path.split('?').next().unwrap_or(raw_path).to_string();
    let mut content_length = 0usize;
    let mut saw_content_length = false;
    let mut header_bytes = head.len();
    let mut token = None;
    let mut origin = None;
    let mut terminated = false;
    for _ in 0..64 {
        let line = read_limited_line(&mut reader, MAX_LOCAL_HEADER_BYTES)?;
        header_bytes = header_bytes.saturating_add(line.len());
        if header_bytes > MAX_LOCAL_HEADER_BYTES {
            return None;
        }
        if line.trim().is_empty() {
            terminated = true;
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            return None;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        match name.as_str() {
            "content-length" => {
                if saw_content_length {
                    return None;
                }
                saw_content_length = true;
                content_length = value.parse().ok()?;
            }
            "transfer-encoding" => return None,
            LOCAL_TOKEN_HEADER => {
                if value.len() <= 256 {
                    token = Some(value.to_string());
                }
            }
            "origin" => {
                if value.len() <= 512 {
                    origin = Some(value.to_string());
                }
            }
            _ => {}
        }
    }
    if !terminated {
        return None;
    }
    if content_length > MAX_LOCAL_BODY_BYTES {
        return None;
    }
    let body = if content_length == 0 {
        String::new()
    } else {
        let mut bytes = vec![0u8; content_length];
        reader.read_exact(&mut bytes).ok()?;
        String::from_utf8(bytes).ok()?
    };
    Some(LocalRequest {
        method: Some(method),
        path: Some(path),
        body: Some(body),
        token,
        origin,
    })
}

fn token_matches(expected: &str, supplied: Option<&str>) -> bool {
    let Some(supplied) = supplied else {
        return false;
    };
    if expected.len() != supplied.len() {
        return false;
    }
    expected
        .bytes()
        .zip(supplied.bytes())
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn allowed_origin(origin: Option<&str>) -> Option<&str> {
    let origin = origin?;
    if origin.chars().any(char::is_control) {
        return None;
    }
    if origin.starts_with("chrome-extension://")
        || origin.starts_with("moz-extension://")
        || origin == "https://youtube.com"
        || origin == "https://www.youtube.com"
        || origin == "https://m.youtube.com"
        || origin == "https://music.youtube.com"
        || origin == "https://youtu.be"
        || origin == "https://youtube-nocookie.com"
        || origin == "https://www.youtube-nocookie.com"
    {
        Some(origin)
    } else {
        None
    }
}

fn public_download_item(item: &DownloadItem) -> serde_json::Value {
    serde_json::json!({
        "id": item.id,
        "title": item.title,
        "channel": item.channel,
        "thumbnail": item.thumbnail,
        "status": item.status,
        "progress": item.progress,
        "speed": item.speed,
        "eta": item.eta,
        "error": item.error,
        "created_at": item.created_at,
        "completed_at": item.completed_at,
    })
}

fn handle_progress_client(
    mut stream: std::net::TcpStream,
    manager: &DownloadManager,
    expected_token: &str,
) {
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let Some(request) = read_request(&stream) else {
        let body = r#"{"ok":false,"error":"invalid request"}"#;
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        );
        return;
    };
    let authorized = request.method.as_deref() == Some("OPTIONS")
        || token_matches(expected_token, request.token.as_deref());
    let (status, body) = if !authorized {
        (
            "403 Forbidden",
            r#"{"ok":false,"error":"unauthorized"}"#.to_string(),
        )
    } else if request.method.as_deref() == Some("OPTIONS") {
        ("200 OK", String::new())
    } else if request.method.as_deref() == Some("GET")
        && request.path.as_deref() == Some("/downloads")
    {
        let items = manager
            .list()
            .iter()
            .map(public_download_item)
            .collect::<Vec<_>>();
        match serde_json::to_string(&serde_json::json!({ "items": items })) {
            Ok(body) => ("200 OK", body),
            Err(_) => ("500 Internal Server Error", r#"{"ok":false}"#.into()),
        }
    } else if request.method.as_deref() == Some("GET")
        && request.path.as_deref() == Some("/defaults")
    {
        let directory = manager
            .settings
            .lock()
            .ok()
            .map(|settings| settings.download_directory.to_string_lossy().into_owned());
        match serde_json::to_string(&serde_json::json!({
            "download_directory": directory,
            "progress_port": manager.progress_port(),
        })) {
            Ok(body) => ("200 OK", body),
            Err(_) => ("500 Internal Server Error", r#"{"ok":false}"#.into()),
        }
    } else if request.method.as_deref() == Some("POST")
        && request.path.as_deref() == Some("/enqueue")
    {
        let outcome = match request
            .body
            .as_deref()
            .map(serde_json::from_str::<crate::models::DownloadRequest>)
        {
            Some(Ok(mut download)) => {
                if download.context.as_deref().unwrap_or("").is_empty() {
                    download.context = Some("extension".into());
                }
                match manager.enqueue(download) {
                    Ok(item) => (
                        "200 OK",
                        serde_json::json!({ "ok": true, "id": item.id }).to_string(),
                    ),
                    Err(error) => (
                        "200 OK",
                        serde_json::json!({
                            "ok": false,
                            "error": error.to_string().chars().take(512).collect::<String>(),
                        })
                        .to_string(),
                    ),
                }
            }
            _ => (
                "400 Bad Request",
                r#"{"ok":false,"error":"invalid request"}"#.into(),
            ),
        };
        outcome
    } else if request.method.as_deref() == Some("POST")
        && request.path.as_deref() == Some("/pick-folder")
    {
        logging::info("folder picker requested from extension");
        let folder = manager
            .app_handle
            .lock()
            .ok()
            .and_then(|handle| handle.clone())
            .and_then(|handle| {
                use tauri_plugin_dialog::DialogExt;
                handle
                    .dialog()
                    .file()
                    .blocking_pick_folder()
                    .and_then(|path| path.into_path().ok())
                    .and_then(|path| {
                        crate::security::ensure_safe_output_dir(&path)
                            .ok()
                            .map(|_| path.to_string_lossy().into_owned())
                    })
            });
        ("200 OK", pick_folder_body(folder))
    } else {
        (
            "404 Not Found",
            r#"{"ok":false,"error":"not found"}"#.into(),
        )
    };
    let cors_origin = allowed_origin(request.origin.as_deref());
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: X-Yood-Token, Content-Type\r\nAccess-Control-Max-Age: 600\r\nVary: Origin\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    if let Some(origin) = cors_origin {
        response.push_str(&format!("Access-Control-Allow-Origin: {origin}\r\n"));
    }
    response.push_str("\r\n");
    response.push_str(&body);
    let _ = stream.write_all(response.as_bytes());
}

impl DownloadManager {
    /// One OS notification per download when it reaches a terminal state
    /// (completed / failed). Guarded by id so progress re-emits never
    /// double-notify; failures surface the backend error, successes the
    /// saved file name.
    fn notify_terminal_state(&self, handle: &AppHandle, item: &DownloadItem) {
        let terminal = matches!(
            item.status,
            DownloadStatus::Completed | DownloadStatus::Failed
        );
        if !terminal {
            return;
        }
        let fresh = self
            .notified
            .lock()
            .map(|mut seen| seen.insert(item.id.clone()))
            .unwrap_or(false);
        if !fresh {
            return;
        }
        let title: String = item.title.chars().take(120).collect();
        let body = match &item.status {
            DownloadStatus::Completed => {
                let saved = item
                    .output_path
                    .as_ref()
                    .and_then(|path| {
                        path.file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                    })
                    .unwrap_or_else(|| "download complete".into());
                format!("Download complete: {saved}")
            }
            _ => {
                let reason = item.error.as_deref().unwrap_or("unknown error");
                let reason: String = reason.chars().take(120).collect();
                format!("Download failed: {title} — {reason}")
            }
        };
        {
            use tauri_plugin_notification::NotificationExt;
            let _ = handle
                .notification()
                .builder()
                .title("Yood")
                .body(body)
                .show();
        }
    }
}

fn load_history(path: &Path) -> AppResult<Vec<DownloadItem>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_HISTORY_BYTES
    {
        return Err(AppError::Storage(
            "download history is not a bounded regular file".into(),
        ));
    }
    let bytes = fs::read(path)?;
    if bytes.len() as u64 > MAX_HISTORY_BYTES {
        return Err(AppError::Storage(
            "download history exceeds the size limit".into(),
        ));
    }
    let mut items: Vec<DownloadItem> = serde_json::from_slice(&bytes)?;
    items.retain_mut(|item| {
        if Uuid::parse_str(&item.id).is_err()
            || item.title.len() > 2048
            || item.channel.len() > 1024
            || item.error.as_ref().is_some_and(|error| error.len() > 4096)
            || item
                .thumbnail
                .as_ref()
                .is_some_and(|thumbnail| thumbnail.len() > 4096)
            || validate_youtube_url(&item.request.url).is_err()
            || validate_request_fields(&item.request).is_err()
        {
            return false;
        }
        if matches!(item.status, DownloadStatus::Downloading) {
            item.status = DownloadStatus::Interrupted;
            item.error = Some("Yood closed while this download was active".into());
        }
        if let Some(path) = &item.output_path {
            if fs::symlink_metadata(path)
                .map(|metadata| metadata.file_type().is_symlink() || !metadata.is_file())
                .unwrap_or(false)
            {
                item.output_path = None;
            }
        }
        true
    });
    items.truncate(MAX_HISTORY);
    Ok(items)
}

fn validate_request_fields(request: &DownloadRequest) -> AppResult<()> {
    if !matches!(
        request.quality.as_str(),
        "best" | "1080" | "720" | "480" | "worst"
    ) || !matches!(request.container.as_str(), "mp4" | "mkv")
    {
        return Err(AppError::InvalidInput(
            "unsupported download quality or container".into(),
        ));
    }
    if let Some(selector) = &request.format_selector {
        if selector.len() > 256 || selector.chars().any(|c| c.is_control()) {
            return Err(AppError::InvalidInput(
                "invalid yt-dlp format selector".into(),
            ));
        }
    }
    if let Some(audio_quality) = &request.audio_quality {
        if audio_quality.is_empty()
            || audio_quality.len() > 3
            || !audio_quality.chars().all(|c| c.is_ascii_digit())
        {
            return Err(AppError::InvalidInput("invalid audio quality".into()));
        }
    }
    if let Some(context) = &request.context {
        if context.len() > 32 || context.chars().any(|c| c.is_control()) {
            return Err(AppError::InvalidInput("invalid download context".into()));
        }
    }
    if let Some(language) = &request.subtitle_language {
        if !is_valid_subtitle_language(language) {
            return Err(AppError::InvalidInput("invalid subtitle language".into()));
        }
    }
    if let Some(request_id) = &request.request_id {
        if request_id.is_empty()
            || request_id.len() > 128
            || !request_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(AppError::InvalidInput("invalid download request id".into()));
        }
    }
    if let Some(directory) = &request.directory {
        if !directory.is_absolute()
            || directory.file_name().is_none()
            || directory
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(AppError::UnsafePath(
                "download directory must be an absolute path".into(),
            ));
        }
    }
    Ok(())
}

fn validate_request(request: &DownloadRequest) -> AppResult<()> {
    validate_request_fields(request)?;
    if let Some(directory) = &request.directory {
        ensure_safe_output_dir(directory)?;
    }
    Ok(())
}

fn is_valid_subtitle_language(value: &str) -> bool {
    // BCP47-ish tags as yt-dlp expects them: "en", "he", "pt-BR", "zh-Hans".
    !value.is_empty()
        && value.len() <= 16
        && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn build_download_args(
    request: &DownloadRequest,
    temp: &Path,
    settings: &Settings,
) -> AppResult<Vec<String>> {
    let mut args = vec!["--ignore-config".into(), "--no-playlist".into(), "--newline".into(), "--progress".into(), "--progress-template".into(), "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s".into(), "--retries".into(), "3".into(), "--fragment-retries".into(), "3".into(), "--socket-timeout".into(), "30".into(), "--continue".into(), "--windows-filenames".into(), "--paths".into(), temp.to_string_lossy().into_owned(), "--output".into(), "yood-source.%(ext)s".into()];
    match request.mode {
        DownloadMode::Video => {
            let selector =
                request
                    .format_selector
                    .clone()
                    .unwrap_or_else(|| match request.quality.as_str() {
                        "1080" => "bestvideo*[height<=1080]+bestaudio/best[height<=1080]".into(),
                        "720" => "bestvideo*[height<=720]+bestaudio/best[height<=720]".into(),
                        "480" => "bestvideo*[height<=480]+bestaudio/best[height<=480]".into(),
                        "worst" => "worstvideo+worstaudio/worst".into(),
                        _ => "bestvideo*+bestaudio/best".into(),
                    });
            args.extend([
                "-f".into(),
                selector,
                "--merge-output-format".into(),
                request.container.clone(),
            ]);
            if request.subtitles || settings.download_subtitles {
                // Per-download language wins; otherwise the configured
                // default. Auto-generated subtitles are included too, so the
                // chosen language is available even when the uploader only
                // provided auto captions (YouTube auto-translates).
                let language = request
                    .subtitle_language
                    .clone()
                    .filter(|value| is_valid_subtitle_language(value))
                    .unwrap_or_else(|| settings.subtitle_language.clone());
                args.extend([
                    "--write-subs".into(),
                    "--write-auto-subs".into(),
                    "--sub-langs".into(),
                    language,
                    "--embed-subs".into(),
                ]);
            }
        }
        DownloadMode::Audio | DownloadMode::Songs => {
            args.extend([
                "-f".into(),
                "bestaudio/best".into(),
                "-x".into(),
                "--audio-format".into(),
                "mp3".into(),
                "--audio-quality".into(),
                request.audio_quality.clone().unwrap_or_else(|| "0".into()),
            ]);
            if request.embed_thumbnail
                || settings.embed_thumbnail
                || matches!(request.mode, DownloadMode::Songs)
            {
                args.extend(["--embed-thumbnail".into(), "--add-metadata".into()]);
            }
        }
    }
    args.push(request.url.clone());
    Ok(args)
}

#[derive(Debug)]
enum ProcessResult {
    Completed,
    Paused,
    Cancelled,
    Failed(AppError),
}

async fn run_download_process(
    mut command: tokio::process::Command,
    control: Arc<AtomicBool>,
    manager: DownloadManager,
    id: String,
) -> AppResult<ProcessResult> {
    let mut child: Child = command
        .spawn()
        .map_err(|error| AppError::Process(error.to_string()))?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(AppError::Process("yt-dlp stdout unavailable".into()));
    };
    let Some(stderr) = child.stderr.take() else {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(AppError::Process("yt-dlp stderr unavailable".into()));
    };
    let (sender, mut receiver) = mpsc::channel::<String>(256);
    let stdout_task = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.len() > MAX_PROCESS_LINE_BYTES {
                continue;
            }
            if sender.send(line).await.is_err() {
                break;
            }
        }
    });
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut retained = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let read = match reader.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            if retained.len() < MAX_PROCESS_STDERR_BYTES {
                let remaining = MAX_PROCESS_STDERR_BYTES - retained.len();
                retained.extend_from_slice(&chunk[..read.min(remaining)]);
            }
        }
        String::from_utf8_lossy(&retained).into_owned()
    });
    let mut last_error = String::new();
    let status = loop {
        tokio::select! {
            line = receiver.recv() => if let Some(line) = line { if let Some((progress, speed, eta, bytes)) = parse_progress(&line) { manager.update_progress(&id, progress, speed, eta, bytes); } else if !line.is_empty() { last_error = line; } },
            result = child.wait() => {
                match result {
                    Ok(status) => break status,
                    Err(error) => {
                        receiver.close();
                        let _ = process::terminate(&mut child).await;
                        let _ = stdout_task.await;
                        let _ = stderr_task.await;
                        return Err(AppError::Process(error.to_string()));
                    }
                }
            },
            _ = sleep(Duration::from_millis(250)) => {
                if control.load(Ordering::SeqCst) {
                    process::terminate(&mut child).await;
                    receiver.close();
                    let _ = stdout_task.await;
                    let _ = stderr_task.await;
                    let item = manager.item(&id).ok();
                    return Ok(if item.is_some_and(|item| matches!(item.status, DownloadStatus::Paused)) { ProcessResult::Paused } else { ProcessResult::Cancelled });
                }
            }
        }
    };
    receiver.close();
    let _ = stdout_task.await;
    let stderr_text = stderr_task
        .await
        .map_err(|error| AppError::Process(error.to_string()))?;
    if status.success() {
        Ok(ProcessResult::Completed)
    } else {
        if last_error.is_empty() {
            last_error = stderr_text;
        }
        if is_disk_full_error(&last_error) {
            return Ok(ProcessResult::Failed(AppError::Storage(
                "the destination drive ran out of disk space during the download".into(),
            )));
        }
        Ok(ProcessResult::Failed(AppError::Process(safe_diagnostic(
            &last_error,
        ))))
    }
}

fn parse_progress(line: &str) -> Option<Progress> {
    let values = line
        .strip_prefix("download:")?
        .split('|')
        .collect::<Vec<_>>();
    if values.len() < 4 {
        return None;
    }
    let progress = values[0].trim().trim_end_matches('%').parse::<f32>().ok()?;
    let speed = normalise_progress_text(values[1]);
    let eta = normalise_progress_text(values[2]);
    let bytes = values[3].trim().parse::<u64>().ok();
    Some((progress, speed, eta, bytes))
}

fn normalise_progress_text(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value == "N/A" {
        None
    } else {
        Some(value.chars().take(32).collect())
    }
}

fn parse_player_source(stdout: &str) -> AppResult<String> {
    let source = stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("https://"))
        .ok_or_else(|| AppError::Process("yt-dlp returned no playable media URL".into()))?;
    if source.len() > 16 * 1024 || source.chars().any(char::is_control) {
        return Err(AppError::Process(
            "yt-dlp returned an invalid media URL".into(),
        ));
    }
    let parsed = url::Url::parse(source)
        .map_err(|_| AppError::Process("yt-dlp returned an invalid media URL".into()))?;
    let Some(host) = parsed.host_str() else {
        return Err(AppError::Process(
            "yt-dlp returned an unsafe media URL".into(),
        ));
    };
    let host = host.to_ascii_lowercase();
    let allowed_host = host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "googlevideo.com"
        || host.ends_with(".googlevideo.com");
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !allowed_host
    {
        return Err(AppError::Process(
            "yt-dlp returned an unsafe media URL".into(),
        ));
    }
    Ok(parsed.into())
}

fn bounded_metadata(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(max_chars)
        .collect()
}

fn parse_inspect(stdout: &str) -> AppResult<InspectResult> {
    let value: Value = stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str(line).ok())
        .ok_or_else(|| AppError::Process("yt-dlp returned invalid metadata".into()))?;
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .map(|value| bounded_metadata(value, 512));
    let channel = value
        .get("uploader")
        .or_else(|| value.get("channel"))
        .and_then(Value::as_str)
        .map(|value| bounded_metadata(value, 256));
    let duration = value
        .get("duration_string")
        .or_else(|| value.get("duration"))
        .map(|value| value.to_string())
        .filter(|value| value != "null")
        .map(|value| bounded_metadata(&value, 128));
    let thumbnail = value
        .get("thumbnail")
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("https://"))
        .map(|url| bounded_metadata(url, 2048));
    let size_bytes = value
        .get("filesize")
        .and_then(Value::as_u64)
        .or_else(|| value.get("filesize_approx").and_then(Value::as_u64));
    let mut entries = Vec::new();
    if let Some(array) = value.get("entries").and_then(Value::as_array) {
        for entry in array.iter().take(500).filter_map(parse_entry) {
            entries.push(entry);
        }
    } else if let Some(entry) = parse_entry(&value) {
        entries.push(entry);
    }
    Ok(InspectResult {
        title,
        channel,
        duration,
        thumbnail,
        size_bytes,
        entries,
    })
}

fn parse_entry(value: &Value) -> Option<VideoEntry> {
    let id = value.get("id")?.as_str()?.to_string();
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return None;
    }
    let url = value
        .get("webpage_url")
        .or_else(|| value.get("url"))
        .and_then(Value::as_str)
        .and_then(|url| validate_youtube_url(url).ok())
        .map(|url| url.into())
        .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}"));
    let title = bounded_metadata(
        value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled video"),
        512,
    );
    let channel = bounded_metadata(
        value
            .get("uploader")
            .or_else(|| value.get("channel"))
            .and_then(Value::as_str)
            .unwrap_or_default(),
        256,
    );
    let duration = value
        .get("duration_string")
        .or_else(|| value.get("duration"))
        .map(|value| value.to_string())
        .filter(|value| value != "null")
        .map(|value| bounded_metadata(&value, 128));
    let thumbnail = value
        .get("thumbnail")
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("https://"))
        .map(|url| bounded_metadata(url, 2048));
    Some(VideoEntry {
        id,
        url,
        title,
        channel,
        duration,
        thumbnail,
    })
}

fn metadata_size(value: &InspectResult) -> Option<u64> {
    value.size_bytes
}

fn insufficient_disk_space(destination: &Path, needed_bytes: u64) -> Option<u64> {
    let free = fs2::available_space(destination).ok()?;
    (free < needed_bytes).then_some(free)
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KiB", "MiB", "GiB", "TiB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn is_disk_full_error(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [
        "no space left on device",
        "disk quota exceeded",
        "insufficient space",
        "out of disk space",
        "not enough space",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn locate_media(directory: &Path) -> Option<PathBuf> {
    let mut candidates = fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let meta = fs::symlink_metadata(&path).ok()?;
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || path.extension().is_some_and(|ext| {
                    matches!(
                        ext.to_str(),
                        Some("part" | "ytdl" | "vtt" | "jpg" | "jpeg" | "png" | "webp" | "json")
                    )
                })
            {
                return None;
            }
            Some((meta.len(), path))
        })
        .collect::<Vec<_>>();
    let exact = candidates.iter().filter(|(_, path)| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("yood-source.") && !name.contains(".f"))
    });
    if let Some((_, path)) = exact.max_by_key(|(size, _)| *size) {
        return Some(path.clone());
    }
    candidates.sort_by_key(|(size, _)| *size);
    candidates.pop().map(|(_, path)| path)
}

fn unique_target(directory: &Path, stem: &str, extension: &str, overwrite: bool) -> PathBuf {
    let base = directory.join(format!("{stem}.{extension}"));
    if overwrite || !base.exists() {
        return base;
    }
    for number in 1..10000 {
        let target = directory.join(format!("{stem} ({number}).{extension}"));
        if !target.exists() {
            return target;
        }
    }
    directory.join(format!("{stem}-{}.{extension}", Uuid::new_v4()))
}

fn move_media(source: &Path, target: &Path, overwrite: bool) -> AppResult<()> {
    if target.exists() {
        let metadata = fs::symlink_metadata(target)?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::UnsafePath("target is a symbolic link".into()));
        }
        if !overwrite {
            return Err(AppError::Storage("target already exists".into()));
        }
        fs::remove_file(target)?;
    }
    if !overwrite {
        let mut destination = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|error| {
                AppError::Storage(format!("cannot reserve completed download: {error}"))
            })?;
        let mut input = fs::File::open(source)?;
        let copied = std::io::copy(&mut input, &mut destination);
        let synced = destination.sync_all();
        drop(destination);
        if copied.is_err() || synced.is_err() {
            let _ = fs::remove_file(target);
            return Err(AppError::Storage("cannot copy completed download".into()));
        }
        fs::remove_file(source)?;
        return Ok(());
    }
    if fs::rename(source, target).is_err() {
        let copy_result = (|| -> AppResult<()> {
            let mut input = fs::File::open(source)?;
            let mut destination = OpenOptions::new().write(true).truncate(true).open(target)?;
            std::io::copy(&mut input, &mut destination)?;
            destination.sync_all()?;
            Ok(())
        })();
        if let Err(error) = copy_result {
            let _ = fs::remove_file(target);
            return Err(error);
        }
        fs::remove_file(source)?;
    }
    Ok(())
}

fn safe_diagnostic(value: &str) -> String {
    value
        .split_whitespace()
        .map(|part| {
            if part.starts_with("http://")
                || part.starts_with("https://")
                || part.starts_with("file://")
                || part.starts_with('/')
                || part.contains('\\')
            {
                "[detail redacted]"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(1000)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_direct_arguments_without_shell_interpretation() {
        let settings = Settings::default();
        let request = DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            ..Default::default()
        };
        let args = build_download_args(&request, Path::new("/tmp/yood"), &settings).unwrap();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--output", "yood-source.%(ext)s"]));
        assert!(args.contains(&request.url));
    }

    #[test]
    fn parses_progress() {
        let progress = parse_progress("download:42.5%|1.2MiB/s|00:03|1234").unwrap();
        assert_eq!(progress.0, 42.5);
        assert_eq!(progress.3, Some(1234));
    }

    #[test]
    fn accepts_only_https_player_sources() {
        assert!(parse_player_source("https://rr1---sn.googlevideo.com/media.mp4\n").is_ok());
        assert!(parse_player_source("http://rr1---sn.googlevideo.com/media.mp4\n").is_err());
        assert!(
            parse_player_source("https://user:pass@rr1---sn.googlevideo.com/media.mp4\n").is_err()
        );
        assert!(parse_player_source("https://localhost/media.mp4\n").is_err());
        assert!(parse_player_source("not a URL\n").is_err());
    }

    #[test]
    fn picks_unique_targets_when_not_overwriting() {
        let dir = std::env::temp_dir().join(format!("yood-target-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_target(&dir, "song", "mp3", false);
        assert_eq!(first, dir.join("song.mp3"));
        std::fs::write(&first, b"x").unwrap();
        let second = unique_target(&dir, "song", "mp3", false);
        assert_eq!(second, dir.join("song (1).mp3"));
        std::fs::write(&second, b"x").unwrap();
        let overwrite = unique_target(&dir, "song", "mp3", true);
        assert_eq!(overwrite, dir.join("song.mp3"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_filesize_from_inspect_json() {
        let json = r#"{"title":"T","uploader":"U","filesize":123456789,"filesize_approx":999}
"#;
        let result = parse_inspect(json).unwrap();
        assert_eq!(result.size_bytes, Some(123456789));
        let json_approx = r#"{"title":"T","filesize_approx":42}
"#;
        assert_eq!(parse_inspect(json_approx).unwrap().size_bytes, Some(42));
        let json_none = r#"{"title":"T"}
"#;
        assert_eq!(parse_inspect(json_none).unwrap().size_bytes, None);
    }

    #[test]
    fn audio_mode_builds_mp3_args_and_songs_embed_metadata() {
        let settings = Settings::default();
        let audio = DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            mode: DownloadMode::Audio,
            ..Default::default()
        };
        let args = build_download_args(&audio, Path::new("/tmp/yood"), &settings).unwrap();
        assert!(args.windows(2).any(|p| p == ["--audio-format", "mp3"]));
        assert!(args.windows(2).any(|p| p == ["-f", "bestaudio/best"]));
        assert!(!args.iter().any(|a| a == "--embed-thumbnail"));
        let songs = DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            mode: DownloadMode::Songs,
            ..Default::default()
        };
        let args = build_download_args(&songs, Path::new("/tmp/yood"), &settings).unwrap();
        assert!(args.iter().any(|a| a == "--embed-thumbnail"));
        assert!(args.iter().any(|a| a == "--add-metadata"));
    }

    #[test]
    fn detects_disk_full_errors() {
        assert!(is_disk_full_error("ERROR: No space left on device"));
        assert!(is_disk_full_error("disk quota exceeded while writing"));
        assert!(is_disk_full_error("insufficient space available"));
        assert!(!is_disk_full_error("network error occurred"));
    }

    #[test]
    fn formats_human_bytes() {
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(2048), "2.0 KiB");
        assert_eq!(format_bytes(5 * 1024 * 1024), "5.0 MiB");
        assert_eq!(format_bytes(3 * 1024 * 1024 * 1024), "3.0 GiB");
    }

    #[test]
    fn validates_requests() {
        let good = DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            container: "mkv".into(),
            ..Default::default()
        };
        assert!(validate_request(&good).is_ok());
        let bad_container = DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            container: "avi".into(),
            ..Default::default()
        };
        assert!(validate_request(&bad_container).is_err());
        let bad_selector = DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            format_selector: Some("rm -rf /".into()),
            ..Default::default()
        };
        assert!(validate_request(&bad_selector).is_ok());
        let control_selector = DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            format_selector: Some("foo\nbar".into()),
            ..Default::default()
        };
        assert!(validate_request(&control_selector).is_err());
    }
}

#[cfg(test)]
mod local_server_tests {
    use super::{allowed_origin, pick_folder_body, token_matches};

    #[test]
    fn local_feed_requires_a_matching_token_and_only_echoes_known_origins() {
        assert!(token_matches("0123456789abcdef", Some("0123456789abcdef")));
        assert!(!token_matches("0123456789abcdef", Some("0123456789abcdeg")));
        assert!(!token_matches("0123456789abcdef", None));
        assert_eq!(
            allowed_origin(Some("https://www.youtube.com")),
            Some("https://www.youtube.com")
        );
        assert_eq!(allowed_origin(Some("https://evil.example")), None);
    }

    #[test]
    fn encodes_chosen_folder_or_explicit_null() {
        assert_eq!(
            pick_folder_body(Some("/home/user/Videos".into())),
            r#"{"path":"/home/user/Videos"}"#
        );
        assert_eq!(pick_folder_body(None), r#"{"path":null}"#);
    }

    #[test]
    fn parses_extension_enqueue_payload() {
        let request: crate::models::DownloadRequest = serde_json::from_str(
            r#"{"url":"https://www.youtube.com/watch?v=abc","mode":"audio","subtitle_language":"he","directory":"/tmp/x","context":"extension"}"#,
        )
        .expect("enqueue payload parses");
        assert_eq!(request.url, "https://www.youtube.com/watch?v=abc");
        assert!(matches!(request.mode, crate::models::DownloadMode::Audio));
        assert_eq!(request.subtitle_language.as_deref(), Some("he"));
        assert_eq!(request.context.as_deref(), Some("extension"));
    }
}
