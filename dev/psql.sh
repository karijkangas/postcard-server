#!/usr/bin/env bash

CONTAINER=$(docker container ls | grep postcard_postgres | awk '{print $1}') || exit 1

COMMAND="psql -U postgres "
docker exec -ti $CONTAINER sh -c "$COMMAND"
