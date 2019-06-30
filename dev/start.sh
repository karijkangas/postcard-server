#!/usr/bin/env bash

REGISTRY=127.0.0.1:5000
RELEASE=latest

export REGISTRY
export RELEASE

[[ ! -z "$POSTCARD_ROOT" ]] || { echo 'POSTCARD_ROOT not defined'; exit 1; }
[[ ! -z "$REGISTRY" ]] || { echo 'REGISTRY not defined'; exit 1; }
[[ ! -z "$RELEASE" ]] || { echo 'RELEASE not defined'; exit 1; }

source ${POSTCARD_ROOT}/dev/secrets.sh

SECRETS=(
  POSTCARD_POSTGRES_PASSWORD,$POSTGRES_PASSWORD
  POSTCARD_S3_ACCESS_KEY,$S3_ACCESS_KEY
  POSTCARD_S3_SECRET_ACCESS_KEY,$S3_SECRET_ACCESS_KEY
  POSTCARD_SES_ACCESS_KEY,$SES_ACCESS_KEY
  POSTCARD_SES_SECRET_ACCESS_KEY,$SES_SECRET_ACCESS_KEY
  )

for i in "${SECRETS[@]}"
do
  ii=(${i//,/ }); name=${ii[0]}; value=${ii[1]}
  docker secret rm $name 2&> /dev/null
  until docker secret ls | grep -v $name > /dev/null
  do
    echo "Waiting for $name secret to disappear"
    sleep 1
  done
  (echo -n $value | docker secret create $name -) > /dev/null
  
  until docker secret ls | grep $name > /dev/null
  do
    echo "Waiting for $name secret to appear"
    sleep 1
  done
done

docker stack deploy -c ${POSTCARD_ROOT}/dev/docker-compose.yaml postcard
