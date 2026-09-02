//! Tauri commands for the Prompt Library.

use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::Mutex;

use tauri::AppHandle;

use super::appstate::{self, Project, ProjectList};
use super::git::{self, GitFileDiff, GitFileHistoryPage, GitRepositoryInfo};
use super::store::{self, PromptDocument, PromptMetadata, PromptSummary, ResolvedPromptAsset};
use super::watcher::{ProjectFsWatcher, ProjectWatcherStatus};

pub struct PromptsState {
    watcher: Mutex<ProjectFsWatcher>,
}

impl PromptsState {
    pub fn new(app: AppHandle) -> Self {
        Self {
            watcher: Mutex::new(ProjectFsWatcher::new(app)),
        }
    }

    fn sync_watcher_for_active(&self) -> ProjectWatcherStatus {
        let root = match root() {
            Ok(root) => root,
            Err(error) => {
                return ProjectWatcherStatus {
                    project_path: None,
                    available: false,
                    message: Some(error),
                };
            }
        };
        let state = match appstate::list_projects(&root) {
            Ok(state) => state,
            Err(error) => {
                return ProjectWatcherStatus {
                    project_path: None,
                    available: false,
                    message: Some(error),
                };
            }
        };
        let project = state.active.map(PathBuf::from);
        self.sync_watcher(project)
    }

    fn sync_watcher(&self, project: Option<PathBuf>) -> ProjectWatcherStatus {
        self.watcher
            .lock()
            .map(|watcher| watcher.sync_project(project))
            .unwrap_or_else(|_| ProjectWatcherStatus {
                project_path: None,
                available: false,
                message: Some("project watcher lock poisoned".into()),
            })
    }
}

fn root() -> Result<PathBuf, String> {
    crate::datadir::data_root()
}

/// Commands receive a project path from the frontend, so every command checks
/// that it is a currently registered project. Existing-but-missing paths are
/// returned as their registered value so the store can report the loud missing
/// folder error instead of treating it as a different project.
fn registered_project(raw: &str) -> Result<PathBuf, String> {
    let root = root()?;
    let requested = PathBuf::from(raw);
    let state = appstate::list_projects(&root)?;
    confirmed_registered(&state.projects, &requested)
}

/// Match `requested` against the registered roster and fail closed when the
/// on-disk path no longer resolves back to its registered location (e.g. the
/// folder was renamed and replaced by a symlink pointing elsewhere). Project
/// identity is the canonical folder path recorded at registration; moving a
/// Project goes through the explicit Locate / replace flow, so any path whose
/// canonical target differs from the registered path is rejected rather than
/// silently following the redirect outside the original Project.
fn confirmed_registered(projects: &[Project], requested: &Path) -> Result<PathBuf, String> {
    if let Some(project) = projects.iter().find(|project| project.path == requested) {
        return confirmed_registered_path(&project.path, requested);
    }
    if let Ok(canonical) = requested.canonicalize() {
        if let Some(project) = projects.iter().find(|project| project.path == canonical) {
            return confirmed_registered_path(&project.path, requested);
        }
    }
    Err(format!(
        "project is not registered: {}",
        requested.display()
    ))
}

/// The registered path must still canonicalize back to itself. A missing path
/// keeps its registered identity (so the store reports the loud missing-folder
/// error); a path that exists but canonicalizes elsewhere has been replaced by
/// a symlink / moved behind our back and is rejected fail-closed.
fn confirmed_registered_path(registered: &Path, requested: &Path) -> Result<PathBuf, String> {
    let Ok(canonical) = requested.canonicalize() else {
        return Ok(registered.to_path_buf());
    };
    if canonical != registered {
        return Err(format!(
            "registered project path now resolves through a symlink or moved path: {}",
            requested.display()
        ));
    }
    Ok(registered.to_path_buf())
}

