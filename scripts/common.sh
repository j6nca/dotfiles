#!/usr/bin/env bash

# Prompt user if they really want to run this script
verify () {
  read -p "Do you really want to run this script? " yn
  case $yn in
    [Yy]* ) make install; break;;
    [Nn]* ) exit;;
    * ) echo "Please answer yes or no.";;
  esac
}