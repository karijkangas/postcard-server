#!/usr/bin/env bash
kubectl exec -it $(kubectl get pod | grep $1 | awk '{print $1}') -- /bin/busybox sh
