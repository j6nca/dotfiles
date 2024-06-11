#!/usr/bin/env bash
. "$HOME/projects/dotfiles/scripts/common.sh"

gitbup () {
  verify
  # Assumes base dir 'projects'
  BASE_DIR=~/projects

  PROJECTS=$(ls $BASE_DIR)

  for project in $PROJECTS; do
      echo "Updating $project ..."
      cd $BASE_DIR/$project
      git pull --rebase
  done
  echo "Git batch update complete!"
}