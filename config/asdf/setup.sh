# install plugins
# languages
asdf plugin add nodejs # https://github.com/asdf-vm/asdf-nodejs.git
asdf plugin add golang # https://github.com/asdf-community/asdf-golang.git
asdf plugin add python # https://github.com/asdf-community/asdf-python

# infra
asdf plugin add terraform # https://github.com/asdf-community/asdf-hashicorp.git
asdf plugin add awscli    # https://github.com/MetricMike/asdf-awscli.git
asdf plugin-add aws-vault # https://github.com/karancode/asdf-aws-vault.git

# k8s
asdf plugin add talosctl  # https://github.com/bjw-s/asdf-talosctl.git
asdf plugin add kubectl   # https://github.com/asdf-community/asdf-kubectl.git
asdf plugin add k9s       # https://github.com/looztra/asdf-k9s
asdf plugin add flux2     # https://github.com/tablexi/asdf-flux2.git
asdf plugin add fluxctl   # https://github.com/stefansedich/asdf-fluxctl
asdf plugin add helm      # https://github.com/Antiarchitect/asdf-helm.git
asdf plugin add kind      # https://github.com/johnlayton/asdf-kind.git
asdf plugin add waypoint  # https://github.com/asdf-community/asdf-hashicorp.git

# tools
asdf plugin add sops # https://github.com/feniix/asdf-sops.git

# Set 'global' tool-versions
# cp ~/projects/dotfiles/tools/asdf/tool-versions ~/.tool-versions
asdf global fluxctl 1.25.4
asdf global flux2 2.3.0
asdf global helm 3.15.1
asdf global kubectl 1.30.1
asdf global k9s 0.32.4
asdf global talosctl 1.7.4
asdf global kind 0.23.0
asdf global sops 3.9.0
asdf global awscli 2.17.19
asdf global aws-vault 7.2.0
