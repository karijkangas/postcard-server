#!/usr/bin/env bash

CONTAINER=$(docker container ls | grep postcard_nginx | awk '{print $1}')

if [ -z "$CONTAINER" ]
then
  >&2 echo "No nginx container." && exit 1
fi

docker exec $CONTAINER nginx -s reload
