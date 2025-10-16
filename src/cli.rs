use clap::builder::BoolishValueParser;
use clap::{value_parser, Arg, ArgAction, Command};
use clap_complete::shells::Shell;
use std::io;
use std::path::PathBuf;

fn leak_str(s: &str) -> &'static str {
    // returns a &'static str for the life of the process.
    Box::leak(s.to_owned().into_boxed_str())
}

pub fn app(binary_name: &str) -> Command {
    Command::new(leak_str(binary_name))
        .version(env!("CARGO_PKG_VERSION"))
        .author(env!("CARGO_PKG_AUTHORS"))
        .about(env!("CARGO_PKG_DESCRIPTION"))
        // Global logging controls
        .arg(
            Arg::new("log")
                .long("log")
                .global(true)
                .num_args(1)
                .value_name("LEVEL")
                .value_parser(["trace", "debug", "info", "warn", "error"])
                .help("Sets the log level, overriding the RUST_LOG environment variable."),
        )
        .arg(
            Arg::new("verbose")
                .short('v')
                .global(true)
                .help("Sets the log level to debug.")
                .action(clap::ArgAction::SetTrue),
        )
        // --- record (user-facing) ---
        .subcommand(
            Command::new("record")
                .about("Record an asciicast via ttyd")
                .arg(
                    Arg::new("session")
                        .long("session")
                        .num_args(1)
                        .value_name("NAME")
                        .env("SESSION")
                        .default_value("cast")
                        .help("tmux session name"),
                )
                .arg(
                    Arg::new("cols")
                        .long("cols")
                        .num_args(1)
                        .value_name("N")
                        .env("TMUX_COLS")
                        .value_parser(value_parser!(u32))
                        .default_value("80")
                        .help("tmux cols"),
                )
                .arg(
                    Arg::new("rows")
                        .long("rows")
                        .num_args(1)
                        .value_name("N")
                        .env("TMUX_ROWS")
                        .value_parser(value_parser!(u32))
                        .default_value("24")
                        .help("tmux rows"),
                )
                .arg(
                    Arg::new("port")
                        .long("port")
                        .num_args(1)
                        .value_name("PORT")
                        .env("TT_PORT")
                        .value_parser(value_parser!(u16))
                        .default_value("7681")
                        .help("starting port for ttyd"),
                )
                .arg(
                    Arg::new("font_size")
                        .long("font-size")
                        .num_args(1)
                        .value_name("PT")
                        .env("FONT_SIZE")
                        .value_parser(value_parser!(u32))
                        .default_value("24")
                        .help("font size for ttyd"),
                )
                .arg(
                    Arg::new("out")
                        .long("out")
                        .num_args(1)
                        .value_name("PATH")
                        .env("ASCII_OUT")
                        .value_parser(value_parser!(PathBuf))
                        .help("ascii output path (.cast). Default set dynamically."),
                )
                .arg(
                    Arg::new("workdir")
                        .long("workdir")
                        .num_args(1)
                        .value_name("PATH")
                        .env("WORKING_DIRECTORY")
                        .value_parser(value_parser!(PathBuf))
                        .help("working directory for tmux session. Default: $HOME"),
                )
                .arg(
                    Arg::new("kill_on_detach")
                        .long("kill-on-detach")
                        .env("TMUX_KILL_ON_DETACH")
                    // accept as a flag OR with an optional value
                        .num_args(0..=1)
                        .require_equals(false)
                    // if provided without a value, treat as "true"
                        .default_missing_value("true")
                    // parse 1/0, true/false, yes/no, on/off
                        .value_parser(BoolishValueParser::new())
                    // store the parsed bool
                        .action(ArgAction::Set)
                        .help("Kill tmux session after detach (supports true/false/1/0/yes/no/on/off)"),
                ),
        )
        // --- record-hook (internal) ---
        .subcommand(
            Command::new("record-hook")
                .about("INTERNAL: tmux/asciinema worker invoked inside ttyd")
                .hide(true)
                .arg(
                    Arg::new("child")
                        .long("child")
                        .action(clap::ArgAction::SetTrue),
                )
                .arg(
                    Arg::new("session")
                        .long("session")
                        .num_args(1)
                        .value_name("NAME")
                        .env("SESSION")
                        .default_value("cast"),
                )
                .arg(
                    Arg::new("cols")
                        .long("cols")
                        .num_args(1)
                        .value_name("N")
                        .env("TMUX_COLS")
                        .value_parser(value_parser!(u32))
                        .default_value("80"),
                )
                .arg(
                    Arg::new("rows")
                        .long("rows")
                        .num_args(1)
                        .value_name("N")
                        .env("TMUX_ROWS")
                        .value_parser(value_parser!(u32))
                        .default_value("24"),
                )
                .arg(
                    Arg::new("out")
                        .long("out")
                        .num_args(1)
                        .value_name("PATH")
                        .env("ASCII_OUT")
                        .value_parser(value_parser!(PathBuf))
                        .help("ascii output path (.cast). Default set dynamically."),
                )
                .arg(
                    Arg::new("workdir")
                        .long("workdir")
                        .num_args(1)
                        .value_name("PATH")
                        .env("WORKING_DIRECTORY")
                        .value_parser(value_parser!(PathBuf))
                        .help("working directory for tmux session. Default: $HOME"),
                )
                .arg(
                    Arg::new("kill_on_detach")
                        .long("kill-on-detach")
                        .env("TMUX_KILL_ON_DETACH")
                        .action(clap::ArgAction::SetTrue),
                ),
        )
        // --- completions ---
        .subcommand(
            Command::new("completions")
                .about("Generates shell completions script (tab completion)")
                .arg(
                    Arg::new("shell")
                        .help("The shell to generate completions for")
                        .required(false)
                        .value_parser(["bash", "zsh", "fish"]),
                ),
        )
}

pub fn generate_completion_script(shell: Shell, binary_name: &str) {
    clap_complete::generate(shell, &mut app(binary_name), binary_name, &mut io::stdout())
}

pub fn print_completion_instructions(binary_name: &str) {
    eprintln!("### Instructions to enable tab completion for {binary_name}\n");
    eprintln!("### Bash (~/.bashrc)\n  source <({binary_name} completions bash)\n");
    eprintln!("### Fish (~/.config/fish/config.fish)\n  {binary_name} completions fish | source\n");
    eprintln!("### Zsh (~/.zshrc)\n  autoload -U compinit; compinit; source <({binary_name} completions zsh)");
}
