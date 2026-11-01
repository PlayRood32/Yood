use std::{
    collections::HashSet,
    fs,
    fs::OpenOptions,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use chrono::Utc;
use directories::ProjectDirs;
use url::Url;

use crate::{
    error::{AppError, AppResult},
    models::{
        Settings, SettingsPatch, DEFAULT_FILTER_LIST_URLS, MAX_FILTER_ETAGS, MAX_FILTER_ETAG_BYTES,
        MAX_FILTER_LIST_SOURCES, MAX_FILTER_SOURCE_BYTES,
    },
};

const CURRENT_SCHEMA: u32 = 2;
const MAX_SETTINGS_FILE_BYTES: u64 = 1024 * 1024;
static SAVE_LOCK: Mutex<()> = Mutex::new(());
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn config_path() -> AppResult<PathBuf> {
    ProjectDirs::from("com", "PlayRood", "Yood")
        .map(|dirs| dirs.config_dir().join("settings.json"))
        .ok_or_else(|| {
            AppError::Configuration(
                "could not determine the platform configuration directory".into(),
            )
        })
}

pub fn load() -> AppResult<Settings> {
    let path = config_path()?;
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(AppError::UnsafePath(
                "settings file is a symbolic link".into(),
            ));
        }
        Ok(metadata) if !metadata.is_file() || metadata.len() > MAX_SETTINGS_FILE_BYTES => {
            return Err(AppError::Storage(
                "settings file is not a bounded regular file".into(),
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Settings::default());
        }
        Err(error) => return Err(error.into()),
    }
    let mut raw = String::new();
    fs::File::open(&path)?
        .take(MAX_SETTINGS_FILE_BYTES + 1)
        .read_to_string(&mut raw)?;
    if raw.len() as u64 > MAX_SETTINGS_FILE_BYTES {
        return Err(AppError::Storage(
            "settings file exceeds the size limit".into(),
        ));
    }
    let mut settings: Settings = serde_json::from_str(&raw)?;
    migrate(&mut settings)?;
    validate(&settings)?;
    Ok(settings)
}

pub fn save(settings: &Settings) -> AppResult<()> {
    validate(settings)?;
    let path = config_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Configuration("invalid settings path".into()))?;
    fs::create_dir_all(parent)?;

    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if metadata.file_type().is_symlink() {
            return Err(AppError::UnsafePath(
                "settings file is a symbolic link".into(),
            ));
        }
    }

    // Serialize before taking the lock, then make replacement a serialized,
    // process-local operation. A unique temporary name means concurrent saves
    // cannot truncate or reuse one another's staging file.
    let bytes = serde_json::to_vec_pretty(settings)?;
    let _guard = SAVE_LOCK
        .lock()
        .map_err(|_| AppError::Storage("settings save lock poisoned".into()))?;
    let temporary = temporary_path(&path);
    let result = (|| -> AppResult<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|error| {
            AppError::Storage(format!("cannot create atomic settings file: {error}"))
        })?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        replace_file(&temporary, &path)
            .map_err(|error| AppError::Storage(format!("cannot activate settings: {error}")))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;

    // Best effort directory sync makes the rename durable on filesystems that
    // support syncing directories. It is not available on every platform.
    #[cfg(unix)]
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

pub fn apply_patch(settings: &mut Settings, patch: SettingsPatch) -> AppResult<()> {
    // Work on a copy so a failed validation or disk write cannot leave the
    // in-memory settings half-updated.
    let mut candidate = settings.clone();
    if let Some(value) = patch.appearance {
        candidate.appearance = value;
    }
    if let Some(value) = patch.tracking_protection {
        candidate.tracking_protection = value;
    }
    if let Some(value) = patch.aggressive_tracking_protection {
        candidate.aggressive_tracking_protection = value;
    }
    if let Some(value) = patch.max_concurrent_downloads {
        candidate.max_concurrent_downloads = value;
    }
    if let Some(value) = patch.download_directory {
        candidate.download_directory = value;
    }
    if let Some(value) = patch.temp_directory {
        candidate.temp_directory = value;
    }
    if let Some(value) = patch.cleanup_temp_files {
        candidate.cleanup_temp_files = value;
    }
    if let Some(value) = patch.overwrite_existing {
        candidate.overwrite_existing = value;
    }
    if let Some(value) = patch.embed_thumbnail {
        candidate.embed_thumbnail = value;
    }
    if let Some(value) = patch.download_subtitles {
        candidate.download_subtitles = value;
    }
    if let Some(value) = patch.subtitle_language {
        candidate.subtitle_language = value;
    }
    if let Some(value) = patch.log_level {
        candidate.log_level = value;
    }
    if let Some(value) = patch.shortcut_download {
        candidate.shortcut_download = value;
    }
    validate(&candidate)?;
    save(&candidate)?;
    *settings = candidate;
    Ok(())
}

