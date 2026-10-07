import type { Request, RequestHandler } from 'express';
import type {
  CreateGrowthMeasurementInput,
  GrowthMeasurementListResponse,
  GrowthMeasurementResponse,
  UpdateGrowthMeasurementInput,
} from '@baby-tracker/shared';
import { getFamilyScope } from '../../middleware/familyAccess.js';
import { getBabyScope } from '../../middleware/babyAccess.js';
import * as growthService from './service.js';

const measurementIdOf = (req: Request): string =>
  typeof req.params.measurementId === 'string' ? req.params.measurementId : '';

export const create: RequestHandler = async (req, res) => {
  const measurement = await growthService.createMeasurement(
    getFamilyScope(req),
    getBabyScope(req),
    req.body as CreateGrowthMeasurementInput,
  );

  res.status(201).json({ measurement } satisfies GrowthMeasurementResponse);
};

export const list: RequestHandler = async (req, res) => {
  const measurements = await growthService.listMeasurements(getFamilyScope(req), getBabyScope(req));

  res.status(200).json({ measurements } satisfies GrowthMeasurementListResponse);
};

export const update: RequestHandler = async (req, res) => {
  const measurement = await growthService.updateMeasurement(
    getFamilyScope(req),
    getBabyScope(req),
    measurementIdOf(req),
    req.body as UpdateGrowthMeasurementInput,
  );

  res.status(200).json({ measurement } satisfies GrowthMeasurementResponse);
};

export const remove: RequestHandler = async (req, res) => {
  await growthService.deleteMeasurement(
    getFamilyScope(req),
    getBabyScope(req),
    measurementIdOf(req),
  );

  res.status(204).send();
};
