// "Bring this home online" on the server: POST {op:'setup', code, phone, app?}. In order:
// 1. limiter.begin(ip) → 429 while blocked (the attempt counts as failed unless the code is
//    right); setupCodeMatches(code, config.setupCode) else 'invalid_code' (the same answer
//    whether or not a setup code is configured);
// 2. a home is online already (this instance's copy, or the create below losing the race):
//    recoverOwner() (./auth.ts) when none of the owner's devices was ever used, which is how a
//    phone whose "Bring It Online" reply was lost (a dropped connection, the app put away)
//    gets in on the next tap; this browser becomes the owner's device and the home is NOT
//    built again. Otherwise 'home_exists' (not a failed attempt);
// 3. buildServerHome(phone, { now, ownerUserId: 'u-' + newId() }) (src/lib/logic/serverImport.ts)
//    → null: 'invalid_input' ('invalid_input: phone');
// 4. newServerDoc(home, { secret: 32 random bytes, setupHash }), addDevice(owner,
//    deviceLabel(user agent, app)); store.create(doc);
// 5. 200 SignedInResponse (entry 'member', the owner) with Set-Cookie for the device token.
// Once the owner has used the home, the setup code does nothing more (step 2), for good.
// docs/ARCHITECTURE.md "Server mode (no setup)", "Setup".

import type { SetupRequest, SignedInResponse } from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import { buildServerHome } from '../../src/lib/logic/serverImport';
import { addDevice, deviceToken, recoverOwner, setupCodeMatches, setupHashOf } from './auth';
import { deviceLabel } from './deviceLabel';
import { ApiError } from './errors';
import type { RequestInfo, ServerContext } from './handler';
import { newServerDoc } from './serverDoc';

/** The owner signed in on this browser again, on the home that is online (see step 2). */
async function recover(ctx: ServerContext, code: string, label: string): Promise<{ response: SignedInResponse; token: string }> {
  const done = await ctx.store.write(
    (doc) => {
      const recovered = recoverOwner(doc, code, label, ctx.deps);
      if (!recovered) throw new BackendError('home_exists');
      return recovered;
    },
    { pure: true },
  );
  const { token, device, caller, entry } = done.result;
  return {
    token,
    response: {
      user: { id: caller.userId, email: '', name: caller.name },
      entry,
      device: { id: device.id, memberId: caller.memberId, label: device.label, createdAt: device.createdAt, current: true },
      rev: done.rev,
    },
  };
}

export async function setupHome(
  ctx: ServerContext,
  request: SetupRequest,
  info: RequestInfo,
): Promise<{ response: SignedInResponse; token: string }> {
  const attempt = ctx.limiter.begin(info.ip);
  if (!attempt.ticket) throw new ApiError('too_many_attempts', 'Too many tries', attempt.wait);
  if (typeof request.code !== 'string' || !setupCodeMatches(request.code, ctx.config.setupCode)) {
    throw new ApiError('invalid_code', 'That setup code did not work');
  }
  attempt.ticket.succeeded();
  const label = deviceLabel(info.userAgent, request.app);
  if (await ctx.store.read()) return recover(ctx, request.code, label);
  const now = ctx.deps.now();
  const ownerUserId = `u-${ctx.deps.newId()}`;
  const built = typeof request.phone === 'string' ? buildServerHome(request.phone, { now, ownerUserId, newId: ctx.deps.newId }) : null;
  if (!built) throw new ApiError('invalid_input', 'invalid_input: phone');
  const secret = Buffer.from(ctx.deps.randomBytes(32)).toString('base64url');
  const doc = newServerDoc(built.home, now, { secret, setupHash: setupHashOf(request.code) });
  const { key, device } = addDevice(doc, ownerUserId, label, ctx.deps);
  let snapshot;
  try {
    snapshot = await ctx.store.create(doc);
  } catch (err) {
    // Another setup won the race (or this instance's copy was behind): as step 2.
    if (err instanceof BackendError && err.code === 'home_exists') return recover(ctx, request.code, label);
    throw err;
  }
  const owner = snapshot.doc.home.members.find((m) => m.id === built.ownerMemberId)!;
  return {
    token: deviceToken(snapshot.doc, device, key, snapshot.doc.rev),
    response: {
      user: { id: ownerUserId, email: '', name: owner.name },
      entry: { status: 'member', householdId: built.householdId, memberId: built.ownerMemberId, canImport: false },
      device: { id: device.id, memberId: built.ownerMemberId, label: device.label, createdAt: device.createdAt, current: true },
      rev: snapshot.doc.rev,
    },
  };
}
