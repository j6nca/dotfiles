# dotfiles

## macOS

A fast, reproducible macOS setup workflow utilizing **Zsh**, **chezmoi** (via SSH), **mise**, and **Starship**.

---

### 0. Prerequisites

Setup ssh keys with git

```bash
ssh-keygen
```

### 1. Initial Bootstrap

Run this block in a fresh macOS Terminal to install Xcode Command Line Tools, Homebrew, core CLI utilities, and JetBrains Mono Nerd Font:

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install Homebrew
/bin/bash -c "$(curl -fsSL [https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh](https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh))"

# Enable Homebrew for current session
eval "$(/opt/homebrew/bin/brew shellenv)"

# Install core tools & JetBrains Mono Nerd Font
brew install chezmoi mise starship fastfetch zsh-autosuggestions zsh-syntax-highlighting --cask font-jetbrains-mono-nerd-font
```

### 2. Provision dotfiles via chezmoi

```bash
chezmoi init --apply --ssh j6nca/dotfiles
```

### 3. Zsh plugins

```bash
# Homebrew environment
eval "$(/opt/homebrew/bin/brew shellenv)"

# Developer tool runtimes (mise)
eval "$(mise activate zsh)"

# Prompt (Starship)
eval "$(starship init zsh)"

# Zsh Plugins
source $(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh
source $(brew --prefix)/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
```

### 4. Mise tooling

```bash
mise install
```
