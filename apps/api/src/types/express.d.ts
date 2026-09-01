/**
 * `req.auth` is set by the `authenticate` middleware and by nothing else.
 *
 * It is optional here so that unauthenticated routes type-check; handlers read
 * it through `getAuth(req)`, which throws if the middleware did not run.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
      };
    }
  }
}

export {};
