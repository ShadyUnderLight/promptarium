//! Read-only Git history for tracked prompt files.
//!
//! Git is a history source only: no init, commit, push or other writes.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::store;

const DEFAULT_HISTORY_LIMIT: usize = 50;
const FIELD_SEP: char = '\x1f';
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryInfo {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileCommit {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_email: Option<String>,
    pub authored_at: i64,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileHistoryPage {
    pub commits: Vec<GitFileCommit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub tracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub patch: String,
}

pub fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn repository_info(project: &Path) -> Result<GitRepositoryInfo, String> {
    if !git_available() {
        return Ok(GitRepositoryInfo {
            available: false,
            repository_root: None,
            reason: Some("git-unavailable".to_string()),
        });
    }
    let project_root = store::project_root(project)?;
    match find_repository_root(&project_root)? {
        Some(root) => Ok(GitRepositoryInfo {
            available: true,
            repository_root: Some(root.to_string_lossy().into_owned()),
            reason: None,
        }),
        None => Ok(GitRepositoryInfo {
            available: false,
            repository_root: None,
            reason: Some("not-a-repository".to_string()),
        }),
    }
}

pub fn file_history(
    project: &Path,
    name: &str,
    limit: Option<usize>,
    cursor: Option<&str>,
) -> Result<GitFileHistoryPage, String> {
    if !git_available() {
        return Ok(GitFileHistoryPage {
            commits: Vec::new(),
            next_cursor: None,
            tracked: false,
        });
    }
    let repo_root = match repository_root_for_project(project)? {
        Some(root) => root,
        None => {
            return Ok(GitFileHistoryPage {
                commits: Vec::new(),
                next_cursor: None,
                tracked: false,
            });
        }
    };
    let file_path = store::prompt_absolute_path(project, name)?;
    let git_path = path_to_git_relative(&repo_root, &file_path)?;
    let tracked = is_tracked(&repo_root, &git_path)?;
    if !tracked {
        return Ok(GitFileHistoryPage {
            commits: Vec::new(),
            next_cursor: None,
            tracked: false,
        });
    }
    let limit = limit.unwrap_or(DEFAULT_HISTORY_LIMIT).clamp(1, 100);
    let skip = cursor
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let format = format!("%H{sep}%h{sep}%an{sep}%ae{sep}%at{sep}%s", sep = FIELD_SEP);
    let mut args = vec![
        "-C".to_string(),
        repo_root.to_string_lossy().into_owned(),
        "log".to_string(),
        "--follow".to_string(),
        format!("--format={format}"),
        "-n".to_string(),
        limit.to_string(),
    ];
    if skip > 0 {
        args.push(format!("--skip={skip}"));
    }
    args.push("--".to_string());
    args.push(git_path);
    let output = run_git_args(&args)?;
    let commits = parse_log_output(&output)?;
    let next_cursor = if commits.len() == limit {
        Some((skip + limit).to_string())
    } else {
        None
    };
    Ok(GitFileHistoryPage {
        commits,
        next_cursor,
        tracked: true,
    })
}

pub fn file_diff(project: &Path, name: &str, commit: &str) -> Result<GitFileDiff, String> {
    validate_commit_ref(commit)?;
    let repo_root = repository_root_for_project(project)?
        .ok_or_else(|| "project is not in a git repository".to_string())?;
    let file_path = store::prompt_absolute_path(project, name)?;
    let git_path = path_to_git_relative(&repo_root, &file_path)?;
    let parent = resolve_parent(&repo_root, commit)?;
    let patch = if let Some(parent) = parent.as_deref() {
        run_git_in_repo(
            &repo_root,
            &["diff", parent, commit, "--", git_path.as_str()],
        )?
    } else {
        run_git_in_repo(
            &repo_root,
            &["diff", EMPTY_TREE, commit, "--", git_path.as_str()],
        )?
    };
    Ok(GitFileDiff {
        commit: commit.to_string(),
        parent,
        patch,
    })
}

fn repository_root_for_project(project: &Path) -> Result<Option<PathBuf>, String> {
    if !git_available() {
        return Ok(None);
    }
    let project_root = store::project_root(project)?;
    find_repository_root(&project_root)
}

fn find_repository_root(start: &Path) -> Result<Option<PathBuf>, String> {
    let output = match Command::new("git")
        .arg("-C")
        .arg(start)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
    {
        Ok(output) => output,
        Err(error) => return Err(format!("git command failed: {error}")),
    };
    if !output.status.success() {
        return Ok(None);
    }
    let root = String::from_utf8(output.stdout)
        .map_err(|error| error.to_string())?
        .trim()
        .to_string();
    if root.is_empty() {
        return Ok(None);
    }
    Ok(Some(PathBuf::from(root)))
}

fn path_to_git_relative(repo_root: &Path, file_path: &Path) -> Result<String, String> {
    let repo_root = repo_root
        .canonicalize()
        .map_err(|error| format!("{}: {error}", repo_root.display()))?;
    let file_path = file_path
        .canonicalize()
        .map_err(|error| format!("{}: {error}", file_path.display()))?;
    match file_path.strip_prefix(&repo_root) {
        Ok(relative) => Ok(relative.to_string_lossy().replace('\\', "/")),
        Err(_) => Err(format!(
            "prompt path is outside the git repository: {}",
            file_path.display()
        )),
    }
}

fn is_tracked(repo_root: &Path, git_path: &str) -> Result<bool, String> {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("ls-files")
        .arg("--error-unmatch")
        .arg("--")
        .arg(git_path)
        .status()
        .map_err(|error| format!("git command failed: {error}"))?;
    Ok(status.success())
}

fn resolve_parent(repo_root: &Path, commit: &str) -> Result<Option<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg(format!("{commit}^"))
        .output()
        .map_err(|error| format!("git command failed: {error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let parent = String::from_utf8(output.stdout)
        .map_err(|error| error.to_string())?
        .trim()
        .to_string();
    if parent.is_empty() {
        Ok(None)
    } else {
        Ok(Some(parent))
    }
}

fn validate_commit_ref(commit: &str) -> Result<(), String> {
    if commit.trim().is_empty() {
        return Err("commit hash cannot be empty".to_string());
    }
    if commit.starts_with('-') {
        return Err(format!("invalid commit hash: {commit}"));
    }
    if !commit
        .chars()
        .all(|ch| ch.is_ascii_hexdigit() || matches!(ch, '@' | '_' | '.' | '~' | '^'))
    {
        return Err(format!("invalid commit hash: {commit}"));
    }
    Ok(())
}

fn run_git_args(args: &[String]) -> Result<String, String> {
    let mut command = Command::new("git");
    for arg in args {
        command.arg(arg);
    }
    let output = command
        .output()
        .map_err(|error| format!("git command failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("git command failed".to_string());
        }
        return Err(stderr);
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn run_git_in_repo(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_root);
    for arg in args {
        command.arg(*arg);
    }
    let output = command
        .output()
        .map_err(|error| format!("git command failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("git command failed".to_string());
        }
        return Err(stderr);
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_log_output(output: &str) -> Result<Vec<GitFileCommit>, String> {
    let mut commits = Vec::new();
    for line in output.lines().filter(|line| !line.is_empty()) {
        let parts: Vec<&str> = line.split(FIELD_SEP).collect();
        if parts.len() != 6 {
            return Err(format!("unexpected git log format: {line}"));
        }
        let authored_at = parts[4]
            .parse::<i64>()
            .map_err(|error| format!("invalid authoredAt in git log: {error}"))?;
        commits.push(GitFileCommit {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            author_name: parts[2].to_string(),
            author_email: Some(parts[3].to_string()).filter(|email| !email.is_empty()),
            authored_at,
            subject: parts[5].to_string(),
        });
    }
    Ok(commits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    fn tmp_dir(name: &str) -> PathBuf {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("git-test-fixtures");
        fs::create_dir_all(&root).unwrap();
        root.join(format!("{name}-{}", Uuid::new_v4()))
    }

    fn git_ready() -> bool {
        git_available()
    }

    fn run_git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(cwd)
            .args(args)
            .status()
            .expect("git command");
        assert!(
            status.success(),
            "git {:?} failed in {}",
            args,
            cwd.display()
        );
    }

    fn init_repo(root: &Path) {
        let template = root.join("_empty_git_template");
        fs::create_dir_all(&template).unwrap();
        let status = Command::new("git")
            .current_dir(root)
            .env("GIT_TEMPLATE_DIR", &template)
            .args(["init"])
            .status()
            .expect("git init");
        assert!(status.success(), "git init failed in {}", root.display());
        run_git(root, &["config", "user.email", "test@example.com"]);
        run_git(root, &["config", "user.name", "Test User"]);
    }

    fn write_prompt(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn commit_all(root: &Path, message: &str) {
        run_git(root, &["add", "-A"]);
        run_git(root, &["commit", "-m", message]);
    }

    #[test]
    fn project_outside_git_repo_reports_not_a_repository() {
        if !git_ready() {
            return;
        }
        // Use the OS temp dir so the fixture is not inside the enclosing checkout.
        let dir = std::env::temp_dir().join(format!("promptarium-git-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let info = repository_info(&dir).unwrap();
        assert_eq!(
            info,
            GitRepositoryInfo {
                available: false,
                repository_root: None,
                reason: Some("not-a-repository".to_string()),
            }
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn project_at_repo_root_returns_history() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("root");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "review.md", "Review this PR.");
        commit_all(&dir, "Initial review prompt");
        write_prompt(&dir, "review.md", "Review this PR for regressions.");
        commit_all(&dir, "Refine review criteria");

        let info = repository_info(&dir).unwrap();
        assert!(info.available);
        assert!(info.repository_root.is_some());

        let page = file_history(&dir, "review", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 2);
        assert_eq!(page.commits[0].subject, "Refine review criteria");

        let diff = file_diff(&dir, "review", &page.commits[0].hash).unwrap();
        assert!(diff.patch.contains('-'));
        assert!(diff.patch.contains('+'));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn project_in_repo_subdirectory_resolves_paths() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("subdir");
        let prompts = dir.join("prompts");
        fs::create_dir_all(&prompts).unwrap();
        init_repo(&dir);
        write_prompt(&prompts, "coding/review-pr.md", "Review this PR.");
        commit_all(&dir, "Add review prompt");

        let info = repository_info(&prompts).unwrap();
        assert!(info.available);

        let page = file_history(&prompts, "coding/review-pr", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn untracked_prompt_returns_not_tracked_without_error() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("untracked");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "draft.md", "Not committed yet.");
        let page = file_history(&dir, "draft", None, None).unwrap();
        assert!(!page.tracked);
        assert!(page.commits.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn root_commit_diff_is_available() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("root-commit");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "first.md", "First version.");
        commit_all(&dir, "Root commit");
        let page = file_history(&dir, "first", None, None).unwrap();
        let diff = file_diff(&dir, "first", &page.commits[0].hash).unwrap();
        assert!(diff.parent.is_none());
        assert!(diff.patch.contains('+'));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rename_follows_history() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("rename");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "old-name.md", "Version one.");
        commit_all(&dir, "Add prompt");
        fs::rename(dir.join("old-name.md"), dir.join("new-name.md")).unwrap();
        commit_all(&dir, "Rename prompt");

        let page = file_history(&dir, "new-name", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 2);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn filename_with_spaces_is_supported() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("spaces");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "my prompt.md", "Spaced filename.");
        commit_all(&dir, "Add spaced prompt");
        let page = file_history(&dir, "my prompt", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn malicious_prompt_name_does_not_inject_git_options() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("option-inject");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "--help.md", "Safe content.");
        commit_all(&dir, "Add oddly named prompt");
        let page = file_history(&dir, "--help", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn invalid_commit_hash_is_rejected() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("bad-commit");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "review.md", "Body");
        commit_all(&dir, "Initial");
        let error = file_diff(&dir, "review", "--help").unwrap_err();
        assert!(error.contains("invalid commit hash"));
        fs::remove_dir_all(&dir).ok();
    }
}
