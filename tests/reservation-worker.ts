import { ProjectCatalog } from '../src/catalog/catalog';
import type { AcquireReservation } from '../src/compute/contracts';
import { quiescence } from './reservation-fixture';

const [mode, root, payload, stage, releaseId] = process.argv.slice(2);
const catalog = new ProjectCatalog(root, () => {}, { evidence: { inspect: quiescence }, checkpoint: (at) => {
  if (at === stage) process.kill(process.pid, 'SIGKILL');
} });
if (mode === 'release') {
  const r = catalog.reservations.get(payload);
  catalog.reservations.release(r.reservationId, r.revision, releaseId);
  catalog.close();
} else {
  process.stdout.write('READY\n');
  process.stdin.once('data', () => {
    try {
      const r = catalog.reservations.acquire(JSON.parse(payload) as AcquireReservation);
      process.stdout.write(JSON.stringify({ state: r.state, reservationId: r.reservationId }) + '\n');
    } catch (error) { process.stdout.write(JSON.stringify({ code: (error as { code?: string }).code ?? 'unexpected' }) + '\n'); }
    catalog.close(); process.stdin.destroy();
  });
}
