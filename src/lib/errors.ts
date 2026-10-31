/** The user is not signed in or lacks permission. */
export class AuthError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
  }
}

/** An expected, user-facing rule violation (e.g. invalid state transition). */
export class BusinessError extends Error {}
