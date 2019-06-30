#!/usr/bin/env bash

CONTAINER=$(docker container ls | grep postcard_postgres | awk '{print $1}') || exit 1

TEMP_FILE=/tmp/psql-postcard-input.tmp

docker cp $1 $CONTAINER:$TEMP_FILE
docker exec $CONTAINER psql -U postgres -f $TEMP_FILE