/// Merge only filter metadata after an asynchronous refresh. A user may
/// change directories, shortcuts, or privacy settings while lists download;
/// replacing the whole settings snapshot would silently undo those edits.
pub fn merge_filter_state(current: &mut Settings, candidate: &Settings) {
    let sources: HashSet<String> = current.filter_list_urls.iter().cloned().collect();
    current
        .filter_etags
        .retain(|source, _| sources.contains(source));
    for (source, etag) in &candidate.filter_etags {
        if sources.contains(source) {
            current.filter_etags.insert(source.clone(), etag.clone());
        }
    }
    current.filter_last_success = if current.filter_list_urls == candidate.filter_list_urls {
        candidate.filter_last_success
    } else {
        None
    };
}

fn migrate(settings: &mut Settings) -> AppResult<()> {
    if settings.schema_version == 0 {
        settings.schema_version = CURRENT_SCHEMA;
    }
    if settings.schema_version > CURRENT_SCHEMA {
        return Err(AppError::Configuration(format!(
            "settings schema {} is newer than this application",
            settings.schema_version
        )));
    }
    for default_url in DEFAULT_FILTER_LIST_URLS {
        if settings
            .filter_list_urls
            .iter()
            .any(|url| url == default_url)
        {
            continue;
        }
        if settings.filter_list_urls.len() >= MAX_FILTER_LIST_SOURCES {
            break;
        }
        settings.filter_list_urls.push((*default_url).into());
    }

    // Remove duplicate source entries and stale ETags during migration. The
    // strict validation below still rejects malformed/unbounded values.
    let mut seen = HashSet::new();
    settings
        .filter_list_urls
        .retain(|source| seen.insert(source.clone()));
    let sources: HashSet<String> = settings.filter_list_urls.iter().cloned().collect();
    settings
        .filter_etags
        .retain(|source, _| sources.contains(source));
    settings.schema_version = CURRENT_SCHEMA;
    Ok(())
}

pub fn validate(settings: &Settings) -> AppResult<()> {
    if !(1..=4).contains(&settings.max_concurrent_downloads) {
        return Err(AppError::InvalidInput(
            "concurrent downloads must be between 1 and 4".into(),
        ));
    }
    validate_directory(&settings.download_directory, "download")?;
    validate_directory(&settings.temp_directory, "temporary")?;
    if settings.download_directory == settings.temp_directory {
        return Err(AppError::InvalidInput(
            "download and temporary folders must be different".into(),
        ));
    }
    validate_filter_sources(&settings.filter_list_urls)?;
    validate_filter_etags(&settings.filter_etags)?;
    if settings.subtitle_language.len() > 32
        || settings.subtitle_language.chars().any(char::is_control)
        || (!settings.subtitle_language.is_empty()
            && !settings
                .subtitle_language
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-'))
    {
        return Err(AppError::InvalidInput("invalid subtitle language".into()));
    }
    if !["ERROR", "WARN", "INFO", "DEBUG", "TRACE"].contains(&settings.log_level.as_str()) {
        return Err(AppError::InvalidInput("invalid log level".into()));
    }
    let shortcut = settings.shortcut_download.chars().collect::<Vec<_>>();
    if shortcut.len() != 1 || !shortcut[0].is_ascii_alphanumeric() {
        return Err(AppError::InvalidInput(
            "download shortcut must be a single letter or digit".into(),
        ));
    }
    Ok(())
}

fn has_symlink_component(path: &Path) -> bool {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => return true,
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => break,
            Err(_) => return true,
        }
    }
    false
}

