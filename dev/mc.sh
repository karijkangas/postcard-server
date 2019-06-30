#!/usr/bin/env bash

CONTAINER=$(docker container ls | grep postcard_mc | awk '{print $1}') || exit 1
docker exec $CONTAINER $*
