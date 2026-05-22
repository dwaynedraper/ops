/**
 * Bootstrap admin email.
 *
 * Rep onboarding is invite-only — see src/lib/rep-access.ts and the
 * rep_invites table. The one thing invites can't cover is the very
 * first sign-in: before any invite exists, someone has to be able to
 * get in and become the first super_admin.
 *
 * That someone is the bootstrap admin — the first (and normally only)
 * entry in the ALLOWED_EMAILS env var. On their first sign-in the
 * createUser event reads this and creates their profile as super_admin,
 * status 'active'. Every other rep comes through an invite; ALLOWED_EMAILS
 * has no other role.
 */

export function isBootstrapAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const first = (process.env.ALLOWED_EMAILS ?? '').split(',')[0]?.trim().toLowerCase();
  return !!first && first === email.trim().toLowerCase();
}
