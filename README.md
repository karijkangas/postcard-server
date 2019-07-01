# Postcard server

This project provides the REST API for Postcard service. The service is implemented using NodeJS, Redis, Minio, Postgres, and AWS SES. API is designed using Swagger. Tests are implemented using Jest and Supertest. Local development is done using Docker Swarm. Production deployment is done using Kubernetes and AWS EKS.

## Use cases

API is designed to match the following use cases:

- Service health check
- Register user
- Reset password
- Login user
- Logout user
- Delete user
- Change password, language, avatar
- Change email
- Invite new user
- Accept, reject or block invite
- Upload image for avatar and postcard image
- Send postcard another user
- View received postcards; set as read, remove
- Add postcard sender to friends
- Block postcard sender
- View sent postcards; remove
- View friends; block, unfriend
- View blocked users; unblock
- Events; postcard received, postcard read, set-as-friend

## Architecture

![alt text](design/architecture.svg 'Architecture')

## REST API

REST API is designed using Swagger, see [design/swagger.yaml](design/swagger.yaml). You can generate HTML document from the swagger file by:

```Shell
npm run apidoc
```

The API document is stored as `temp/postcard-api.html`.

## Unit tests

Run unit tests and coverage analysis.

```Shell
npm install
npm test
npm run coverage
```

Detailed coverage analysis results will be stored in `temp/coverage`.

## Development (Docker Swarm)

Install Node and Docker. Development is done in postcard Docker Swarm with project directory and configuration files mounted directly into containers. Api and wss-containers use Nodemon so file changes in src-directory are applied automatically.

Set PORTCARD_ROOT environment variable, build container images and start postcard stack:

```Shell
source setroot.sh
echo $POSTCARD_ROOT

./dev/build.sh
./dev/start.sh

docker stack ps postcard
```

See files in dev-directory for details. Re-run ./dev/start.sh in case of transient `secret not found`-errors.

Wait for postcard_create-schema and postcard_create-buckets containers to complete:

```Shell
docker stack ps postcard | grep postcard_create-schema
docker stack ps postcard | grep postcard_create-buckets
```

Follow container log:

```Shell
docker service logs postcard_api -f
docker service logs postcard_wss -f
```

Run apitest:

```Shell
npm run apitest-dev
```

Cleanup:

```Shell
docker stack rm postcard
docker service rm registry
docker secret rm \$(docker secret ls -q)
docker system prune -a --volumes
docker swarm leave --force
```

Endpoints:

- API: `localhost:4000`
- API container debug: `localhost:4200`
- WSS container debug: `localhost: 4201`
- swagger-editor: `localhost:4100`
- pgadmin: `localhost:4101`
- minio: `localhost:4102`

## Development (Kubernetes with Minikube)

**NOTE**: Currently, this configuration requires some manual AWS setup so it will not work out-of-the-box.

`$POSTCARD_ROOT/prod/minikube` uses local database and filestore.
`$POSTCARD_ROOT/prod/minikube-aws` uses Amazon RDS and S3.

Install minikube and kubectl.

Set environment variables:

```Shell
source setroot.sh
echo $POSTCARD_ROOT
```

Start Minikube cluster and enable ingress.

```Shell
minikube start
minikube addons enable ingress
```

Add minikube ip entry to /etc/hosts:

```Shell
sudo sh -c "echo $(minikube ip) minikube >> /etc/hosts"
cat /etc/hosts
```

Setup Docker client to connect to Minikube Docker service and start Docker registry:

```Shell
eval $(minikube docker-env)
docker run -d -p 5000:5000 --restart=always --name registry registry:2
export REGISTRY=localhost:5000
```

Create `$POSTCARD_ROOT/prod/minikube/SECRETS.env` file with following credentials:

```Shell
POSTCARD_POSTGRES_PASSWORD=XXXX
POSTCARD_S3_ACCESS_KEY=XXXX
POSTCARD_S3_SECRET_ACCESS_KEY=XXXX
POSTCARD_SES_ACCESS_KEY=XXXX
POSTCARD_SES_SECRET_ACCESS_KEY=XXXX
```

Edit `$POSTCARD_ROOT/prod/minikube/environment.env` to match the environment.

Build Docker images and push them to Minikube Docker registry. Start Postcard service using Kustomize.

```Shell
$POSTCARD_ROOT/prod/minikube/build.sh
kubectl apply -k $POSTCARD_ROOT/prod/minikube
```

Get cluster status. Wait for `postcard-create-schema` and `postcard-create-buckets`
jobs to complete:

```Shell
kubectl get all -A

kubectl get pods | grep postcard-create-schema
kubectl get pods | grep postcard-create-buckets
```

Follow pod logs:

```Shell
kubectl get pods
kubectl logs postcard-api-XXXXXXXXX-XXXXX -f
kubectl logs postcard-wss-XXXXXXXXX-XXXXX -f
```

Run production test suite:

```Shell
export POSTCARD_API_ENDPOINT=http://minikube/v1
npm run apitest-prod
```

Cleanup:

```Shell
kubectl delete deployment.apps/postcard-api
kubectl delete deployment.apps/postcard-wss
kubectl delete deployment.apps/postcard-redis
kubectl delete deployment.apps/postcard-postgres
kubectl delete deployment.apps/postcard-minio

kubectl delete job.batch/postcard-create-buckets
kubectl delete job.batch/postcard-create-schema

kubectl delete service/postcard-wss
kubectl delete service/postcard-api
kubectl delete service/postcard-redis
kubectl delete service/postcard-postgres
kubectl delete service/postcard-minio

kubectl delete ingress postcard-ingress
kubectl delete ingress postcard-ingress-to-minio

kubectl delete secrets --all
kubectl delete configmap --all

eval $(docker-machine env -u)
minikube stop
minikube delete
```

## Staging (Amazon EKS)

**NOTE**: Currently, this configuration requires some manual AWS setup so it will not work out-of-the-box.

Install aws-cli and eksctl.

Set environment variables:

```Shell
source setroot.sh
echo $POSTCARD_ROOT
```

```Shell
eval $(aws ecr get-login --no-include-email)
REGISTRY=521453527975.dkr.ecr.eu-west-1.amazonaws.com

RELEASE=1
$POSTCARD_ROOT/prod/eks/build.sh
eksctl create cluster -f $POSTCARD_ROOT/prod/eks/cluster.yaml

kubectl get nodes
eksctl get cluster --name=postcard-staging

kubectl apply -k $POSTCARD_ROOT/prod/eks

kubectl logs -n kube-system $(kubectl get po -n kube-system | egrep -o 'alb-ingress[a-zA-Z0-9-]+') | grep 'postcard-alb'

dig postcard-staging.karijkangas.com

kubectl delete ing postcard-alb
eksctl delete cluster --name=postcard-staging
```
