# dotfiles
## Setting up workspace

Update package installer
```
sudo pacman -Syu --ignore jack2 archlinux-keyring
sudo pacman -Syu --ignore jack2 vim
```

Install custom bash prompt
```
cd $HOME/projects
git clone git@github.com:brujoand/sbp.git
cd $HOME/projects/sbp/bin
bash install
export EDITOR=vim
```


Install terraform
```
sudo pacman -S terraform
or
yay --sync tfenv
```
