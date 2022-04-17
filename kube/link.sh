#! /usr/bin/env bash

# config paths
KUBE_CONFIG_PATH=~/.kube/config

# dotfile paths
KUBE_CONFIG_PATH_CUSTOM=~/projects/dotfiles/kube/config

if [[ -f "$KUBE_CONFIG_PATH" ]]; then
    echo "Existing kube config file detected, going to back up and overwrite"
    cp $KUBE_CONFIG_PATH "$KUBE_CONFIG_PATH.bak"
fi

ln -s $KUBE_CONFIG_PATH_CUSTOM "$KUBE_CONFIG_PATH.tmp"
mv "$KUBE_CONFIG_PATH.tmp" $KUBE_CONFIG_PATH