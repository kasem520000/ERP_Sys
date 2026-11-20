import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { TimeEntryService } from "../../modules/crm/application/time-entry-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import {
  WbsCrossProjectError,
  WbsCycleError,
  WbsInputInvalidError,
  WbsTaskInUseError,
  WbsTaskNotFoundError,
} from "../../modules/crm/domain/projects-errors";
import { TimeEntryWbsCoherenceError } from "../../modules/crm/domain/crm-errors";
import { rollupWeightedPercent } from "../../modules/crm/domain/projects-math";
import {
  PJW_ACTOR,
  TENANT_PJW,
  pjw,
  setupProjectsFixture,
  wbs,
} from "./fixtures";

/**
 * PHASE-048 (W-9 — T-05) — the WBS engine pinned over real PostgreSQL 16
 * (the plan §4's `projects-wbs.db.spec` — acceptance #2's API arms): the
 * tree over real rows, the dependency-cycle + parent-cycle refusals
 * (D-03 — the pure guards fired through the service, the illegal state
 * never saved), the leaf-recomputed weighted rollup reconciling
 * NODE-BY-NODE (BR-095), the children-first delete order, the
 * cross-project guards, and 0100's time-entry write-time coherence.
 *
 * The hand-computed tree (the unit spec's exact shape): R = (60×50 +
 * 30×80 + 10×20)/100 = 56.00; B = (30×80 + 10×20)/40 = 65.00.
 */

const resolveConfig = new ResolveEffectiveConfigService(new ConfigRepository());
const timeEntries = new TimeEntryService(new AuditService(new DrizzleAuditStore()), resolveConfig);

beforeAll(async () => {
  await setupProjectsFixture();
});

describe("PHASE-048 W-9 — T-05: the tree + the leaf-recomputed rollup (BR-095)", () => {
  it("(a) the tree read carries every node's leaf-recomputed rollup — node-by-node", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const tree = await wbs.tree(fixture.project1Id);
      expect(tree).toHaveLength(2); // R + the milestone M (two roots)
      const root = tree.find((node) => node.wbsCode === "R")!;
      const milestone = tree.find((node) => node.wbsCode === "M")!;
      // The hand-computed fold.
      expect(root.rolledPercent).toBe("56.00");
      expect(root.leafCount).toBe(3);
      expect(root.weightSum).toBe("100.0000");
      const b = root.children.find((node) => node.wbsCode === "R.B")!;
      expect(b.rolledPercent).toBe("65.00");
      expect(b.leafCount).toBe(2);
      // A milestone is a leaf — its own report stands.
      expect(milestone.rolledPercent).toBe("100.00");
      expect(milestone.isMilestone).toBe(true);
      // The parent's OWN stored report never entered the fold (R's own
      // report is 0.00 while its rollup is 56.00 — D-03's law).
      expect(root.percentComplete).toBe("0.00");
    });
  });

  it("(b) the rollup read reconciles node-by-node with the tree read (acceptance #2)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const [rollup, tree] = await Promise.all([
        wbs.rollup(fixture.project1Id),
        wbs.tree(fixture.project1Id),
      ]);
      const treeNodes = new Map(
        tree.flatMap((root) => [root, ...root.children, ...root.children.flatMap((c) => c.children)]).map((n) => [n.id, n]),
      );
      expect(rollup.nodes).toHaveLength(treeNodes.size);
      for (const node of rollup.nodes) {
        const treeNode = treeNodes.get(node.id)!;
        expect(node.rolledPercent, `node ${node.wbsCode}`).toBe(treeNode.rolledPercent);
        expect(node.leafCount).toBe(treeNode.leafCount);
      }
    });
  });

  it("(c) BR-095's recompute-on-every-read: a leaf update moves every ancestor immediately — never a stored stale sum", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      await wbs.updateTask(fixture.tasks.b1, { percentComplete: "90.00", actorId: PJW_ACTOR });
      const rollup = await wbs.rollup(fixture.project1Id);
      const byCode = new Map(rollup.nodes.map((n) => [n.id, n]));
      // B = (30×90 + 10×20)/40 = 72.50; R = (60×50 + 30×90 + 10×20)/100 = 59.00
      expect(byCode.get(fixture.tasks.b)?.rolledPercent).toBe("72.50");
      expect(byCode.get(fixture.tasks.r)?.rolledPercent).toBe("59.00");
      // Restore for the later arms.
      await wbs.updateTask(fixture.tasks.b1, { percentComplete: "80.00", actorId: PJW_ACTOR });
      const restored = await wbs.rollup(fixture.project1Id);
      const byCode2 = new Map(restored.nodes.map((n) => [n.id, n]));
      expect(byCode2.get(fixture.tasks.r)?.rolledPercent).toBe("56.00");
    });
  });

  it("(d) the pure fold over the live rows matches the service's rollup exactly", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const rollup = await wbs.rollup(fixture.project1Id);
      const raw = await (
        await import("../../modules/crm/infrastructure/projects.store")
      ).listWbsTasks(fixture.project1Id);
      const folded = rollupWeightedPercent(
        raw.map((task) => ({
          id: task.id,
          parentTaskId: task.parentTaskId,
          weight: task.weight,
          percentComplete: task.percentComplete,
        })),
      );
      for (const node of rollup.nodes) {
        expect(node.rolledPercent).toBe(folded.get(node.id)?.rolledPercent);
      }
    });
  });
});

