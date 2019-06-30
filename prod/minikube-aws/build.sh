#!/usr/bin/env bash

[[ ! -z "$POSTCARD_ROOT" ]] || { echo 'POSTCARD_ROOT not defined'; exit 1; }
[[ ! -z "$REGISTRY" ]] || { echo 'REGISTRY not defined'; exit 1; }
[[ ! -z "$RELEASE" ]] || { echo 'RELEASE not defined'; exit 1; }

[ -x "$(command -v kustomize)" ] || { echo 'kustomize not found'; exit 1; }
DIR=$(dirname "$0")

npm run build-prod
cp $POSTCARD_ROOT/design/database-schema.sql $DIR/

IMAGES=(
  postcard-api,$REGISTRY/postcard-api-prod:$RELEASE,$POSTCARD_ROOT/prod/api.Dockerfile
  postcard-wss,$REGISTRY/postcard-wss-prod:$RELEASE,$POSTCARD_ROOT/prod/wss.Dockerfile 
  )

for i in "${IMAGES[@]}"
do
  ii=(${i//,/ })
  name=${ii[0]} 
  image=${ii[1]} 
  dockerfile=${ii[2]}
  (cd $POSTCARD_ROOT && docker build -f $dockerfile -t $image .)
  docker push $image

  (cd $DIR && kustomize edit set image $name=$image)
done
