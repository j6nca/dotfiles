# Set up for ubuntu work station

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
