# Copy
# # For Intel Macs
# [ $(uname -m) = x86_64 ] && curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.24.0/kind-darwin-amd64
# # For M1 / ARM Macs
# [ $(uname -m) = arm64 ] && curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.24.0/kind-darwin-arm64
# chmod +x ./kind
# mv ./kind /usr/local/bin/kind
brew install kind