describe("PHASE-048 W-9 — T-05: the cycle laws (D-03 — validation at write, the API the only move path)", () => {
  it("(a) the dependency edge closing a loop is refused typed, the state never saved", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // B1's predecessor is A; making A's predecessor B1 closes A→B1→A.
      await expect(
        wbs.updateTask(fixture.tasks.a, { predecessorTaskId: fixture.tasks.b1, actorId: PJW_ACTOR }),
      ).rejects.toBeInstanceOf(WbsCycleError);
      // The stored edge set is untouched: A still carries no predecessor.
      const a = await wbs.updateTask(fixture.tasks.a, { actorId: PJW_ACTOR });
      expect(a.predecessorTaskId).toBeNull();
    });
  });

  it("(b) the self-edge is refused", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      await expect(
        wbs.updateTask(fixture.tasks.a, { predecessorTaskId: fixture.tasks.a, actorId: PJW_ACTOR }),
      ).rejects.toBeInstanceOf(WbsCycleError);
    });
  });

  it("(c) the parent move under a descendant is refused (the loop closes)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // Moving R under B2 (R's own descendant) loops: B2 → B → R.
      await expect(
        wbs.updateTask(fixture.tasks.r, { parentTaskId: fixture.tasks.b2, actorId: PJW_ACTOR }),
      ).rejects.toBeInstanceOf(WbsCycleError);
    });
  });

  it("(d) a diamond is legal — two tasks may share one predecessor", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // B2 already carries B1 as predecessor; giving B2's sibling shape to
      // a fresh task with the SAME predecessor is the legal diamond.
      const fresh = await wbs.createTask({
        projectId: fixture.project1Id,
        parentTaskId: fixture.tasks.b,
        predecessorTaskId: fixture.tasks.b1,
        wbsCode: "R.B.3",
        name: "Task B3 (diamond)",
        nameAr: null,
        isMilestone: false,
        startDate: null,
        endDate: null,
        weight: null,
        percentComplete: "0.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(fresh.predecessorTaskId).toBe(fixture.tasks.b1);
      // Clean up (the children-first law would otherwise block B's delete).
      await wbs.deleteTask(fresh.id, PJW_ACTOR);
    });
  });

  it("(e) the cross-project contamination guards (parent, predecessor)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      await expect(
        wbs.updateTask(fixture.tasks.a, { parentTaskId: fixture.tasks.foreign, actorId: PJW_ACTOR }),
      ).rejects.toBeInstanceOf(WbsCrossProjectError);
      await expect(
        wbs.updateTask(fixture.tasks.a, { predecessorTaskId: fixture.tasks.foreign, actorId: PJW_ACTOR }),
      ).rejects.toBeInstanceOf(WbsCrossProjectError);
    });
  });

  it("(f) the duplicate wbsCode is the typed refusal (the 0100 UNIQUE)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      await expect(
        wbs.createTask({
          projectId: fixture.project1Id,
          parentTaskId: null,
          predecessorTaskId: null,
          wbsCode: "R",
          name: "Duplicate code",
          nameAr: null,
          isMilestone: false,
          startDate: null,
          endDate: null,
          weight: null,
          percentComplete: "0.00",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(WbsInputInvalidError);
    });
  });

  it("(g) the children-first law: dependents block, freed tasks delete (a self-contained tree)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // A THROWAWAY tree on P2 — the shared P1 tree carries the actuals
      // world's time entries (the 0100 FK RESTRICT protects them), so
      // the destructive arm never touches it.
      const x = await wbs.createTask({
        projectId: fixture.project2Id,
        parentTaskId: null,
        predecessorTaskId: null,
        wbsCode: "DEL-X",
        name: "Delete arm root",
        nameAr: null,
        isMilestone: false,
        startDate: null,
        endDate: null,
        weight: null,
        percentComplete: "0.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      const y = await wbs.createTask({
        projectId: fixture.project2Id,
        parentTaskId: x.id,
        predecessorTaskId: null,
        wbsCode: "DEL-X.Y",
        name: "Delete arm child Y",
        nameAr: null,
        isMilestone: false,
        startDate: null,
        endDate: null,
        weight: null,
        percentComplete: "40.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      const z = await wbs.createTask({
        projectId: fixture.project2Id,
        parentTaskId: x.id,
        predecessorTaskId: y.id,
        wbsCode: "DEL-X.Z",
        name: "Delete arm child Z",
        nameAr: null,
        isMilestone: false,
        startDate: null,
        endDate: null,
        weight: null,
        percentComplete: "80.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      // X carries children; Y is Z's predecessor — both in use.
      await expect(wbs.deleteTask(x.id, PJW_ACTOR)).rejects.toBeInstanceOf(WbsTaskInUseError);
      await expect(wbs.deleteTask(y.id, PJW_ACTOR)).rejects.toBeInstanceOf(WbsTaskInUseError);
      // Free the leaf, then the predecessor, then the parent.
      await wbs.deleteTask(z.id, PJW_ACTOR);
      await wbs.deleteTask(y.id, PJW_ACTOR);
      await wbs.deleteTask(x.id, PJW_ACTOR);
      // The shared P1 tree stands untouched — the rollup is stable.
      const rollup = await wbs.rollup(fixture.project1Id);
      expect(rollup.nodes.find((node) => node.id === fixture.tasks.r)?.rolledPercent).toBe("56.00");
    });
  });
});

