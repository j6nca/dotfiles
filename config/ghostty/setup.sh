mkdir -p ~/.config/ghostty
[ -f ~/.config/ghostty/config ] && mv ~/.config/ghostty/config ~/.config/ghostty/config.backup
ln -s ~/projects/dotfiles/config/ghostty/config ~/.config/ghostty/config