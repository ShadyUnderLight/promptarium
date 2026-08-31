//! Tauri commands for the Prompt Library.

use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;

use super::appstate::{self, Project, ProjectList};
use super::store::{self, PromptDocument, PromptMetadata, PromptSummary};

pub struct PromptsState;

impl PromptsState {
    pub fn new() -> Self {
        Self
    }
}

impl Default for PromptsState {
    fn default() -> Self {
        Self::new()
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
    if let Some(project) = state
        .projects
        .iter()
        .find(|project| project.path == requested)
    {
        return Ok(project.path.clone());
    }
    if let Ok(canonical) = requested.canonicalize() {
        if let Some(project) = state
            .projects
            .iter()
            .find(|project| project.path == canonical)
        {
            return Ok(project.path.clone());
        }
    }
    Err(format!("project is not registered: {raw}"))
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
pub async fn add_project(name: String, path: String) -> Result<Project, String> {
    appstate::add_project(&root()?, &name, Path::new(&path))
}

#[tauri::command]
pub async fn set_project_color(path: String, color: Option<String>) -> Result<Project, String> {
    appstate::set_project_color(&root()?, Path::new(&path), color)
}

#[tauri::command]
pub async fn remove_project(path: String) -> Result<(), String> {
    appstate::remove_project(&root()?, Path::new(&path))
}

#[tauri::command]
pub async fn set_active_project(path: String) -> Result<(), String> {
    appstate::set_active_project(&root()?, Path::new(&path))
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
