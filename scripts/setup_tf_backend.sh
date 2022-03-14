DEPLOYMENT_NAME="jng"
aws s3api create-bucket \
--bucket $DEPLOYMENT_NAME-remote-state \
--region us-east-1 \
--acl private

aws dynamodb create-table \
--table-name $DEPLOYMENT_NAME-remote-state-lock \
--attribute-definitions AttributeName=LockID,AttributeType=S \
--key-schema AttributeName=LockID,KeyType=HASH \
--provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1 \
--region us-east-1
