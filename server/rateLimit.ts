import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit'

interface RateLimiterOptions {
  windowMs: number
  max: number
  message: string
}

export function createRateLimiter({ windowMs, max, message }: RateLimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res, _next, _optionsUsed) => {
      res.status(429).json({ error: message })
    },
  })
}

export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many requests, please try again later',
})

export const llmRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many AI requests, please try again later',
})