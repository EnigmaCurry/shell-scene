# shell-scene

[![Crates.io](https://img.shields.io/crates/v/shell-scene?color=blue
)](https://crates.io/crates/shell-scene)
[![Coverage](https://img.shields.io/badge/Coverage-Report-purple)](https://EnigmaCurry.github.io/shell-scene/coverage/master/)


## Install

[Download the latest release for your platform.](https://github.com/EnigmaCurry/shell-scene/releases)

Or install via cargo ([crates.io/crates/shell-scene](https://crates.io/crates/shell-scene)):

```
cargo install shell-scene
```

### Tab completion

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

Options:
  -h, --help                  Print help
  -V, --version               Print version
```

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md)
