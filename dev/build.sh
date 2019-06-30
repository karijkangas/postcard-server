#!/usr/bin/env bash

REGISTRY=127.0.0.1:5000
RELEASE=latest

export REGISTRY
export RELEASE

[[ ! -z "$POSTCARD_ROOT" ]] || { echo 'POSTCARD_ROOT not defined'; exit 1; }
[[ ! -z "$REGISTRY" ]] || { echo 'REGISTRY not defined'; exit 1; }

docker swarm init 2>/dev/null

if [ -z "$(docker service ls | grep registry)" ]
then
  echo Starting local docker registry: ${REGISTRY}
  docker service create --name registry --mount type=volume,source=registry,destination=/var/lib/registry --publish published=5000,target=5000 registry:2
fi

IMAGES=(
  ${REGISTRY}/postcard-api-dev:${RELEASE},${POSTCARD_ROOT}/dev/api.Dockerfile
  ${REGISTRY}/postcard-wss-dev:${RELEASE},${POSTCARD_ROOT}/dev/wss.Dockerfile 
  )

for i in "${IMAGES[@]}"
do
  ii=(${i//,/ })
  name=${ii[0]} 
  file=${ii[1]}
  (cd ${POSTCARD_ROOT} && docker build -f $file -t $name .)
  docker push $name
done