describe("PHASE-048 W-9 — T-05: 0100's time-entry WBS coherence (write-time, engine-side)", () => {
  it("(a) a task from another project is the typed refusal — never a guessed default", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      await expect(
        timeEntries.create({
          entryDate: "2026-03-02",
          hours: "2",
          feeItemId: fixture.feeItemId,
          projectId: fixture.project1Id,
          contractId: null,
          feeEarnerUserId: fixture.feeEarnerUserId,
          wbsTaskId: fixture.tasks.foreign,
          unitRate: "250",
          narrative: "cross-project attempt",
          billable: true,
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(TimeEntryWbsCoherenceError);
    });
  });

  it("(b) the coherent pair saves — the labor collector's dimension is live", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const entry = await timeEntries.create({
        entryDate: "2026-03-02",
        hours: "2",
        feeItemId: fixture.feeItemId,
        projectId: fixture.project1Id,
        contractId: null,
        feeEarnerUserId: fixture.feeEarnerUserId,
        wbsTaskId: fixture.tasks.a,
        unitRate: "250",
        narrative: "coherent entry",
        billable: true,
        actorId: PJW_ACTOR,
      });
      expect(entry.wbsTaskId).toBe(fixture.tasks.a);
      expect(entry.status).toBe("DRAFT");
      // The update path re-checks the MERGED pair: moving the project to
      // P2 while keeping P1's task is refused.
      await expect(
        timeEntries.update(entry.id, {
          projectId: fixture.project2Id,
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(TimeEntryWbsCoherenceError);
      // VOID the draft so it never enters the collectors.
      await timeEntries.void(entry.id, PJW_ACTOR);
    });
  });

  it("(c) an unknown task id is the typed refusal (A7-indistinguishable)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      await expect(
        timeEntries.create({
          entryDate: "2026-03-02",
          hours: "2",
          feeItemId: fixture.feeItemId,
          projectId: fixture.project1Id,
          contractId: null,
          feeEarnerUserId: fixture.feeEarnerUserId,
          wbsTaskId: "11111111-2222-4333-8444-555555555555",
          unitRate: "250",
          narrative: null,
          billable: true,
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(TimeEntryWbsCoherenceError);
    });
  });
});

describe("PHASE-048 W-9 — T-05: the A7 plane (unknown ids identical)", () => {
  it("an unknown task id renders the typed not-found", async () => {
    await withTenant(TENANT_PJW, async () => {
      await expect(
        wbs.updateTask("11111111-2222-4333-8444-555555555555", { actorId: PJW_ACTOR }),
      ).rejects.toBeInstanceOf(WbsTaskNotFoundError);
      await expect(
        wbs.deleteTask("11111111-2222-4333-8444-555555555555", PJW_ACTOR),
      ).rejects.toBeInstanceOf(WbsTaskNotFoundError);
    });
  });
});