fn validate_directory(path: &Path, label: &str) -> AppResult<()> {
    if !path.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "{label} folder must be an absolute path"
        )));
    }
    if path.to_string_lossy().len() > 4096 || path.to_string_lossy().chars().any(char::is_control) {
        return Err(AppError::InvalidInput(format!("invalid {label} folder")));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(AppError::UnsafePath(format!(
            "{label} folder contains a parent traversal"
        )));
    }
    if path.parent().is_none() || path == Path::new("/") || path.file_name().is_none() {
        return Err(AppError::InvalidInput(format!("invalid {label} folder")));
    }
    if has_symlink_component(path) {
        return Err(AppError::UnsafePath(format!(
            "{label} folder contains a symbolic link"
        )));
    }
    Ok(())
}

pub(crate) fn validate_filter_source(source: &str) -> AppResult<()> {
    if source.is_empty()
        || source.len() > MAX_FILTER_SOURCE_BYTES
        || source.chars().any(char::is_control)
    {
        return Err(AppError::InvalidInput(
            "filter list URLs must be non-empty, HTTPS, and at most 2048 bytes".into(),
        ));
    }
    let parsed =
        Url::parse(source).map_err(|_| AppError::InvalidInput("invalid filter list URL".into()))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(AppError::InvalidInput(
            "filter list URLs must be HTTPS URLs without credentials".into(),
        ));
    }
    Ok(())
}

fn validate_filter_sources(sources: &[String]) -> AppResult<()> {
    if sources.len() > MAX_FILTER_LIST_SOURCES {
        return Err(AppError::InvalidInput(format!(
            "at most {MAX_FILTER_LIST_SOURCES} filter lists are allowed"
        )));
    }
    let mut seen = HashSet::new();
    for source in sources {
        validate_filter_source(source)?;
        if !seen.insert(source) {
            return Err(AppError::InvalidInput(
                "filter list URLs must not contain duplicates".into(),
            ));
        }
    }
    Ok(())
}

fn validate_filter_etags(etags: &std::collections::BTreeMap<String, String>) -> AppResult<()> {
    if etags.len() > MAX_FILTER_ETAGS {
        return Err(AppError::InvalidInput(format!(
            "at most {MAX_FILTER_ETAGS} filter ETags are allowed"
        )));
    }
    for (source, etag) in etags {
        validate_filter_source(source)?;
        if etag.len() > MAX_FILTER_ETAG_BYTES || etag.chars().any(char::is_control) {
            return Err(AppError::InvalidInput("invalid filter ETag".into()));
        }
    }
    Ok(())
}

/// Apply validated filter metadata to an in-memory candidate. Persistence is
/// intentionally performed by the caller after merging with live settings.
pub fn mark_filter_success(
    settings: &mut Settings,
    etags: impl IntoIterator<Item = (String, String)>,
) -> AppResult<()> {
    let mut candidate = settings.clone();
    candidate.filter_last_success = Some(Utc::now());
    let sources: HashSet<String> = candidate.filter_list_urls.iter().cloned().collect();
    for (source, etag) in etags {
        if sources.contains(&source) {
            candidate.filter_etags.insert(source, etag);
        }
    }
    validate(&candidate)?;
    // The caller merges this result into the live settings under its lock and
    // persists that merged snapshot. Saving here would be a stale whole-file
    // write if the user changed another setting while lists were downloading.
    *settings = candidate;
    Ok(())
}

pub fn mark_ytdlp_updated(settings: &mut Settings) -> AppResult<()> {
    let mut candidate = settings.clone();
    candidate.ytdlp_last_update = Some(Utc::now());
    validate(&candidate)?;
    save(&candidate)?;
    *settings = candidate;
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("tmp.{}.{sequence}", std::process::id()))
}

