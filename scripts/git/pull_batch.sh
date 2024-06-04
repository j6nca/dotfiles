#!/usr/bin/env bash

# Prompt user if they really want to run this script

# Assumes base dir 'projects'
BASE_DIR=~/projects

PROJECTS=$(ls $BASE_DIR)
echo "Projects found: $PROJECTS"

for project in $PROJECTS; do
    echo "Updating $project ..."
    cd $BASE_DIR/$project
    git pull --rebase
done
