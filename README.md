# dotfiles
## Setting up workspace

Update package installer
```
sudo pacman -Syu --ignore jack2 archlinux-keyring
sudo pacman -Syu --ignore jack2 vim
```

Install custom bash prompt
```
cd $HOME/projects
git clone git@github.com:brujoand/sbp.git
cd $HOME/projects/sbp/bin
bash install
export EDITOR=vim
```


Install terraform
```
sudo pacman -S terraform
or
yay --sync tfenv
```

Install AWS CLI
```
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

Configure your aws access key + access secret
`aws configure`

For initial AWS Terraform Setup (Only run if AWS account is brand new)
Set up the remote state bucket for terraform
```
aws s3api create-bucket \
--bucket $BUCKET_NAME \
--region us-east-1 \
--acl private
```
Set up the state-lock table for terraform
```
aws dynamodb create-table \
--table-name jng-remote-state-lock \
--attribute-definitions AttributeName=LockID,AttributeType=S \
--key-schema AttributeName=LockID,KeyType=HASH \
--provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1 \
--region us-east-1
```
