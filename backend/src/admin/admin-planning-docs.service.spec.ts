import { mkdtemp, writeFile, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  AdminPlanningDocsService,
  PLANNING_DOC_FILES,
} from './admin-planning-docs.service';

function buildService(docsDir: string | undefined) {
  const configService = {
    get: jest.fn((key: string) =>
      key === 'ADMIN_PLANNING_DOCS_DIR' ? docsDir : undefined,
    ),
  };
  return new AdminPlanningDocsService(configService as never);
}

// docs/adr/0022-admin-control-center.md Decision 10 — the ConfigMap-backed
// planning reader. Uses a real temp directory rather than mocking `fs`:
// the behaviours that matter here (an absent key, an oversized file, the
// mtime becoming syncedAt) are all filesystem behaviours, and mocking them
// would only ever assert that the mock was written to match the code.
describe('AdminPlanningDocsService', () => {
  let docsDir: string;

  beforeAll(async () => {
    docsDir = await mkdtemp(join(tmpdir(), 'planning-docs-'));
  });

  it('reads a mounted file and reports its mtime as syncedAt', async () => {
    await writeFile(
      join(docsDir, PLANNING_DOC_FILES.ideas),
      '## Ideas\n- something',
    );
    const mtime = new Date('2026-08-01T10:00:00.000Z');
    await utimes(join(docsDir, PLANNING_DOC_FILES.ideas), mtime, mtime);

    const service = buildService(docsDir);

    await expect(service.read('ideas')).resolves.toEqual({
      source: 'ideas',
      content: '## Ideas\n- something',
      syncedAt: '2026-08-01T10:00:00.000Z',
      available: true,
    });
  });

  // The normal state on a cluster where the hand-applied ConfigMap hasn't
  // been created yet — an empty section, never a 500.
  it('reports an absent key as unavailable rather than throwing', async () => {
    const service = buildService(docsDir);

    await expect(service.read('securityIssues')).resolves.toEqual({
      source: 'securityIssues',
      content: '',
      syncedAt: null,
      available: false,
    });
  });

  it('reports the pillar unavailable when ADMIN_PLANNING_DOCS_DIR is unset, without touching the filesystem', async () => {
    const service = buildService(undefined);

    await expect(service.read('roadmapPlan')).resolves.toEqual({
      source: 'roadmapPlan',
      content: '',
      syncedAt: null,
      available: false,
    });
  });

  // An empty-but-present value is what a k8s ConfigMap key with no value
  // (or docker-compose's `${VAR:-}`) actually delivers — it must behave as
  // unset, not as a path of "".
  it('treats an empty ADMIN_PLANNING_DOCS_DIR as unset', async () => {
    const service = buildService('   ');

    await expect(service.read('roadmapPlan')).resolves.toMatchObject({
      available: false,
    });
  });

  // The size ceiling exists so an over-large paste fails here, visibly,
  // rather than at the project owner's manual `kubectl apply` step where
  // no CI run is watching.
  it('refuses a file over the size ceiling and reports it unavailable', async () => {
    const service = buildService(docsDir);
    await writeFile(
      join(docsDir, PLANNING_DOC_FILES.roadmapProject),
      'x'.repeat(256 * 1024 + 1),
    );

    await expect(service.read('roadmapProject')).resolves.toEqual({
      source: 'roadmapProject',
      content: '',
      syncedAt: null,
      available: false,
    });
  });

  // The filename set is closed by construction — there is no code path
  // that takes a name from a request, so there is no traversal surface.
  it('only ever knows four filenames, all plain basenames', () => {
    const names = Object.values(PLANNING_DOC_FILES);
    expect(names).toHaveLength(4);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9-]+\.md$/);
    }
  });
});
