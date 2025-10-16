pub mod deps;
pub mod fsx;
pub mod net;
pub mod proc;

// tiny stderr helpers (kept local)
pub fn eprintln_err(msg: &str) {
    eprintln!("ERROR: {msg}");
}
pub fn eprintln_warn(msg: &str) {
    eprintln!("WARN: {msg}");
}
