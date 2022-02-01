#!/bin/bash -e

spin='-\|/'

RETRY=120
for i in $(eval echo "{1..$RETRY}"); do
  if [ "$(curl -s -o /dev/null --silent -w "%{http_code}"  http://$1)" == "${2:-200}" ]; then
    echo "$1 took $SECONDS seconds             "
    exit 0
  else
    if [ "$i" -lt $RETRY ]; then
      echo -ne "\rretrying $1 [${spin:$((i%4)):1}] ($i of $RETRY)\r"
      sleep 1
    fi
  fi
done
echo "giving up after $SECONDS seconds"
exit 1
