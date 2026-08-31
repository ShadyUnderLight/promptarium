//! Prompt Library backend.
//!
//! The native side owns the project roster, YAML frontmatter and every
//! filesystem operation that can modify user data. Prompt variables remain
//! frontend-only so the application has exactly one variable parser.

mod appstate;
mod store;

pub mod state;
