#! /usr/bin/env bash

# config paths
SBP_PATH_COLOR=~/.config/sbp/colors.conf
SBP_PATH_SETTINGS=~/.config/sbp/settings.conf

# dotfile paths
SBP_PATH_COLOR_CUSTOM=~/projects/dotfiles/sbp/colors.conf
SBP_PATH_SETTINGS_CUSTOM=~/projects/dotfiles/sbp/settings.conf

if [[ -f "$SBP_PATH_COLOR" ]]; then
    echo "Existing sbp colors file detected, going to back up and overwrite"
    cp $SBP_PATH_COLOR "$SBP_PATH_COLOR.bak"
fi

echo "sym linking colors file ..."
ln -s $SBP_PATH_COLOR_CUSTOM "$SBP_PATH_COLOR.tmp"
mv "$SBP_PATH_COLOR.tmp" $SBP_PATH_COLOR

if [[ -f "$SBP_PATH_SETTINGS" ]]; then
    echo "Existing sbp settings file detected, going to back up and overwrite"
    cp $SBP_PATH_SETTINGS "$SBP_PATH_SETTINGS.bak"
fi

echo "sym linking settings file ..."
ln -s $SBP_PATH_SETTINGS_CUSTOM "$SBP_PATH_SETTINGS.tmp"
mv "$SBP_PATH_SETTINGS.tmp" $SBP_PATH_SETTINGS
