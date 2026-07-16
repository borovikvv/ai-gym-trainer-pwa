#!/bin/bash
# Прибить старый процесс на порту 8910 перед запуском — защита от орфанных tsx
fuser -k 8910/tcp 2>/dev/null
exec /root/ai-gym-trainer-pwa/node_modules/.bin/tsx --env-file=/root/ai-gym-trainer-pwa/.env.local /root/ai-gym-trainer-pwa/server/index.ts
