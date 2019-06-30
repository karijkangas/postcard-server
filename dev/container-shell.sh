#!/usr/bin/env bash

docker exec -ti $(docker container ls | grep postcard_${1} | awk '{print $1}') /bin/sh
