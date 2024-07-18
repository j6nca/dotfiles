echo 'source ~/projects/dotfiles/shells/zsh/zshrc' >>~/.zshrc
git clone --depth=1 https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.14.0
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k
~/projects/dotfiles/tools/asdf/setup.sh
# interactive configure
p10k configure