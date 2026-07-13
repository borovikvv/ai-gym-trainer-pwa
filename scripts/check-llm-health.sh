#!/bin/bash
# LLM Health Monitor for AI Gym Trainer
# Tests all 3 tiers, checks recent errors, reports token usage.
# Designed for cron output: verbose only when there's a problem,
# silent/terse when healthy.

API_KEY=$(grep OPENAI_API_KEY /etc/ai-gym-trainer-api.env | cut -d= -f2-)
DATABASE_URL=$(grep ^DATABASE_URL= /etc/ai-gym-trainer-api.env | cut -d= -f2-)

declare -A TIERS=(
  [fast]=openai/gpt-4o-mini
  [mid]=openai/gpt-5.4-mini
  [smart]=openai/gpt-5.6-luna
)

ERRORS=""
WARNINGS=""
TOKEN_SUM_PROMPT=0
TOKEN_SUM_COMP=0
ALL_OK=true
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# --- 1. Test each model ---
for TIER in fast mid smart; do
  MODEL="${TIERS[$TIER]}"
  RESP=$(curl -s -w "\n%{http_code}" https://openrouter.ai/api/v1/chat/completions \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with just OK\"}],\"max_tokens\":20}" 2>/dev/null)
  
  HTTP_CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  
  if [ "$HTTP_CODE" != "200" ]; then
    ERR_MSG=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('message','unknown'))" 2>/dev/null || echo "parse error")
    ERRORS+="❌ $TIER ($MODEL) — HTTP $HTTP_CODE: $ERR_MSG"$'\n'
    ALL_OK=false
  else
    WARNINGS+="✅ $TIER ($MODEL) — OK"$'\n'
  fi
done

# --- 2. Parse API service logs for LLM calls (last 24h) ---
LLM_LOGS=$(journalctl -u ai-gym-trainer-api --since "24 hours ago" --output=cat 2>/dev/null \
  | grep 'TRAINER_EVENT.*llm\.call')

if [ -n "$LLM_LOGS" ]; then
  # Count total calls
  TOTAL_CALLS=$(echo "$LLM_LOGS" | wc -l)

  # Count errors
  LLM_ERRORS=$(echo "$LLM_LOGS" | python3 -c "
import sys, json
errors = 0
for line in sys.stdin:
    try:
        payload = json.loads(line.split('TRAINER_EVENT ', 1)[1])
        if not payload.get('ok', True):
            errors += 1
    except:
        pass
print(errors)
" 2>/dev/null)

  # Extract token stats
  TOKEN_STATS=$(echo "$LLM_LOGS" | python3 -c "
import sys, json
prompt = 0
completion = 0
for line in sys.stdin:
    try:
        payload = json.loads(line.split('TRAINER_EVENT ', 1)[1])
        if payload.get('ok', False):
            prompt += int(payload.get('promptTokens', 0) or 0)
            completion += int(payload.get('completionTokens', 0) or 0)
    except:
        pass
print(f'{prompt}|{completion}')
" 2>/dev/null)

  if [ -n "$TOKEN_STATS" ]; then
    IFS='|' read -r TOKEN_SUM_PROMPT TOKEN_SUM_COMP <<< "$TOKEN_STATS"
  fi

  if [ -n "$LLM_ERRORS" ] && [ "$LLM_ERRORS" -gt 0 ] 2>/dev/null; then
    WARNINGS+="⚠️ $LLM_ERRORS LLM errors (last 24h)"$'\n'

    # Show last 3 errors with caller
    RECENT_ERRS=$(echo "$LLM_LOGS" | python3 -c "
import sys, json
errs = []
for line in sys.stdin:
    try:
        payload = json.loads(line.split('TRAINER_EVENT ', 1)[1])
        if not payload.get('ok', True):
            errs.append(f\"{payload.get('caller','?')}: {payload.get('error') or 'empty content'}\")
    except:
        pass
print('\n'.join(errs[-3:]))
" 2>/dev/null)
    if [ -n "$RECENT_ERRS" ]; then
      WARNINGS+="Last errors:"$'\n'"$RECENT_ERRS"$'\n'
    fi
  fi
fi

# --- 4. Output ---
if $ALL_OK && [ -z "$(echo "$WARNINGS" | grep -v '^✅')" ]; then
  # Silent report — everything OK
  echo "✅ LLM status OK | calls_24h: ${TOTAL_CALLS:-0} | tokens: $((TOKEN_SUM_PROMPT + TOKEN_SUM_COMP)) | $NOW"
else
  echo "⚠️ LLM Health Report — $NOW"
  echo ""
  echo "--- Model Tests ---"
  echo "$WARNINGS"
  if [ -n "$ERRORS" ]; then
    echo "--- Errors ---"
    echo "$ERRORS"
  fi
  echo "--- Usage (24h) ---"
  echo "Calls: ${TOTAL_CALLS:-0}"
  echo "Prompt tokens: $TOKEN_SUM_PROMPT"
  echo "Completion tokens: $TOKEN_SUM_COMP"
  echo "Total tokens: $((TOKEN_SUM_PROMPT + TOKEN_SUM_COMP))"
fi
