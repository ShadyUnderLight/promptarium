//! App-local state: `<data root>/prompts-state.json` — the project roster and
//! active project.
//!
//! **This file exists so that nothing here ever lands in a project folder.**
//! A project folder is the user's git repo. Everything the *app* owns, as
//! opposed to what the *user wrote*, lives out here instead.
//!
//! The roster is the only place a project exists at all: a project is a name and
//! a folder, and its prompts are simply the `*.md` files inside that folder.
//! There is no id, no cross-reference, and therefore nothing that can drift out
//! of sync with the filesystem.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// A project is a name, a folder, and an optional presentation color. It has no
/// app-generated id; the canonical folder path is the identity.
///
/// `color` is a resolved hex string picked from a fixed frontend swatch (see
/// `ProjectMenu.svelte`); the backend treats it as an opaque string, the
/// same way it treats prompt content — no validation, no palette lives
/// server-side. `None` means "no color set".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub path: PathBuf,
    #[serde(default)]
    pub color: Option<String>,
}

/// What `list_projects` answers with. The roster alone is not enough: the active
/// project is persisted and restored on launch, so the frontend has to be able
/// to read it back, and the command surface has no separate getter for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectList {
    pub projects: Vec<Project>,
    pub active: Option<PathBuf>,
}

/// The on-disk shape of `prompts-state.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    projects: Vec<Project>,
    #[serde(default)]
    active: Option<PathBuf>,
}

fn state_path(root: &Path) -> PathBuf {
    root.join("prompts-state.json")
}

/// Read the state file. A missing file is a fresh install (empty state), but a
/// file that exists and cannot be parsed is a **loud error**, never a silent
/// reset: quietly returning an empty roster would read to the user as every one
/// of their projects having vanished, and the next save would then persist that
/// emptiness over the top of the file that still held them.
fn load(root: &Path) -> Result<State, String> {
    let path = state_path(root);
    if !path.is_file() {
        return Ok(State::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| {
        format!(
            "prompts-state.json cannot be parsed ({e}) — fix or remove the file; the project roster is never silently reset"
        )
    })
}

/// Atomic write (temp sibling + rename), pretty-printed with a trailing newline.
fn save(root: &Path, state: &State) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut pretty = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    pretty.push('\n');
    let tmp = root.join(".tmp-prompts-state.json");
    fs::write(&tmp, pretty).map_err(|e| e.to_string())?;
    fs::rename(&tmp, state_path(root)).map_err(|e| e.to_string())
}

pub fn list_projects(root: &Path) -> Result<ProjectList, String> {
    let state = load(root)?;
    Ok(ProjectList { projects: state.projects, active: state.active })
}

/// Add a project, or rename the one already registered at this path (a path is
/// a project's identity here, so re-adding it is a rename, not a duplicate).
///
/// The folder must already exist: a project *is* a folder, so registering a path
/// that isn't one would create a roster entry whose every future scan errors.
/// The path is canonicalized so that two spellings of the same folder cannot
/// become two projects with divergent registrations.
pub fn add_project(root: &Path, name: &str, path: &Path) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("project name cannot be empty".to_string());
    }
    if !path.is_dir() {
        return Err(format!("project folder does not exist: {}", path.display()));
    }
    let path = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;

    let mut state = load(root)?;
    match state.projects.iter_mut().find(|p| p.path == path) {
        Some(existing) => existing.name = name.to_string(),
        None => state.projects.push(Project {
            name: name.to_string(),
            path: path.clone(),
            color: None,
        }),
    }
    let project = state
        .projects
        .iter()
        .find(|p| p.path == path)
        .expect("just inserted or found above")
        .clone();
    // First project becomes active, or the user would have a roster and no
    // selection — a state the UI has no way to leave.
    if state.active.is_none() {
        state.active = Some(path);
    }
    save(root, &state)?;
    Ok(project)
}

/// Set (or clear, with `None`) a project's color. Round 2's restore of the
/// round-1 cut — see the `Project` doc comment. The backend does not validate
/// the value against the frontend's fixed swatch; it is an opaque string here,
/// same as everywhere else this module treats "what the UI chose" as none of
/// its business.
pub fn set_project_color(
    root: &Path,
    path: &Path,
    color: Option<String>,
) -> Result<Project, String> {
    let mut state = load(root)?;
    let project = state
        .projects
        .iter_mut()
        .find(|p| p.path == path)
        .ok_or_else(|| format!("not a known project: {}", path.display()))?;
    project.color = color;
    let updated = project.clone();
    save(root, &state)?;
    Ok(updated)
}

/// Forget a project. **It never deletes files.**
///
/// The user's prompts are their own; the app is a viewer onto a folder it does
/// not own. Removing a project drops the roster entry and nothing more — every
/// `.md` file stays exactly where it was, so re-adding the folder restores the
/// project intact.
pub fn remove_project(root: &Path, path: &Path) -> Result<(), String> {
    let mut state = load(root)?;
    let before = state.projects.len();
    state.projects.retain(|p| p.path != path);
    if state.projects.len() == before {
        return Ok(()); // absent already — idempotent
    }
    if state.active.as_deref() == Some(path) {
        // Fall back to any remaining project rather than leaving the UI with a
        // roster and no selection.
        state.active = state.projects.first().map(|p| p.path.clone());
    }
    save(root, &state)
}

