//! Prompt Compose's own data root: `~/.prompt-compose/`.
//!
//! Everything the *app* owns — the project roster and active project
//! (`prompts-state.json`) and any rebuildable indexes — lives under this root,
//! never inside a user's project folder. A project folder is the user's git repo;
//! writing app state into it would dirty their tree on every use, and reading
//! clean diffs is the whole reason the library is Markdown-in-git.
//!
//! This app has no shipped predecessor and no legacy locations to migrate from,
//! so there is deliberately no migration code here — just the root lookup.

use std::path::PathBuf;

/// Resolve the data root: `PROMPT_COMPOSE_DATA_DIR` env override (tests use
/// this), else `~/.prompt-compose`. Does NOT require the directory to exist —
/// writers create what they need under it.
pub fn data_root() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("PROMPT_COMPOSE_DATA_DIR") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    dirs::home_dir()
        .map(|h| h.join(".prompt-compose"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_override_wins_when_set() {
        // Save/restore around the test so we don't leak env state to siblings.
        let prev = std::env::var("PROMPT_COMPOSE_DATA_DIR").ok();
        std::env::set_var("PROMPT_COMPOSE_DATA_DIR", "/tmp/pc-test-root");
        assert_eq!(data_root().unwrap(), PathBuf::from("/tmp/pc-test-root"));

        // A blank override is ignored — falls back to the home-dir default.
        std::env::set_var("PROMPT_COMPOSE_DATA_DIR", "   ");
        assert!(data_root().unwrap().ends_with(".prompt-compose"));

        match prev {
            Some(v) => std::env::set_var("PROMPT_COMPOSE_DATA_DIR", v),
            None => std::env::remove_var("PROMPT_COMPOSE_DATA_DIR"),
        }
    }
}
