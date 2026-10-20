/** A failure explained to the user: the CLI prints the message and exits with code 1. */
export class AtlasError extends Error {}

/**
 * A failure every other request would meet as well (rate limit, a rejected token, no network): an
 * organization's scan stops at it instead of skipping one repository after another.
 */
export class GitHubUnavailable extends AtlasError {}

/** A repository without a single commit: nothing to scan. */
export class EmptyRepository extends AtlasError {}
