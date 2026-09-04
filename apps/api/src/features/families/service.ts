import type { CreateFamilyInput, FamilyWithRole } from '@baby-tracker/shared';
import { Family } from '../../models/Family.js';
import { FamilyMember } from '../../models/FamilyMember.js';
import { notFound } from '../../lib/httpError.js';
import { logger } from '../../lib/logger.js';
import type { FamilyScope } from '../../middleware/familyAccess.js';
import { toFamilyWithRole } from './mappers.js';

/**
 * Creates a family and the creator's OWNER membership.
 *
 * **On consistency.** These are two documents, and MongoDB can only write two
 * documents atomically inside a transaction, which requires a replica set. This
 * project runs a standalone mongod in development (`docker-compose.yml`) and a
 * standalone `MongoMemoryServer` in tests, so a transaction here would fail
 * every time it ran. Rather than write a path that cannot execute, the
 * membership failure is compensated: the family is removed again.
 *
 * The residual window is a process crash between the two writes, which would
 * leave a family with no members. That is invisible rather than incorrect —
 * every read path in the system starts from FamilyMember, so a memberless
 * family can never be listed, fetched or joined by anyone. It is garbage, not a
 * leak.
 *
 * This becomes worth revisiting before the twin events of decision D2, where
 * two documents are written that are both readable and losing one would be a
 * real defect. Moving development and tests to a single-node replica set would
 * make `session.withTransaction()` available; see CLAUDE_PROGRESS.md.
 */
export async function createFamily(
  userId: string,
  input: CreateFamilyInput,
): Promise<FamilyWithRole> {
  const family = await Family.create({ name: input.name, createdBy: userId });

  try {
    const membership = await FamilyMember.create({
      familyId: family._id,
      userId,
      role: 'OWNER',
    });
    return toFamilyWithRole(family, membership.role);
  } catch (error) {
    try {
      await Family.deleteOne({ _id: family._id });
    } catch (compensationError) {
      // Report both: the original failure is the useful one, but a failed
      // compensation is the thing that leaves state behind.
      logger.error(
        { err: compensationError, familyId: family._id.toString() },
        'Could not remove the family after its owner membership failed',
      );
    }
    throw error;
  }
}

/**
 * The families the caller belongs to, and their role in each.
 *
 * Starts from the caller's memberships, so a family they are not a member of
 * cannot appear even in principle.
 */
export async function listFamiliesForUser(userId: string): Promise<FamilyWithRole[]> {
  const memberships = await FamilyMember.find({ userId }).sort({ createdAt: 1 });
  if (memberships.length === 0) {
    return [];
  }

  const roleByFamilyId = new Map(memberships.map((m) => [m.familyId.toString(), m.role]));
  const families = await Family.find({ _id: { $in: [...roleByFamilyId.keys()] } });

  return families
    .map((family) => {
      const role = roleByFamilyId.get(family._id.toString());
      // A membership whose family is gone would be a data fault, not a request
      // the caller can make; skip it rather than return a half-built record.
      return role ? toFamilyWithRole(family, role) : null;
    })
    .filter((entry): entry is FamilyWithRole => entry !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * One family, for a caller whose membership has already been resolved.
 *
 * Takes the scope rather than a bare id: a function that cannot be called
 * without a resolved membership cannot be called by a non-member.
 */
export async function getFamily(scope: FamilyScope): Promise<FamilyWithRole> {
  const family = await Family.findById(scope.familyId);
  if (!family) {
    throw notFound('Family not found');
  }
  return toFamilyWithRole(family, scope.role);
}
