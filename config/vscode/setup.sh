CONFIG_PATH=~/.config/Code/User/
FILE_NAME=settings.json
mkdir -p $CONFIG_PATH
[ -f $CONFIG_PATH/$FILE_NAME ] && mv $CONFIG_PATH/$FILE_NAME $CONFIG_PATH/$FILE_NAME.backup
ln -s ~/projects/dotfiles/config/vscode/$FILE_NAME $CONFIG_PATH