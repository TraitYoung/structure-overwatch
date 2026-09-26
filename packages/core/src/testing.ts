import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const DEMO_REPO = fileURLToPath(new URL('../../../fixtures/demo-repo', import.meta.url));
