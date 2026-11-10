import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";

import { closeDb, getDb, getPool } from "./db/client";
import { stopBoss } from "./jobs/boss";
import { JobsService } from "./jobs/boss";

/**
 * Platform infrastructure: database pool + drizzle client + pg-boss queue.
 * Business modules consume these through their `infrastructure/` adapters
 * (DEPENDENCY_RULES §1); nothing here imports from `modules/`.
 */
@Global()
@Module({
  providers: [
    { provide: "PG_POOL", useFactory: getPool },
    { provide: "DB", useFactory: getDb },
    JobsService,
  ],
  exports: ["PG_POOL", "DB", JobsService],
})
export class InfrastructureModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await stopBoss();
    await closeDb();
  }
}
