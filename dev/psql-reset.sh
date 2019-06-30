#!/usr/bin/env bash

[[ ! -z "$POSTCARD_ROOT" ]] || { echo 'POSTCARD_ROOT not defined'; exit 1; }

${POSTCARD_ROOT}/dev/psql-file.sh ${POSTCARD_ROOT}/dev/database-reset.sql || exit 1
${POSTCARD_ROOT}/dev/psql-file.sh ${POSTCARD_ROOT}/design/database-schema.sql || exit 1
