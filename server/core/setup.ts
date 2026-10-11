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
//
// SKELETON: not implemented yet.

import type { SetupRequest, SignedInResponse } from '../../src/lib/backend/serverApi';
import type { RequestInfo, ServerContext } from './handler';

export function setupHome(
  _ctx: ServerContext,
  _request: SetupRequest,
  _info: RequestInfo,
): Promise<{ response: SignedInResponse; key: string }> {
  throw new Error('setupHome: not implemented yet');
}
