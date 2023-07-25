# Set up for ubuntu work station

## Customization
### Git
```
sudo apt install git
```

### Zsh
```
sudo apt install zsh
chsh -s $(which zsh)
sh -c "$(wget https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh -O -)"
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ~/powerlevel10k
```

### asdf
```
sudo apt install git
```

### asdf workspace install
```
HELM_VERSION=3.11.1
CHEZMOI_VERSION=2.33.0
asdf install helm $HELM_VERSION
asdf plugin add chezmoi && asdf install chezmoi $CHEZMOI_VERSION
```

### k3s
```
sudo apt install curl
curl -sfL https://get.k3s.io | sh -
```
### k9s
```
sudo apt install snap
snap install k9s
```
### kubectx
```
sudo git clone https://github.com/ahmetb/kubectx /opt/kubectx
sudo ln -s /opt/kubectx/kubectx /usr/local/bin/kubectx
sudo ln -s /opt/kubectx/kubens /usr/local/bin/kubens
```
### helm
```
asdf install helm $ASDF_VERSION
```
### argocd
```
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd -n argocd --create-namespace
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
# ArgoCD CLI
brew install argocd
```
### k8s cluster tools
```
# cert-manager
helm repo add jetstack https://charts.jetstack.io
helm install \
  cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version v1.11.0 \
  --set installCRDs=true

# external-dns
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install external-dns -n kube-ops bitnami/external-dns

# nginx ingress controller
helm upgrade --install ingress-nginx ingress-nginx \ 
  --repo https://kubernetes.github.io/ingress-nginx \ 
  --namespace kube-ops
```
### brew
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
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
mouse issues:
```
sudo modprobe -r psmouse
sudo modprobe psmouse proto=imps
```

# TODOs
- bash prompt for terraform workspace (if ever used)
- use friendlier cluster name in prompt for eks clusters
- aws profile prompt?

## VirtualBox
### Shared Clipboard
Ensure VB Extension Pack is installed and enabled in `File > Preferences > Extensions`
as well as desired clipboard settings in `Devices > Shared Clipboard`
```
sudo apt-get install virtualbox-guest-x11
sudo VBoxClient --clipboard
```