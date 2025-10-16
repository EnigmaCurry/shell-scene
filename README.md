# shell-scene

[![Crates.io](https://img.shields.io/crates/v/shell-scene?color=blue
)](https://crates.io/crates/shell-scene)
[![Coverage](https://img.shields.io/badge/Coverage-Report-purple)](https://EnigmaCurry.github.io/shell-scene/coverage/master/)

# shell-scene

shell-scene records your terminal sessions and creates web
presentations featuring them.

## Install dependencies

This software is developed and tested on GNU/Linux. Support for other
operating systems is not a priority right now.

### Required packages

 * [asciinema](https://docs.asciinema.org/manual/cli/installation/)
 * [tmux](https://github.com/tmux/tmux/wiki/Installing)
 * [ttyd](https://github.com/tsl0922/ttyd?tab=readme-ov-file#installation)
 * [uv](https://docs.astral.sh/uv/)

On Fedora Linux:

```
sudo dnf install asciinema tmux ttyd uv
```

On Arch Linux:

```
sudo pacman -S asciinema tmux ttyd uv
```

On other Linux distros, asciinema and tmux are probably available in
your package manager, but you may need to manually install
[uv](https://docs.astral.sh/uv/) and build
[ttyd](https://github.com/tsl0922/ttyd?tab=readme-ov-file#install-on-linux)
yourself.

## Install shell-scene

[Download the latest release for your platform.](https://github.com/EnigmaCurry/shell-scene/releases)

Or build and install via cargo
([crates.io/crates/shell-scene](https://crates.io/crates/shell-scene)):

```
cargo install shell-scene
```

## Tab completion

To install tab completion support, put this in your `~/.bashrc` (assuming you use Bash):

```
### Bash completion for shell-scene (Put this in ~/.bashrc)
source <(shell-scene completions bash)
```

If you don't like to type out the full name `shell-scene`, you can make
a shorter alias (`h`), as well as enable tab completion for the alias
(`h`):

```
### Alias shell-scene as h (Put this in ~/.bashrc):
alias h=shell-scene
complete -F _shell-scene -o bashdefault -o default h
```

Completion for Zsh and/or Fish has also been implemented, but the
author has not tested this:

```
### Zsh completion for shell-scene (Put this in ~/.zshrc):
autoload -U compinit; compinit; source <(shell-scene completions zsh)

### Fish completion for shell-scene (Put this in ~/.config/fish/config.fish):
shell-scene completions fish | source
```

## Usage

```
$ shell-scene

Usage: shell-scene [OPTIONS] [COMMAND]

Commands:
  record       Record an asciicast via ttyd
  completions  Generates shell completions script (tab completion)
  help         Print this message or the help of the given subcommand(s)

Options:
      --log <LEVEL>  Sets the log level, overriding the RUST_LOG environment variable. [possible values: trace, debug, info, warn, error]
  -v                 Sets the log level to debug.
  -h, --help         Print help
  -V, --version      Print version
```

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md)