async fn blocking<T, F>(job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_projects() -> Result<ProjectList, String> {
    appstate::list_projects(&root()?)
}

#[tauri::command]
pub async fn add_project(
    state: tauri::State<'_, PromptsState>,
    name: String,
    path: String,
) -> Result<Project, String> {
    let project = appstate::add_project(&root()?, &name, Path::new(&path))?;
    state.sync_watcher_for_active();
    Ok(project)
}

#[tauri::command]
pub async fn rename_project_label(path: String, name: String) -> Result<Project, String> {
    appstate::rename_project_label(&root()?, Path::new(&path), &name)
}

#[tauri::command]
pub async fn replace_project_path(
    state: tauri::State<'_, PromptsState>,
    old_path: String,
    new_path: String,
) -> Result<Project, String> {
    let project =
        appstate::replace_project_path(&root()?, Path::new(&old_path), Path::new(&new_path))?;
    state.sync_watcher_for_active();
    Ok(project)
}

#[tauri::command]
pub async fn set_project_color(path: String, color: Option<String>) -> Result<Project, String> {
    appstate::set_project_color(&root()?, Path::new(&path), color)
}

#[tauri::command]
pub async fn remove_project(
    state: tauri::State<'_, PromptsState>,
    path: String,
) -> Result<(), String> {
    appstate::remove_project(&root()?, Path::new(&path))?;
    state.sync_watcher_for_active();
    Ok(())
}

#[tauri::command]
pub async fn set_active_project(
    state: tauri::State<'_, PromptsState>,
    path: String,
) -> Result<(), String> {
    appstate::set_active_project(&root()?, Path::new(&path))?;
    state.sync_watcher(Some(PathBuf::from(path)));
    Ok(())
}

#[tauri::command]
pub async fn sync_project_watcher(
    state: tauri::State<'_, PromptsState>,
    project: Option<String>,
) -> Result<ProjectWatcherStatus, String> {
    let path = match project {
        Some(path) => Some(registered_project(&path)?),
        None => None,
    };
    Ok(state.sync_watcher(path))
}

#[tauri::command]
pub async fn scan_project(project: String) -> Result<Vec<PromptSummary>, String> {
    let project = registered_project(&project)?;
    blocking(move || store::scan_prompts(&project)).await
}

#[tauri::command]
pub async fn scan_folders(project: String) -> Result<Vec<String>, String> {
    let project = registered_project(&project)?;
    blocking(move || store::scan_folders(&project)).await
}

#[tauri::command]
pub async fn read_prompt(project: String, name: String) -> Result<PromptDocument, String> {
    let project = registered_project(&project)?;
    blocking(move || store::read_prompt(&project, &name)).await
}

#[tauri::command]
pub async fn create_prompt(
    project: String,
    name: String,
    body: String,
    metadata: PromptMetadata,
) -> Result<PromptDocument, String> {
    let project = registered_project(&project)?;
    blocking(move || store::create_prompt(&project, &name, &body, &metadata)).await
}

#[tauri::command]
pub async fn save_prompt(
    project: String,
    name: String,
    body: String,
    metadata: PromptMetadata,
    frontmatter_prefix: Option<String>,
    metadata_dirty: bool,
    expected_raw: Option<String>,
) -> Result<PromptDocument, String> {
    let project = registered_project(&project)?;
    blocking(move || {
        store::save_prompt(
            &project,
            &name,
            &body,
            &metadata,
            frontmatter_prefix.as_deref(),
            metadata_dirty,
            expected_raw.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn rename_prompt(
    project: String,
    name: String,
    new_name: String,
) -> Result<PromptDocument, String> {
    let project = registered_project(&project)?;
    blocking(move || store::rename_prompt(&project, &name, &new_name)).await
}

#[tauri::command]
pub async fn move_prompt(
    project: String,
    name: String,
    destination: String,
) -> Result<PromptDocument, String> {
    let project = registered_project(&project)?;
    blocking(move || store::move_prompt(&project, &name, &destination)).await
}

#[tauri::command]
pub async fn delete_prompt(project: String, name: String) -> Result<(), String> {
    let registered = registered_project(&project)?;
    blocking(move || {
        store::delete_prompt(&registered, &name)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn create_folder(project: String, folder: String) -> Result<(), String> {
    let project = registered_project(&project)?;
    blocking(move || store::create_folder(&project, &folder)).await
}

#[tauri::command]
pub async fn rename_folder(
    project: String,
    folder: String,
    new_folder: String,
) -> Result<(), String> {
    let project = registered_project(&project)?;
    blocking(move || store::rename_folder(&project, &folder, &new_folder)).await
}

#[tauri::command]
pub async fn delete_empty_folder(project: String, folder: String) -> Result<(), String> {
    let project = registered_project(&project)?;
    blocking(move || store::delete_empty_folder(&project, &folder)).await
}

#[tauri::command]
pub async fn search_prompts(project: String, query: String) -> Result<Vec<PromptSummary>, String> {
    let project = registered_project(&project)?;
    blocking(move || store::search_prompts(&project, &query)).await
}

#[tauri::command]
pub async fn reveal_in_finder(project: String, name: Option<String>) -> Result<(), String> {
    let project = registered_project(&project)?;
    let target = match name {
        Some(name) => store::prompt_absolute_path(&project, &name)?,
        None => project,
    };
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("could not reveal {} in Finder: {error}", target.display()))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Err("Reveal in Finder is only available on macOS".to_string())
    }
}

/// Classify every asset reference in a batch (Issue #25). The command never
/// trusts an arbitrary project path: it goes through the registered-project
/// trust boundary first, then the store classifies each reference
/// independently — one bad reference never fails the batch.
#[tauri::command]
pub async fn resolve_prompt_assets(
    project: String,
    references: Vec<String>,
) -> Result<Vec<ResolvedPromptAsset>, String> {
    let project = registered_project(&project)?;
    blocking(move || Ok(store::resolve_prompt_assets(&project, &references))).await
}

/// Reveal an asset in Finder (Issue #25). This is a distinct seam from the
/// Prompt-only `reveal_in_finder` on purpose: before revealing, the reference
/// is re-validated in full (registered Project, safe relative path, no escape,
/// no symlink, non-`.md`, existing regular file). Missing / invalid targets
/// fail closed with a clear error — never a parent-folder fallback.
#[tauri::command]
pub async fn reveal_asset_in_finder(project: String, relative_path: String) -> Result<(), String> {
    let project = registered_project(&project)?;
    let target = store::asset_absolute_path_for_reveal(&project, &relative_path)?;
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|error| {
                format!(
                    "could not reveal asset {} in Finder: {error}",
                    target.display()
                )
            })?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Err("Reveal in Finder is only available on macOS".to_string())
    }
}

#[tauri::command]
pub async fn git_repository_info(project: String) -> Result<GitRepositoryInfo, String> {
    let project = registered_project(&project)?;
    blocking(move || git::repository_info(&project)).await
}

#[tauri::command]
pub async fn git_file_history(
    project: String,
    name: String,
    limit: Option<usize>,
    cursor: Option<String>,
) -> Result<GitFileHistoryPage, String> {
    let project = registered_project(&project)?;
    blocking(move || git::file_history(&project, &name, limit, cursor.as_deref())).await
}

#[tauri::command]
pub async fn git_file_diff(
    project: String,
    name: String,
    commit: String,
) -> Result<GitFileDiff, String> {
    let project = registered_project(&project)?;
    blocking(move || git::file_diff(&project, &name, &commit)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "promptarium-state-test-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn project(path: &Path) -> Project {
        Project {
            name: "p".into(),
            path: path.to_path_buf(),
            color: None,
        }
    }

    #[test]
    fn registered_project_path_replaced_by_symlink_fails_closed() {
        let base = tmp_dir("trust-symlink");
        let original = base.join("project");
        let redirect = base.join("outside");
        fs::create_dir_all(&original).unwrap();
        fs::create_dir_all(&redirect).unwrap();
        let canonical = original.canonicalize().unwrap();
        let roster = vec![project(&canonical)];

        // Control: the canonical registered path still resolves to itself.
        assert_eq!(
            confirmed_registered(&roster, &canonical).unwrap(),
            canonical
        );

        // Replace the folder with a symlink pointing outside the registered
        // location: resolution must fail closed, never follow the redirect.
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            fs::remove_dir_all(&original).unwrap();
            symlink(&redirect, &canonical).unwrap();
            let error = confirmed_registered(&roster, &canonical).unwrap_err();
            assert!(error.contains("symlink"), "{error}");
        }
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn registered_project_missing_on_disk_keeps_its_identity() {
        let base = tmp_dir("trust-missing");
        let original = base.join("project");
        fs::create_dir_all(&original).unwrap();
        let canonical = original.canonicalize().unwrap();
        let roster = vec![project(&canonical)];
        fs::remove_dir_all(&original).unwrap();
        assert_eq!(
            confirmed_registered(&roster, &canonical).unwrap(),
            canonical,
            "a registered-but-deleted path keeps its identity so the store can report the missing folder"
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn unregistered_path_is_rejected() {
        let base = tmp_dir("trust-unregistered");
        let not_registered = base.join("not-a-project");
        fs::create_dir_all(&not_registered).unwrap();
        let error = confirmed_registered(&[], &not_registered).unwrap_err();
        assert!(error.contains("not registered"), "{error}");
        fs::remove_dir_all(base).unwrap();
    }
}
