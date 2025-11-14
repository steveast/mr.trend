#!/bin/bash

rm -r ./dist && pm2 stop mr-trend && git pull --rebase && npm run build && pm2 start mr-trend && pm2 log mr-trend --lines 50