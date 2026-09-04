import type { Family as FamilyDto, FamilyRole, FamilyWithRole } from '@baby-tracker/shared';
import type { FamilyDocument } from '../../models/Family.js';

export function toFamily(family: FamilyDocument): FamilyDto {
  return {
    id: family._id.toString(),
    name: family.name,
    createdBy: family.createdBy.toString(),
    createdAt: family.createdAt.toISOString(),
    updatedAt: family.updatedAt.toISOString(),
  };
}

/** A family is only ever returned to a member, so the role is always known. */
export function toFamilyWithRole(family: FamilyDocument, role: FamilyRole): FamilyWithRole {
  return { ...toFamily(family), role };
}
