# copy 'global' tool-versions
cp ~/projects/dotfiles/tools/asdf/tool-versions ~/.tool-versions

# install plugins
# languages
asdf plugin add nodejs # https://github.com/asdf-vm/asdf-nodejs.git
asdf plugin add golang #https://github.com/asdf-community/asdf-golang.git

# infra
asdf plugin add terraform # https://github.com/asdf-community/asdf-hashicorp.git
asdf plugin add awscli    # https://github.com/MetricMike/asdf-awscli.git
asdf plugin-add aws-vault # https://github.com/karancode/asdf-aws-vault.git

# k8s
asdf plugin add talosctl  # https://github.com/bjw-s/asdf-talosctl.git
asdf plugin-add kubectl   # https://github.com/asdf-community/asdf-kubectl.git
asdf plugin-add k9s       # https://github.com/looztra/asdf-k9s
asdf plugin-add flux2     # https://github.com/tablexi/asdf-flux2.git
asdf plugin-add fluxctl   # https://github.com/stefansedich/asdf-fluxctl
asdf plugin-add helm      # https://github.com/Antiarchitect/asdf-helm.git
asdf plugin-add kind      # https://github.com/johnlayton/asdf-kind.git
asdf plugin-add waypoint  # https://github.com/asdf-community/asdf-hashicorp.git


