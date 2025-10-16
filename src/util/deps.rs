use super::{eprintln_err, eprintln_warn};
use which::which;

pub fn have(cmd: &str) -> bool {
    which(cmd).is_ok()
}

pub fn require_cmds(cmds: &[&str]) {
    let missing: Vec<_> = cmds.iter().copied().filter(|c| !have(c)).collect();
    if !missing.is_empty() {
        for c in missing {
            eprintln_err(&format!("Missing required command: {c}"));
        }
        eprintln_err("Please install all required dependencies.");
        std::process::exit(1);
    }
}

pub fn warn_optionals() {
    if !have("curl") && !have("nc") {
        eprintln_warn(
            "Neither 'curl' nor 'nc' found; readiness check uses a built-in TCP connect.",
        );
    }
    if !have("ss") && !have("netstat") {
        eprintln_warn("Neither 'ss' nor 'netstat' found; using bind-probe to find a free port.");
    }
    if !have("xdg-open") {
        eprintln_warn("'xdg-open' not found; not opening a browser automatically.");
    }
}
