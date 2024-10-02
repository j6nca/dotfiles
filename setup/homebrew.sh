/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo >> /Users/j6n/.zprofile
echo 'eval "$(/usr/local/bin/brew shellenv)"' >> /Users/j6n/.zprofile
eval "$(/usr/local/bin/brew shellenv)"