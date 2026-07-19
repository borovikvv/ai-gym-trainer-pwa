# CLAUDE.md

## Agent OS — контракт
Прочитай и выполняй агентский контракт (`contract_version: 1.4`): локально `~/my-wiki/topics/agent-contract.md`, удалённо `https://wiki.borovikvv.ru/topics/agent-contract`.

## Принципы работы с кодом
4 принципа Карпаты (контракт §4, детали — `topics/karpathy-principles`): думай перед кодом, минимум кода, хирургические правки, верифицируй результат.

## База знаний
Контекст проекта — в wiki: `projects/ai-gym-trainer/` (overview, architecture, features, chats). Начинай со страницы overview; значимые результаты сессии сохраняй по контракту в `raw/new/`.

## О проекте
Персональный AI-тренер (PWA): React + TypeScript + Vite, Node.js API, PostgreSQL. Репо: https://github.com/borovikvv/ai-gym-trainer-pwa.

## Правила тестов (ревизия 2026-07-19)
Тесты не должны зависеть от текста UI-элементов и хардкода дат/дней недели: используй `data-testid`, `aria-label` или роль элемента. Смена надписи в интерфейсе не должна ронять CI.
