export interface BuildOutputRoute {
  src?: string;
  headers?: Record<string, string>;
  continue?: boolean;
  handle?: 'filesystem';
}
export interface BuildOutputCron {
  path: string;
  schedule: string;
}
export interface VercelJsonHeaders {
  headers?: { source: string; headers: { key: string; value: string }[] }[];
  crons?: BuildOutputCron[];
}
export declare function buildOutputConfig(vercelJson: VercelJsonHeaders): {
  version: 3;
  routes: BuildOutputRoute[];
  crons?: BuildOutputCron[];
};
export declare function sourceToRegex(source: string): string;
export declare function functionConfig(opts?: { region?: string }): {
  runtime: string;
  handler: string;
  launcherType: 'Nodejs';
  shouldAddHelpers: boolean;
  maxDuration: number;
  regions?: string[];
};
export declare const ESM_REQUIRE_BANNER: string;
