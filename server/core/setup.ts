// "Bring this home online" on the server: POST {op:'setup', code, phone}. In order:
// 1. limiter.blockedFor(ip) → 429; setupCodeMatches(code, config.setupCode) else fail(ip) and
//    'invalid_code' (the same answer whether or not a setup code is configured);
// 2. store.read(): a home is online → 'home_exists' (not counted as a failed attempt);
// 3. buildServerHome(phone, { now, ownerUserId: 'u-' + newId() }) (src/lib/logic/serverImport.ts)
//    → null: 'invalid_input' ('invalid_input: phone');
// 4. newServerDoc(home), addDevice(owner, deviceLabel(user agent)); store.create(doc) →
//    BackendError('home_exists') when another setup won the race;
// 5. 200 SignedInResponse (entry 'member', the owner) with Set-Cookie for the new key.
// After a home is online, the setup code does nothing (step 2), for good.
// docs/ARCHITECTURE.md "Server mode (no setup)", "Setup".

import type { SetupRequest, SignedInResponse } from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import { buildServerHome } from '../../src/lib/logic/serverImport';
import { addDevice, setupCodeMatches } from './auth';
import { deviceLabel } from './deviceLabel';
import { ApiError } from './errors';
import type { RequestInfo, ServerContext } from './handler';
import { newServerDoc } from './serverDoc';

export async function setupHome(
  ctx: ServerContext,
  request: SetupRequest,
  info: RequestInfo,
): Promise<{ response: SignedInResponse; key: string }> {
  const wait = ctx.limiter.blockedFor(info.ip);
  if (wait > 0) throw new ApiError('too_many_attempts', 'Too many tries', wait);
  if (typeof request.code !== 'string' || !setupCodeMatches(request.code, ctx.config.setupCode)) {
    ctx.limiter.fail(info.ip);
    throw new ApiError('invalid_code', 'That setup code did not work');
  }
  if (await ctx.store.read()) throw new BackendError('home_exists');
  const now = ctx.deps.now();
  const ownerUserId = `u-${ctx.deps.newId()}`;
  const built = typeof request.phone === 'string' ? buildServerHome(request.phone, { now, ownerUserId, newId: ctx.deps.newId }) : null;
  if (!built) throw new ApiError('invalid_input', 'invalid_input: phone');
  const doc = newServerDoc(built.home, now);
  const { key, device } = addDevice(doc, ownerUserId, deviceLabel(info.userAgent), ctx.deps);
  const snapshot = await ctx.store.create(doc);
  const owner = snapshot.doc.home.members.find((m) => m.id === built.ownerMemberId)!;
  return {
    key,
    response: {
      user: { id: ownerUserId, email: '', name: owner.name },
      entry: { status: 'member', householdId: built.householdId, memberId: built.ownerMemberId, canImport: false },
      device: { id: device.id, memberId: built.ownerMemberId, label: device.label, createdAt: device.createdAt, current: true },
      rev: snapshot.doc.rev,
    },
  };
}
