#!/usr/bin/env bash
. "$HOME/projects/dotfiles/scripts/common.sh"

# Assumes base dir 'projects'
PROJECT_DIR=~/projects

gitbup () {
  verify

  for project in $PROJECT_DIR/*/; do
      echo "Updating $project ..."
      cd $PROJECT_DIR/$project
      git pull --rebase
  done
}

gitbs () {
  for project in $PROJECT_DIR/*/; do
      echo "Check git status on $project ..."
      cd $BASE_DIR/$project
      git status
  done
}
