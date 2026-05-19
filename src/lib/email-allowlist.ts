/**
 * Email allowlist. In v1 this is the entire access-control system —
 * a comma-separated env var. When the partner roster grows past ~5
 * people, replace this with an `ops_invites` table.
 *
 * The list is parsed once per process and cached. Emails are normalized
 * to lowercase for comparison so casing in the env var doesn't matter.
 */

let cached: Set<string> | null = null;

function load(): Set<string> {
  if (cached) return cached;
  const raw = process.env.ALLOWED_EMAILS ?? '';
  const set = new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  cached = set;
  return set;
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return load().has(email.trim().toLowerCase());
}

/**
 * The first email in ALLOWED_EMAILS is treated as the bootstrap admin.
 * On first sign-in, that user's ops_profile is created with role='admin'.
 * Every other allowed email gets role='partner' by default; an admin can
 * promote them later.
 */
export function isBootstrapAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const first = (process.env.ALLOWED_EMAILS ?? '').split(',')[0]?.trim().toLowerCase();
  return !!first && first === email.trim().toLowerCase();
}
