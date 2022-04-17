# Set up for ubuntu work station
## VirtualBox
### Shared Clipboard
Ensure VB Extension Pack is installed and enabled in `File > Preferences > Extensions`
as well as desired clipboard settings in `Devices > Shared Clipboard`
```
sudo apt-get install virtualbox-guest-x11
sudo VBoxClient --clipboard
```
## Customization
### Powerline Prompt
```
cd $HOME/projects
git clone git@github.com:brujoand/sbp.git
cd $HOME/projects/sbp/bin
bash install
export EDITOR=vim
sudo apt-get install fonts-powerline
```
The above needs pcregrep for kubernetes context prompts
```
sudo apt-get install -y pcregrep
```

### Setup shell configs
```
TODO add source for bashrc
```

## Tools

### Terraform
```
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo apt-key add -
sudo apt-add-repository "deb [arch=amd64] https://apt.releases.hashicorp.com $(lsb_release -cs) main"
sudo apt-get update && sudo apt-get install terraform
terraform --version
```

### AWS CLI
```
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

### Kubectl
```
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
curl -LO "https://dl.k8s.io/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl.sha256"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
kubectl version --client
```

### Linkerd
```
curl --proto '=https' --tlsv1.2 -sSfL https://run.linkerd.io/install | sh
```
### Nodejs
```
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.8/install.sh | bash

```

### Docker
```
sudo apt  install docker.io
sudo apt  install docker-compose
```

### Helm
```
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
chmod 700 get_helm.sh
./get_helm.sh
```

### Dagger
```
cd /usr/local
sudo curl -L https://dl.dagger.io/dagger/install.sh | sudo sh
```

# Troubleshooting
gnome-shell issues:
```
killall -HUP gnome-shell
```

# TODOs
- bash prompt for terraform workspace (if ever used)
- use friendlier cluster name in prompt for eks clusters
- aws profile prompt?
