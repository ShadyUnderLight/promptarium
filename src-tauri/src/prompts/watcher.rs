//! Filesystem watcher for the active prompt project.
//!
//! Watcher events are debounced coalesced refresh triggers only. The frontend
//! rescans summaries and applies incremental index updates; we never mutate
//! library state from raw notify payloads.

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const DEBOUNCE_MS: u64 = 300;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFsChangedEvent {
    pub project_path: String,
    pub sequence: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFsWatchErrorEvent {
    pub project_path: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWatcherStatus {
    pub project_path: Option<String>,
    pub available: bool,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WatchTargets {
    pub project_root: PathBuf,
    pub parent_root: Option<PathBuf>,
}

struct WatcherInner {
    app: AppHandle,
    watched_path: Option<PathBuf>,
    generation: u64,
    sequence: u64,
    pending_debounce: u64,
    watcher: Option<RecommendedWatcher>,
    available: bool,
    last_error: Option<String>,
}

pub struct ProjectFsWatcher {
    inner: Arc<Mutex<WatcherInner>>,
}

impl ProjectFsWatcher {
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: Arc::new(Mutex::new(WatcherInner {
                app,
                watched_path: None,
                generation: 0,
                sequence: 0,
                pending_debounce: 0,
                watcher: None,
                available: true,
                last_error: None,
            })),
        }
    }

    /// Best-effort watcher sync. Never fails the caller; returns status for UI.
    pub fn sync_project(&self, project: Option<PathBuf>) -> ProjectWatcherStatus {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(_) => {
                return ProjectWatcherStatus {
                    project_path: project.as_ref().map(|path| path.display().to_string()),
                    available: false,
                    message: Some("project watcher lock poisoned".into()),
                };
            }
        };

        inner.generation = inner.generation.saturating_add(1);
        inner.pending_debounce = inner.pending_debounce.saturating_add(1);
        inner.watcher = None;
        inner.available = true;
        inner.last_error = None;

        let generation = inner.generation;
        let project_path = project.clone();

        let path = match project {
            Some(path) if path.exists() => path,
            Some(path) => {
                inner.watched_path = None;
                inner.available = false;
                inner.last_error = Some(format!("project folder not found: {}", path.display()));
                return status_from_inner(&inner);
            }
            None => {
                inner.watched_path = None;
                return status_from_inner(&inner);
            }
        };

        let targets = match watch_targets_for(&path) {
            Some(targets) => targets,
            None => {
                inner.watched_path = None;
                inner.available = false;
                inner.last_error = Some("could not resolve watch targets".into());
                return status_from_inner(&inner);
            }
        };

        let coordinator = Arc::clone(&self.inner);
        let watched = path.clone();
        let targets_for_callback = targets.clone();
        let mut watcher = match RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| match result {
                Ok(event) => {
                    if event_relevant(&event, &targets_for_callback) {
                        schedule_refresh(coordinator.clone(), watched.clone(), generation);
                    }
                }
                Err(error) => {
                    report_watch_error(
                        coordinator.clone(),
                        generation,
                        watched.clone(),
                        error.to_string(),
                    );
                }
            },
            Config::default(),
        ) {
            Ok(watcher) => watcher,
            Err(error) => {
                let message = format!("could not create filesystem watcher: {error}");
                inner.watched_path = Some(path);
                inner.available = false;
                inner.last_error = Some(message.clone());
                emit_watch_error(&inner.app, project_path.as_ref(), &message);
                return status_from_inner(&inner);
            }
        };

        if let Some(parent) = targets.parent_root.as_ref() {
            if let Err(error) = watcher.watch(parent, RecursiveMode::NonRecursive) {
                let message = format!(
                    "could not watch parent folder {}: {error}",
                    parent.display()
                );
                inner.watched_path = Some(path);
                inner.available = false;
                inner.last_error = Some(message.clone());
                emit_watch_error(&inner.app, project_path.as_ref(), &message);
                return status_from_inner(&inner);
            }
        }

        if let Err(error) = watcher.watch(&path, RecursiveMode::Recursive) {
            let message = format!("could not watch {}: {error}", path.display());
            inner.watched_path = Some(path);
            inner.available = false;
            inner.last_error = Some(message.clone());
            emit_watch_error(&inner.app, project_path.as_ref(), &message);
            return status_from_inner(&inner);
        }

        inner.watched_path = Some(path);
        inner.watcher = Some(watcher);
        status_from_inner(&inner)
    }
}

