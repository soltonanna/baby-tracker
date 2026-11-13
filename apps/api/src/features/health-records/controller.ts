import type { Request, RequestHandler } from 'express';
import type {
  CreateHealthRecordInput,
  HealthRecordListResponse,
  HealthRecordResponse,
  ListHealthRecordsQuery,
  UpdateHealthRecordInput,
} from '@baby-tracker/shared';
import { getFamilyScope } from '../../middleware/familyAccess.js';
import { getBabyScope } from '../../middleware/babyAccess.js';
import { validatedQuery } from '../../middleware/validate.js';
import * as healthService from './service.js';

const recordIdOf = (req: Request): string =>
  typeof req.params.recordId === 'string' ? req.params.recordId : '';

export const create: RequestHandler = async (req, res) => {
  const record = await healthService.createRecord(
    getFamilyScope(req),
    getBabyScope(req),
    req.body as CreateHealthRecordInput,
  );
  res.status(201).json({ record } satisfies HealthRecordResponse);
};

export const list: RequestHandler = async (req, res) => {
  const records = await healthService.listRecords(
    getFamilyScope(req),
    getBabyScope(req),
    validatedQuery<ListHealthRecordsQuery>(res),
  );
  res.status(200).json({ records } satisfies HealthRecordListResponse);
};

export const update: RequestHandler = async (req, res) => {
  const record = await healthService.updateRecord(
    getFamilyScope(req),
    getBabyScope(req),
    recordIdOf(req),
    req.body as UpdateHealthRecordInput,
  );
  res.status(200).json({ record } satisfies HealthRecordResponse);
};

export const remove: RequestHandler = async (req, res) => {
  await healthService.deleteRecord(getFamilyScope(req), getBabyScope(req), recordIdOf(req));
  res.status(204).send();
};