/// Replace a completed temporary file with the destination. Unix rename is
/// atomic when both paths are on the same filesystem. Windows' std::fs::rename
/// does not replace an existing file, so use MoveFileExW with replace + write
/// through there instead of deleting the live settings file first.
#[cfg(not(windows))]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;
    let source: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn default_settings_are_valid() {
        let settings = Settings::default();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert_eq!(settings.log_level, "INFO");
        assert_eq!(settings.shortcut_download, "d");
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn migrates_legacy_schema_and_backfills_filter_lists() {
        let mut settings = Settings::default();
        settings.schema_version = 0;
        settings.filter_list_urls = vec!["https://example.test/custom.txt".into()];
        migrate(&mut settings).unwrap();
        assert_eq!(settings.schema_version, CURRENT_SCHEMA);
        assert!(settings
            .filter_list_urls
            .contains(&"https://easylist.to/easylist/easylist.txt".into()));
        assert!(settings
            .filter_list_urls
            .contains(&"https://example.test/custom.txt".into()));
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn rejects_newer_schema() {
        let mut settings = Settings::default();
        settings.schema_version = CURRENT_SCHEMA + 1;
        assert!(migrate(&mut settings).is_err());
    }

    #[test]
    fn rejects_invalid_settings() {
        let mut settings = Settings::default();
        settings.max_concurrent_downloads = 0;
        assert!(validate(&settings).is_err());
        settings = Settings::default();
        settings.max_concurrent_downloads = 5;
        assert!(validate(&settings).is_err());
        settings = Settings::default();
        settings.download_directory = settings.temp_directory.clone();
        assert!(validate(&settings).is_err());
        settings = Settings::default();
        settings.log_level = "VERBOSE".into();
        assert!(validate(&settings).is_err());
        settings = Settings::default();
        settings.shortcut_download = "dd".into();
        assert!(validate(&settings).is_err());
        settings = Settings::default();
        settings.shortcut_download = " ".into();
        assert!(validate(&settings).is_err());
    }

    #[test]
    fn rejects_invalid_filter_metadata() {
        let mut settings = Settings::default();
        settings.filter_list_urls = vec!["http://example.test/list.txt".into()];
        assert!(validate(&settings).is_err());

        settings = Settings::default();
        settings.filter_list_urls = (0..=MAX_FILTER_LIST_SOURCES)
            .map(|index| format!("https://example.test/{index}.txt"))
            .collect();
        assert!(validate(&settings).is_err());

        settings = Settings::default();
        settings
            .filter_etags
            .insert("https://example.test/list.txt".into(), "etag\n".into());
        assert!(validate(&settings).is_err());
    }

    #[test]
    fn failed_patch_does_not_mutate_settings() {
        let mut settings = Settings::default();
        let before = settings.clone();
        let result = apply_patch(
            &mut settings,
            SettingsPatch {
                download_directory: Some(PathBuf::from("relative/path")),
                ..Default::default()
            },
        );
        assert!(result.is_err());
        assert_eq!(settings.download_directory, before.download_directory);
        assert_eq!(settings.temp_directory, before.temp_directory);
    }

    #[test]
    fn merging_filter_state_preserves_live_settings() {
        let mut current = Settings::default();
        let mut candidate = current.clone();
        current.download_directory = PathBuf::from("/tmp/yood-live-downloads");
        current.filter_list_urls = vec!["https://example.test/live.txt".into()];
        candidate
            .filter_etags
            .insert("https://example.test/live.txt".into(), "fresh".into());
        candidate
            .filter_etags
            .insert("https://example.test/old.txt".into(), "stale".into());
        merge_filter_state(&mut current, &candidate);
        assert_eq!(
            current.download_directory,
            PathBuf::from("/tmp/yood-live-downloads")
        );
        assert!(current
            .filter_etags
            .contains_key("https://example.test/live.txt"));
        assert!(!current
            .filter_etags
            .contains_key("https://example.test/old.txt"));
    }

    #[test]
    fn atomic_replace_replaces_existing_file() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("yood-settings-atomic-{suffix}"));
        fs::create_dir_all(&directory).unwrap();
        let destination = directory.join("settings.json");
        let source = directory.join("settings.json.new");
        fs::write(&destination, b"old").unwrap();
        fs::write(&source, b"new").unwrap();
        replace_file(&source, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        let _ = fs::remove_dir_all(directory);
    }
}