fn status_from_inner(inner: &WatcherInner) -> ProjectWatcherStatus {
    ProjectWatcherStatus {
        project_path: inner
            .watched_path
            .as_ref()
            .map(|path| path.display().to_string()),
        available: inner.available,
        message: inner.last_error.clone(),
    }
}

pub fn watch_targets_for(project_root: &Path) -> Option<WatchTargets> {
    if !project_root.exists() {
        return None;
    }
    let parent_root = project_root
        .parent()
        .filter(|parent| *parent != project_root)
        .map(Path::to_path_buf);
    Some(WatchTargets {
        project_root: project_root.to_path_buf(),
        parent_root,
    })
}

pub fn should_schedule_refresh(
    callback_generation: u64,
    current_generation: u64,
    project_path: &Path,
    watched_path: Option<&Path>,
) -> bool {
    callback_generation == current_generation
        && watched_path.is_some_and(|watched| watched == project_path)
}

pub fn event_relevant(event: &Event, targets: &WatchTargets) -> bool {
    if is_remove_or_rename_kind(&event.kind) {
        return event.paths.iter().any(|path| {
            !should_ignore_event_path(path.as_path(), targets)
                && event_path_belongs_to_watch(path.as_path(), targets)
        });
    }

    // Issue #25 watcher boundary: a non-`.md` Create refreshes so an asset that
    // appears later flips from `missing` to `resolved`. non-`.md` content
    // Modify must NOT refresh (binary outputs churn and would event-storm the
    // full library refresh); only prompt `.md` and directories do.
    let created_file = matches!(event.kind, EventKind::Create(_)) && !event_path_is_dir(&event);
    event.paths.iter().any(|path| {
        if should_ignore_event_path(path.as_path(), targets) {
            return false;
        }
        if !event_path_belongs_to_watch(path.as_path(), targets) {
            return false;
        }
        path_triggers_refresh(path.as_path(), targets) || created_file
    })
}

/// True when the event's first path is an existing directory. Used only to
/// refine the Create boundary: directories already refresh via
/// `path_triggers_refresh`, so a non-`.md` Create counts only for files.
fn event_path_is_dir(event: &Event) -> bool {
    event.paths.first().is_some_and(|path| path.is_dir())
}

fn is_remove_or_rename_kind(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Remove(_)
            | EventKind::Modify(ModifyKind::Name(
                RenameMode::Any | RenameMode::Both | RenameMode::From | RenameMode::To
            ))
    )
}

pub fn event_path_belongs_to_watch(path: &Path, targets: &WatchTargets) -> bool {
    if path.starts_with(&targets.project_root) {
        return true;
    }
    if let Some(parent) = targets.parent_root.as_ref() {
        if let (Some(project_name), Some(path_name)) =
            (targets.project_root.file_name(), path.file_name())
        {
            if path == parent.join(project_name)
                || (path.parent() == Some(parent) && path_name == project_name)
            {
                return true;
            }
        }
    }
    false
}

pub fn should_ignore_event_path(path: &Path, targets: &WatchTargets) -> bool {
    if path == targets.project_root {
        return false;
    }
    if let Ok(relative) = path.strip_prefix(&targets.project_root) {
        if relative.as_os_str().is_empty() {
            return false;
        }
        return relative_path_has_dot_segment(relative);
    }
    if let Some(parent) = targets.parent_root.as_ref() {
        if let Ok(relative) = path.strip_prefix(parent) {
            return relative_path_has_dot_segment(relative);
        }
    }
    false
}

