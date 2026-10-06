// Issue #404: вход в приложение переехал с HTTP Basic Auth на cookie-сессию
// (Authelia + Caddy forward_auth). Портал входа живёт на том же origin по
// пути /auth/ — он остаётся в scope PWA; отдельный поддомен вывел бы вход за
// пределы scope и сломал бы установленное приложение.
//
// Ответ 401 от API означает «сессии нет или она истекла» — состояние
// восстановимое: пользователя нужно увести на портал, а не показывать
// тупиковый экран. Вынесено отдельным модулем, чтобы это можно было
// замокать в тестах (jsdom не реализует window.location.assign).
export const AUTH_PORTAL_PATH = '/auth/'

export function redirectToAuthPortal(): void {
  window.location.assign(AUTH_PORTAL_PATH)
}
