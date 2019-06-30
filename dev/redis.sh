#!/usr/bin/env bash

CONTAINER=$(docker container ls | grep postcard_redis | awk '{print $1}')

docker exec -ti $CONTAINER sh -c 'redis-cli' $*