fn relative_path_has_dot_segment(relative: &Path) -> bool {
    relative.components().any(|component| {
        if let Component::Normal(name) = component {
            name.to_str()
                .map(|segment| segment.starts_with('.'))
                .unwrap_or(false)
        } else {
            false
        }
    })
}

pub fn path_triggers_refresh(path: &Path, targets: &WatchTargets) -> bool {
    if path == targets.project_root {
        return true;
    }
    if targets.parent_root.as_ref().is_some_and(|parent| {
        path == parent.join(targets.project_root.file_name().unwrap_or_default())
    }) {
        return true;
    }
    if path.is_dir() {
        return true;
    }
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn report_watch_error(
    coordinator: Arc<Mutex<WatcherInner>>,
    generation: u64,
    project_path: PathBuf,
    message: String,
) {
    let app = {
        let mut inner = match coordinator.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        if !should_schedule_refresh(
            generation,
            inner.generation,
            &project_path,
            inner.watched_path.as_deref(),
        ) {
            return;
        }
        inner.available = false;
        inner.last_error = Some(message.clone());
        inner.app.clone()
    };
    emit_watch_error(&app, Some(&project_path), &message);
}

fn emit_watch_error(app: &AppHandle, project_path: Option<&PathBuf>, message: &str) {
    let _ = app.emit(
        "project-fs-watch-error",
        ProjectFsWatchErrorEvent {
            project_path: project_path.map(|path| path.display().to_string()),
            message: message.to_string(),
        },
    );
}

fn schedule_refresh(coordinator: Arc<Mutex<WatcherInner>>, project_path: PathBuf, generation: u64) {
    let token = {
        let inner = match coordinator.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        if !should_schedule_refresh(
            generation,
            inner.generation,
            &project_path,
            inner.watched_path.as_deref(),
        ) {
            return;
        }
        let mut inner = inner;
        inner.pending_debounce = inner.pending_debounce.saturating_add(1);
        inner.pending_debounce
    };

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(DEBOUNCE_MS)).await;
        let (app, sequence, project_path_string) = {
            let mut inner = match coordinator.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            if inner.pending_debounce != token
                || !should_schedule_refresh(
                    generation,
                    inner.generation,
                    &project_path,
                    inner.watched_path.as_deref(),
                )
            {
                return;
            }
            inner.sequence = inner.sequence.saturating_add(1);
            let sequence = inner.sequence;
            let project_path_string = project_path.display().to_string();
            (inner.app.clone(), sequence, project_path_string)
        };

        if app
            .emit(
                "project-fs-changed",
                ProjectFsChangedEvent {
                    project_path: project_path_string,
                    sequence,
                },
            )
            .is_err()
        {
            report_watch_error(
                coordinator,
                generation,
                project_path.clone(),
                "could not deliver filesystem refresh event to frontend".into(),
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, EventAttributes, ModifyKind, RemoveKind};
    use std::path::Path;

    fn targets(project: &Path) -> WatchTargets {
        watch_targets_for(project).expect("project exists")
    }

    fn event(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        Event {
            kind,
            paths,
            attrs: EventAttributes::default(),
        }
    }

    #[test]
    fn hidden_ancestors_do_not_disable_project_events() {
        let hidden_parent =
            std::env::temp_dir().join(format!(".promptarium-hidden-{}", uuid::Uuid::new_v4()));
        let project = hidden_parent.join("my-project");
        std::fs::create_dir_all(&project).unwrap();
        let file = project.join("review.md");
        std::fs::write(&file, "body").unwrap();

        let watch = targets(&project);
        assert!(!should_ignore_event_path(&file, &watch));
        assert!(event_relevant(
            &event(
                EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
                vec![file.clone()]
            ),
            &watch
        ));

        std::fs::remove_file(file).ok();
        std::fs::remove_dir_all(hidden_parent).ok();
    }

    #[test]
    fn internal_dot_directories_are_ignored() {
        let project = Path::new("/tmp/promptarium-project");
        let watch = WatchTargets {
            project_root: project.to_path_buf(),
            parent_root: Some(Path::new("/tmp").to_path_buf()),
        };
        assert!(should_ignore_event_path(
            &project.join(".git/objects/abc"),
            &watch
        ));
        assert!(should_ignore_event_path(
            &project.join("nested/.hidden/file.md"),
            &watch
        ));
    }

    #[test]
    fn remove_events_trigger_even_when_path_no_longer_exists() {
        let root = std::env::temp_dir().join(format!(
            "promptarium-watcher-remove-{}",
            uuid::Uuid::new_v4()
        ));
        let folder = root.join("coding");
        std::fs::create_dir_all(&folder).unwrap();
        let watch = targets(&root);
        std::fs::remove_dir_all(&folder).unwrap();

        assert!(event_relevant(
            &event(EventKind::Remove(RemoveKind::Folder), vec![folder]),
            &watch
        ));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn parent_watch_detects_project_root_path() {
        let parent = std::env::temp_dir().join(format!(
            "promptarium-watcher-parent-{}",
            uuid::Uuid::new_v4()
        ));
        let root = parent.join("my-project");
        std::fs::create_dir_all(&root).unwrap();
        let watch = targets(&root);
        assert_eq!(watch.parent_root.as_deref(), Some(parent.as_path()));
        assert!(event_path_belongs_to_watch(&root, &watch));
        assert!(event_relevant(
            &event(EventKind::Remove(RemoveKind::Folder), vec![root.clone()]),
            &watch
        ));
        std::fs::remove_dir_all(parent).ok();
    }

    #[test]
    fn stale_error_from_old_generation_is_ignored() {
        let project = Path::new("/tmp/project-a");
        assert!(!should_schedule_refresh(1, 3, project, Some(project)));
    }

    #[test]
    fn stale_generation_is_ignored() {
        assert!(!should_schedule_refresh(
            1,
            2,
            Path::new("/a"),
            Some(Path::new("/a"))
        ));
        assert!(!should_schedule_refresh(
            1,
            1,
            Path::new("/a"),
            Some(Path::new("/b"))
        ));
        assert!(!should_schedule_refresh(1, 1, Path::new("/a"), None));
        assert!(should_schedule_refresh(
            3,
            3,
            Path::new("/a"),
            Some(Path::new("/a"))
        ));
    }

    #[test]
    fn non_markdown_modify_events_do_not_refresh() {
        let root =
            std::env::temp_dir().join(format!("promptarium-watcher-txt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let watch = targets(&root);
        let txt = root.join("notes.txt");
        assert!(!event_relevant(
            &event(
                EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
                vec![txt]
            ),
            &watch
        ));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn markdown_modify_events_refresh() {
        let root =
            std::env::temp_dir().join(format!("promptarium-watcher-md-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let watch = targets(&root);
        let md = root.join("review.md");
        std::fs::write(&md, "body").unwrap();
        assert!(event_relevant(
            &event(
                EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
                vec![md]
            ),
            &watch
        ));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn create_event_on_markdown_refreshes() {
        let root = std::env::temp_dir().join(format!(
            "promptarium-watcher-create-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let watch = targets(&root);
        let md = root.join("new.md");
        assert!(event_relevant(
            &event(EventKind::Create(CreateKind::File), vec![md]),
            &watch
        ));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn non_markdown_create_event_refreshes_asset_freshness() {
        let root = std::env::temp_dir().join(format!(
            "promptarium-watcher-create-asset-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let watch = targets(&root);
        let asset = root.join("assets/reference.png");
        assert!(event_relevant(
            &event(EventKind::Create(CreateKind::File), vec![asset]),
            &watch
        ));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn non_markdown_create_in_dot_path_is_still_ignored() {
        let root = std::env::temp_dir().join(format!(
            "promptarium-watcher-create-dot-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let watch = targets(&root);
        let asset = root.join(".hidden/reference.png");
        assert!(!event_relevant(
            &event(EventKind::Create(CreateKind::File), vec![asset]),
            &watch
        ));
        std::fs::remove_dir_all(root).ok();
    }
}
