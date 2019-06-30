#!/usr/bin/env bash

[[ ! -z "$ROOT" ]] || { echo 'ROOT not defined'; exit 1; }
DIR=$(dirname "$0")

IFS=$'\n'

for row in $(yq r -j $1 | jq -c .[]); do
  out=$(mktemp)
  echo $row > $out
  aws ses delete-template --template-name $(cat $out | jq -r .Template.TemplateName)
  aws ses create-template --cli-input-json file://$out
  rm $out
done

