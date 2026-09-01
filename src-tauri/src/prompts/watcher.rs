//! Filesystem watcher for the active prompt project.
//!
//! Watcher events are debounced coalesced refresh triggers only. The frontend
//! rescans summaries and applies incremental index updates; we never mutate
//! library state from raw notify payloads.

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const DEBOUNCE_MS: u64 = 300;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFsChangedEvent {
    pub project_path: String,
    pub sequence: u64,
}

struct WatcherInner {
    app: AppHandle,
    watched_path: Option<PathBuf>,
    generation: u64,
    sequence: u64,
    pending_debounce: u64,
    watcher: Option<RecommendedWatcher>,
    failed: bool,
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
                failed: false,
            })),
        }
    }

    pub fn sync_project(&self, project: Option<PathBuf>) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "project watcher lock poisoned".to_string())?;
        inner.generation = inner.generation.saturating_add(1);
        inner.pending_debounce = inner.pending_debounce.saturating_add(1);
        inner.watcher = None;
        inner.failed = false;

        let generation = inner.generation;
        let path = match project {
            Some(path) if path.exists() => path,
            _ => {
                inner.watched_path = None;
                return Ok(());
            }
        };

        let coordinator = Arc::clone(&self.inner);
        let watched = path.clone();
        let mut watcher = RecommendedWatcher::new(
            move |result| {
                if let Ok(event) = result {
                    if event_relevant(&event) {
                        schedule_refresh(coordinator.clone(), watched.clone(), generation);
                    }
                }
            },
            Config::default(),
        )
        .map_err(|error| format!("could not create filesystem watcher: {error}"))?;

        watcher
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|error| format!("could not watch {}: {error}", path.display()))?;

        inner.watched_path = Some(path);
        inner.watcher = Some(watcher);
        Ok(())
    }
}

fn schedule_refresh(coordinator: Arc<Mutex<WatcherInner>>, project_path: PathBuf, generation: u64) {
    let token = {
        let mut inner = match coordinator.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        if inner.generation != generation {
            return;
        }
        if inner.watched_path.as_ref() != Some(&project_path) {
            return;
        }
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
                || inner.generation != generation
                || inner.watched_path.as_deref() != Some(project_path.as_path())
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
            if let Ok(mut inner) = coordinator.lock() {
                inner.failed = true;
            }
        }
    });
}

fn event_relevant(event: &Event) -> bool {
    event
        .paths
        .iter()
        .any(|path| path_triggers_refresh(path.as_path()))
}

pub fn path_is_ignored(path: &Path) -> bool {
    path.components().any(|component| {
        if let Component::Normal(name) = component {
            name.to_str()
                .map(|segment| segment.starts_with('.'))
                .unwrap_or(false)
        } else {
            false
        }
    })
}

pub fn path_triggers_refresh(path: &Path) -> bool {
    if path_is_ignored(path) {
        return false;
    }
    if path.is_dir() {
        return true;
    }
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn dot_directories_are_ignored() {
        assert!(path_is_ignored(Path::new("/project/.git/objects/abc")));
        assert!(path_is_ignored(Path::new(
            "/project/nested/.hidden/file.md"
        )));
    }

    #[test]
    fn markdown_and_directories_trigger_refresh() {
        assert!(path_triggers_refresh(Path::new("/project/review.md")));
        let dir =
            std::env::temp_dir().join(format!("promptarium-watcher-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(path_triggers_refresh(&dir));
        std::fs::remove_dir_all(dir).ok();
        assert!(!path_triggers_refresh(Path::new("/project/readme.txt")));
        assert!(!path_triggers_refresh(Path::new("/project/.git/index")));
    }
}
