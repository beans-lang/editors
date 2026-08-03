//! Beans support for Zed.
//!
//! Like the VS Code client, this is a thin shell around `beansc lsp`. It finds
//! the compiler and hands Zed a command; every language feature is negotiated
//! over LSP from the compiler's own server. Nothing here re-implements
//! completion, hover, diagnostics or anything else the compiler already knows.
//!
//! Zed's extension guidelines say an extension must not ship a language
//! server, and must instead locate one in the user's environment. That is
//! exactly what this does — there is no published Beans binary to download.

use zed_extension_api::{
    self as zed, settings::LspSettings, Command, LanguageServerId, Result, Worktree,
};

/// Must match `[language_servers.beansc]` in extension.toml.
const SERVER_ID: &str = "beansc";
const EXECUTABLE: &str = "beansc";

/// Relative locations of a compiler built from source, tried against the
/// worktree root. `beans` and `editors` are normally checked out side by side,
/// and there is no released binary to install yet.
const DEVELOPMENT_PATHS: &[&str] = &[
    "build/beansc",
    "beans/build/beansc",
    "../beans/build/beansc",
];

struct BeansExtension;

/// Runs `candidate --version` to check the path really is a working compiler.
///
/// An extension has no filesystem API, so this stands in for a stat — and it
/// proves more than a stat would, because a file that exists but cannot run is
/// no use here either.
fn is_working_compiler(candidate: &str) -> bool {
    zed::process::Command::new(candidate)
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status == Some(0))
}

/// Joins a worktree-relative path onto the worktree root.
fn in_worktree(worktree: &Worktree, relative: &str) -> String {
    let root = worktree.root_path();
    let separator = if root.ends_with('/') || root.ends_with('\\') {
        ""
    } else {
        "/"
    };
    format!("{root}{separator}{relative}")
}

/// Resolves `beansc` in the documented order:
///
///   1. the `lsp.beansc.binary.path` Zed setting
///   2. the `BEANSC` environment variable
///   3. `beansc` on the worktree's `PATH`
///   4. a source build under the worktree
///
/// On failure, returns everything that was tried so the message can name real
/// locations instead of guessing.
fn resolve_compiler(
    worktree: &Worktree,
    configured: Option<&str>,
) -> std::result::Result<String, Vec<String>> {
    let mut tried = Vec::new();

    // 1. An explicit setting. If it is set but does not work, that is an error
    //    rather than a reason to fall through: quietly starting a different
    //    compiler than the one configured would be worse than failing.
    if let Some(path) = configured.map(str::trim).filter(|path| !path.is_empty()) {
        tried.push(format!("{path} (lsp.beansc.binary.path)"));
        return if is_working_compiler(path) {
            Ok(path.to_string())
        } else {
            Err(tried)
        };
    }

    // 2. BEANSC — the same variable beans/test/lsp_server.sh uses.
    if let Some((_, path)) = worktree
        .shell_env()
        .into_iter()
        .find(|(key, value)| key == "BEANSC" && !value.trim().is_empty())
    {
        tried.push(format!("{path} (BEANSC)"));
        return if is_working_compiler(&path) {
            Ok(path)
        } else {
            Err(tried)
        };
    }

    // 3. The worktree's PATH.
    match worktree.which(EXECUTABLE) {
        Some(path) => {
            tried.push(format!("{path} (PATH)"));
            if is_working_compiler(&path) {
                return Ok(path);
            }
        }
        None => tried.push(format!("{EXECUTABLE} on PATH")),
    }

    // 4. A compiler built from source next to the worktree.
    for relative in DEVELOPMENT_PATHS {
        let candidate = in_worktree(worktree, relative);
        tried.push(candidate.clone());
        if is_working_compiler(&candidate) {
            return Ok(candidate);
        }
    }

    Err(tried)
}

fn not_found_message(server: &LanguageServerId, tried: &[String]) -> String {
    let list = tried
        .iter()
        .map(|entry| format!("  {entry}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Could not find the Beans compiler, so `{server}` did not start.\n\n\
         Set it explicitly in your Zed settings:\n\
         \x20 \"lsp\": {{ \"beansc\": {{ \"binary\": {{ \"path\": \"/path/to/beansc\" }} }} }}\n\n\
         There is no published Beans binary yet — build it from the beans \
         repository with `make`, which leaves it at `build/beansc`.\n\n\
         Tried:\n{list}"
    )
}

impl zed::Extension for BeansExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Command> {
        let binary = LspSettings::for_worktree(SERVER_ID, worktree)
            .ok()
            .and_then(|settings| settings.binary);

        let configured = binary.as_ref().and_then(|binary| binary.path.as_deref());

        let command = resolve_compiler(worktree, configured)
            .map_err(|tried| not_found_message(language_server_id, &tried))?;

        // `lsp` unless the user overrode the arguments. Zed spawns this
        // directly, so a path containing spaces needs no quoting.
        let args = binary
            .as_ref()
            .and_then(|binary| binary.arguments.clone())
            .unwrap_or_else(|| vec!["lsp".to_string()]);

        let mut env = worktree.shell_env();
        if let Some(extra) = binary.and_then(|binary| binary.env) {
            env.extend(extra);
        }

        Ok(Command { command, args, env })
    }
}

zed::register_extension!(BeansExtension);
