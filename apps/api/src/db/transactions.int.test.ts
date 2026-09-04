import { describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { Family } from '../models/Family.js';
import { FamilyMember } from '../models/FamilyMember.js';

/**
 * Infrastructure test: proves that this project's MongoDB actually runs
 * transactions, rather than merely reporting that it is a replica set.
 *
 * It exercises the two documents a transaction will really be used for —
 * a family and its owner membership — without touching the family service,
 * which deliberately still uses a compensating write (decision D21). Making
 * transactions *available* and *adopting* them are separate changes.
 */
function admin(): ReturnType<NonNullable<typeof mongoose.connection.db>['admin']> {
  const { db } = mongoose.connection;
  if (!db) {
    throw new Error('No database connection; the test harness did not connect');
  }
  return db.admin();
}

describe('MongoDB topology', () => {
  it('is a replica set, which is the precondition for transactions', async () => {
    const hello = (await admin().command({ hello: 1 })) as {
      setName?: string;
      isWritablePrimary?: boolean;
    };

    expect(hello.setName).toBeTypeOf('string');
    expect(hello.isWritablePrimary).toBe(true);
  });
});

describe('transactions', () => {
  it('commits two related writes together', async () => {
    const familyId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await Family.create([{ _id: familyId, name: 'Committed', createdBy: userId }], {
          session,
        });
        await FamilyMember.create([{ familyId, userId, role: 'OWNER' }], { session });
      });
    } finally {
      await session.endSession();
    }

    expect(await Family.countDocuments({ _id: familyId })).toBe(1);
    expect(await FamilyMember.countDocuments({ familyId })).toBe(1);
  });

  it('keeps uncommitted writes invisible outside the transaction', async () => {
    const familyId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const session = await mongoose.startSession();

    session.startTransaction();
    try {
      await Family.create([{ _id: familyId, name: 'In flight', createdBy: userId }], { session });

      // Inside the session it exists; outside it does not exist yet.
      expect(await Family.countDocuments({ _id: familyId }).session(session)).toBe(1);
      expect(await Family.countDocuments({ _id: familyId })).toBe(0);
    } finally {
      await session.abortTransaction();
      await session.endSession();
    }

    expect(await Family.countDocuments({ _id: familyId })).toBe(0);
  });

  it('rolls every write back when the transaction throws', async () => {
    const familyId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const session = await mongoose.startSession();
    const failure = new Error('simulated failure inside the transaction');

    await expect(
      (async () => {
        try {
          await session.withTransaction(async () => {
            await Family.create([{ _id: familyId, name: 'Rolled back', createdBy: userId }], {
              session,
            });
            await FamilyMember.create([{ familyId, userId, role: 'OWNER' }], { session });
            throw failure;
          });
        } finally {
          await session.endSession();
        }
      })(),
    ).rejects.toThrow(failure);

    // Neither write survived: this is the guarantee the compensating write in
    // the family service cannot make on its own.
    expect(await Family.countDocuments({ _id: familyId })).toBe(0);
    expect(await FamilyMember.countDocuments({ familyId })).toBe(0);
  });
});