/// Persist the active project; restored on launch. Only a rostered path may be
/// active — anything else would leave the app pointing at a project it cannot
/// list.
pub fn set_active_project(root: &Path, path: &Path) -> Result<(), String> {
    let mut state = load(root)?;
    if !state.projects.iter().any(|p| p.path == path) {
        return Err(format!("not a known project: {}", path.display()));
    }
    state.active = Some(path.to_path_buf());
    save(root, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir()
            .join(format!("prompt-compose-appstate-test-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// A root for app state, plus a folder standing in for the user's git-tracked
    /// prompt repo.
    fn fixture(name: &str) -> (PathBuf, PathBuf) {
        let root = tmp_dir(name);
        let project = root.join("prompt_repo");
        fs::create_dir_all(&project).unwrap();
        (root, project.canonicalize().unwrap())
    }

    #[test]
    fn a_project_is_a_name_and_a_folder_and_the_first_one_becomes_active() {
        let (root, project) = fixture("add");
        let added = add_project(&root, "juror", &project).unwrap();
        assert_eq!(added, Project { name: "juror".into(), path: project.clone(), color: None });

        let list = list_projects(&root).unwrap();
        assert_eq!(list.projects, vec![added]);
        assert_eq!(list.active, Some(project), "the first project must become active");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn re_adding_a_path_renames_rather_than_duplicating() {
        // The path is the project's identity; two entries for one folder would
        // give it two divergent registrations.
        let (root, project) = fixture("rename");
        add_project(&root, "old name", &project).unwrap();
        add_project(&root, "new name", &project).unwrap();
        let list = list_projects(&root).unwrap();
        assert_eq!(list.projects.len(), 1);
        assert_eq!(list.projects[0].name, "new name");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_project_folder_must_exist() {
        let (root, _) = fixture("missing");
        assert!(add_project(&root, "ghost", &root.join("nope")).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn setting_a_color_persists_it_and_leaves_the_name_untouched() {
        let (root, project) = fixture("color");
        add_project(&root, "juror", &project).unwrap();

        let updated = set_project_color(&root, &project, Some("#0ea5e9".to_string())).unwrap();
        assert_eq!(updated.color.as_deref(), Some("#0ea5e9"));
        assert_eq!(updated.name, "juror", "setting a color must not touch the name");

        // Re-read from disk: this is what the launch-time restore would see.
        let list = list_projects(&root).unwrap();
        assert_eq!(list.projects[0].color.as_deref(), Some("#0ea5e9"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn clearing_a_color_sets_it_back_to_none() {
        let (root, project) = fixture("color-clear");
        add_project(&root, "juror", &project).unwrap();
        set_project_color(&root, &project, Some("#d97706".to_string())).unwrap();

        let cleared = set_project_color(&root, &project, None).unwrap();
        assert_eq!(cleared.color, None);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_rename_preserves_the_existing_color() {
        // add_project handles both add AND rename (path is the identity); a
        // rename must not silently drop a color the user already picked.
        let (root, project) = fixture("color-rename");
        add_project(&root, "old name", &project).unwrap();
        set_project_color(&root, &project, Some("#8b5cf6".to_string())).unwrap();

        let renamed = add_project(&root, "new name", &project).unwrap();
        assert_eq!(renamed.name, "new name");
        assert_eq!(
            renamed.color.as_deref(),
            Some("#8b5cf6"),
            "rename must not clear the color"
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn setting_a_color_on_an_unrostered_path_errors() {
        let (root, _) = fixture("color-unknown");
        let unknown = root.join("ghost");
        assert!(set_project_color(&root, &unknown, Some("#000".to_string())).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn remove_project_forgets_the_path_and_never_deletes_files() {
        // The whole contract of remove_project, in one assertion: the user's
        // prompts are their own.
        let (root, project) = fixture("remove");
        fs::write(project.join("keep.md"), "my prompt").unwrap();
        add_project(&root, "juror", &project).unwrap();

        remove_project(&root, &project).unwrap();

        assert!(list_projects(&root).unwrap().projects.is_empty(), "the roster entry is gone");
        assert!(project.is_dir(), "the folder must survive");
        assert_eq!(
            fs::read_to_string(project.join("keep.md")).unwrap(),
            "my prompt",
            "every .md file must survive, byte for byte"
        );
        remove_project(&root, &project).expect("removing an absent project is success");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn removing_the_active_project_falls_back_to_another() {
        let (root, first) = fixture("active-fallback");
        let second = first.parent().unwrap().join("other_repo");
        fs::create_dir_all(&second).unwrap();
        let second = second.canonicalize().unwrap();

        add_project(&root, "first", &first).unwrap();
        add_project(&root, "second", &second).unwrap();
        assert_eq!(list_projects(&root).unwrap().active, Some(first.clone()));

        remove_project(&root, &first).unwrap();
        assert_eq!(
            list_projects(&root).unwrap().active,
            Some(second),
            "the UI must never be left with a roster and no selection"
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn active_project_is_persisted_and_only_a_rostered_path_may_be_set() {
        let (root, first) = fixture("active");
        let second = first.parent().unwrap().join("other_repo");
        fs::create_dir_all(&second).unwrap();
        let second = second.canonicalize().unwrap();

        add_project(&root, "first", &first).unwrap();
        add_project(&root, "second", &second).unwrap();
        set_active_project(&root, &second).unwrap();

        // Re-read from disk: this is the launch-time restore.
        assert_eq!(list_projects(&root).unwrap().active, Some(second));
        assert!(
            set_active_project(&root, &root.join("unknown")).is_err(),
            "activating an unrostered path would point the app at a project it cannot list"
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_corrupt_state_file_errors_rather_than_resetting_the_roster() {
        let (root, _) = fixture("corrupt");
        fs::write(state_path(&root), "{ not json").unwrap();
        let err = list_projects(&root).unwrap_err();
        assert!(err.contains("never silently reset"), "got: {err}");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_missing_state_file_is_a_fresh_install() {
        let (root, _) = fixture("fresh");
        let list = list_projects(&root).unwrap();
        assert!(list.projects.is_empty());
        assert_eq!(list.active, None);
        fs::remove_dir_all(&root).unwrap();
    }
}
