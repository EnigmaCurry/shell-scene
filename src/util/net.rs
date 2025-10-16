use crate::util::eprintln_err;
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

pub fn find_free_port(start: u16) -> u16 {
    let first = if start == 0 { 1 } else { start };
    let mut p = first;
    loop {
        match TcpListener::bind(("127.0.0.1", p)) {
            Ok(listener) => {
                drop(listener);
                return p;
            }
            Err(_) => {
                p = p.wrapping_add(1);
                if p == 0 {
                    p = 1;
                }
                if p == first {
                    eprintln_err("No free TCP port found in range 1..=65535.");
                    std::process::exit(1);
                }
            }
        }
    }
}

pub fn wait_for_tcp(host: &str, port: u16, attempts: usize, sleep_ms: u64) {
    for _ in 0..attempts {
        if TcpStream::connect((host, port)).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(sleep_ms));
    }
}
