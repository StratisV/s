// STUB: replaced by the Supabase backend agent.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Backend } from './types';

export class SupabaseBackend implements Backend {
  readonly kind = 'supabase' as const;
  constructor(_url: string, _anonKey: string) {}
  getUser(..._args: any[]): any { throw new Error('not implemented'); }
  onAuthChange(..._args: any[]): any { throw new Error('not implemented'); }
  signInWithGoogle(..._args: any[]): any { throw new Error('not implemented'); }
  signOut(..._args: any[]): any { throw new Error('not implemented'); }
  getMyHouseholdId(..._args: any[]): any { throw new Error('not implemented'); }
  load(..._args: any[]): any { throw new Error('not implemented'); }
  subscribe(..._args: any[]): any { throw new Error('not implemented'); }
  createHousehold(..._args: any[]): any { throw new Error('not implemented'); }
  joinHousehold(..._args: any[]): any { throw new Error('not implemented'); }
  getInvitePreview(..._args: any[]): any { throw new Error('not implemented'); }
  createInvite(..._args: any[]): any { throw new Error('not implemented'); }
  updateHousehold(..._args: any[]): any { throw new Error('not implemented'); }
  updateMember(..._args: any[]): any { throw new Error('not implemented'); }
  createArea(..._args: any[]): any { throw new Error('not implemented'); }
  renameArea(..._args: any[]): any { throw new Error('not implemented'); }
  deleteArea(..._args: any[]): any { throw new Error('not implemented'); }
  reorderAreas(..._args: any[]): any { throw new Error('not implemented'); }
  createItem(..._args: any[]): any { throw new Error('not implemented'); }
  updateItem(..._args: any[]): any { throw new Error('not implemented'); }
  deleteItem(..._args: any[]): any { throw new Error('not implemented'); }
  completeItem(..._args: any[]): any { throw new Error('not implemented'); }
  undoCompletion(..._args: any[]): any { throw new Error('not implemented'); }
  savePushSubscription(..._args: any[]): any { throw new Error('not implemented'); }
  deletePushSubscription(..._args: any[]): any { throw new Error('not implemented'); }
}
