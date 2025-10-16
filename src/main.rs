mod cli;
mod engine;
mod logging;
mod util;

use clap_complete::shells::Shell;

const BIN_NAME: &str = env!("CARGO_BIN_NAME");

fn main() {
    let mut cmd = cli::app(BIN_NAME);
    let matches = cmd.clone().get_matches();
    logging::init_from_matches(&matches);

    if matches.subcommand_name().is_none() {
        cmd.print_help().unwrap();
        println!();
        return;
    }

    let exit_code = match matches.subcommand() {
        Some(("record", m)) => engine::record::run_record(m),
        Some(("record-hook", m)) => engine::record::run_record_hook(m),
        Some(("completions", m)) => {
            if let Some(shell) = m.get_one::<String>("shell") {
                let sh = match shell.as_str() {
                    "bash" => Shell::Bash,
                    "zsh" => Shell::Zsh,
                    "fish" => Shell::Fish,
                    s => {
                        eprintln!("Unsupported shell: {s}");
                        return;
                    }
                };
                cli::generate_completion_script(sh, BIN_NAME);
                0
            } else {
                cli::print_completion_instructions(BIN_NAME);
                1
            }
        }
        _ => 1,
    };

    std::process::exit(exit_code);
}
