/**
 * Ambient declaration for `embedded-postgres` (ESM-only package used by the
 * DB test suite; the app itself never imports it). Declares only the surface
 * the suite uses — a real PostgreSQL 16 server managed from Node.
 */
declare module "embedded-postgres" {
  interface EmbeddedPostgresOptions {
    databaseDir: string;
    user: string;
    password: string;
    port: number;
    persistent: boolean;
    onLog?: (message: string) => void;
    onError?: (error: Error) => void;
  }

  export default class EmbeddedPostgres {
    constructor(options: EmbeddedPostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    dropDatabase(name: string): Promise<void>;
    getPgClient(): Promise<unknown>;
  }
}
