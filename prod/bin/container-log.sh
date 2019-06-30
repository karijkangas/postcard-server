#!/usr/bin/env bash
kubectl logs $(kubectl get pods | grep $1 | awk '{print $1}') -f
