import type { RequestHandler } from 'express';
import type {
  FamilyDataClearResponse,
  FamilyDataImportResponse,
  FamilyDataInput,
} from '@baby-tracker/shared';
import { getFamilyScope } from '../../middleware/familyAccess.js';
import * as familyDataService from './service.js';

export const exportData: RequestHandler = async (req, res) => {
  const data = await familyDataService.exportFamilyData(getFamilyScope(req));
  const day = data.exportedAt.slice(0, 10);

  // A backup is a snapshot of private data: never cached by anything between.
  res.set('Cache-Control', 'no-store');
  res.attachment(`baby-tracker-${day}.json`);
  res.status(200).json(data);
};

export const importData: RequestHandler = async (req, res) => {
  const imported = await familyDataService.importFamilyData(
    getFamilyScope(req),
    req.body as FamilyDataInput,
  );

  res.status(200).json({ imported } satisfies FamilyDataImportResponse);
};

export const clearData: RequestHandler = async (req, res) => {
  const deleted = await familyDataService.clearFamilyData(getFamilyScope(req));

  res.status(200).json({ deleted } satisfies FamilyDataClearResponse);
};
