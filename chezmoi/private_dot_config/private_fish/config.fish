if status is-interactive
# Commands to run in interactive sessions can go here
end
eval "$(mise activate fish)"

# eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv fish)"

# install fishline
if status is-interactive
    set FLINE_PATH $HOME/.config/fish/fishline
    source $FLINE_PATH/init.fish
end