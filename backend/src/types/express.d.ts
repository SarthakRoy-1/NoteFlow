import type { User } from '../modules/users/users.repo.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. The only source of truth for "who is making this request". */
      user?: User;
    }
  }
}

export {};
