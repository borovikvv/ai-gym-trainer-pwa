// Issue #474: клиентская реакция на сигнал SW «сессия истекла».
//
// Подресурсы оболочки под гейтом входа, которых нет в прекеше, заставляют SW
// вернуть синтетический 401 и разослать это сообщение. Пользователя нужно
// увести на портал входа, а не оставить с белым экраном.
import { redirectToAuthPortal } from './authRedirect'
import { SESSION_EXPIRED_MESSAGE } from '../sw/assetGateHandler'

export type SessionExpiredSource = {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

export function listenForSessionExpired(
  container: SessionExpiredSource = navigator.serviceWorker,
): void {
  container.addEventListener('message', (event: MessageEvent) => {
    const data: unknown = event.data
    if (
      data !== null &&
      typeof data === 'object' &&
      (data as { type?: unknown }).type === SESSION_EXPIRED_MESSAGE
    ) {
      redirectToAuthPortal()
    }
  })
}
