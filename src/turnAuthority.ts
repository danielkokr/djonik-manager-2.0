/**
 * Turn origin and mutation authority (#39 Stage 3A).
 *
 * Authority comes only from the trusted caller path that submitted the turn — never from the turn's text,
 * its Telegram content or any phrase in it. There is no intent routing here: the client only needs to know
 * whether the CURRENT turn carries Daniel's authority for a mutation.
 *
 * - `user_message` / `button_callback`: Daniel's own turn (typed, or a Working Rhythm button converted into
 *   his ordinary message). Mutating tools may be attempted through the normal verified pipeline (#31/#32).
 * - `rhythm_ritual` / `rhythm_exception`: an autonomous scheduled turn. Read-only: every mutating tool
 *   confirmation is denied before the provider executes it.
 */
export type TurnOrigin = "user_message" | "button_callback" | "rhythm_ritual" | "rhythm_exception";

export type MutationAuthority = "human" | "autonomous_read_only";

/** Only the two human origins grant mutation authority; anything else (including a value outside the type
 *  at runtime) is read-only — fail closed. */
export function mutationAuthorityFor(origin: TurnOrigin): MutationAuthority {
  return origin === "user_message" || origin === "button_callback" ? "human" : "autonomous_read_only";
}
